import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { verifyToken } from "@clerk/backend";
import multer from "multer";
import {
  getDb,
  insertHistoryEntry,
  listHistoryForUser,
  deleteHistoryEntry,
  clearHistoryForUser,
  listResumesForUser,
  getResumeForUser,
  insertResume,
  updateResume,
  deleteResume,
  updateHistoryEntryMeta,
} from "./db.js";
import { extractResumeText } from "./resumeParse.js";
import { normaliseAnalysisPayload } from "./analysisNormalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYSTEM_PROMPT =
  "You are an expert recruiter and career coach. Compare the candidate RESUME to the JOB DESCRIPTION. Score how strong a fit the candidate is for this role (skills, experience, seniority, domain).\n" +
  "Return ONLY a valid JSON object with exactly these keys:\n" +
  "- matchScore: number 0-100 — how well the resume fits this specific JD (not abstract JD quality)\n" +
  "- keywordsMatched: array of strings — important JD requirements, skills, or themes that the resume clearly supports or demonstrates\n" +
  "- keywordsMissing: array of strings — important JD requirements that the resume does not show or only weakly suggests\n" +
  "- strengths: array of exactly 3 strings — the candidate’s strongest points for this role based on the resume\n" +
  "- gaps: array of exactly 3 strings — main gaps or risks (resume vs what the JD needs)\n" +
  "- shortlistRisks: array of exactly 3 strings — why a busy recruiter might NOT shortlist this resume (first impression, weak hook, dense or vague bullets, formatting/ATS risk, tenure or scope signals, credibility gaps). Do not repeat gaps verbatim; focus on screening psychology and presentation, not a bare list of missing keywords.\n" +
  "- positioningTips: array of exactly 3 strings — concrete ways to improve how the candidate is positioned for this role: narrative, headline/summary, impact framing, leadership story, reordering emphasis, metrics, or LinkedIn alignment. Each tip must be strategic or structural, not “add keyword X”.\n" +
  "Return nothing else. No markdown, no code fences, no explanation. Pure JSON only.";

const PORT = Number(process.env.PORT) || 8787;
const isProd = process.env.NODE_ENV === "production";

if (!process.env.CLERK_SECRET_KEY?.trim()) {
  console.error("Set CLERK_SECRET_KEY in .env (from the Clerk dashboard).");
  process.exit(1);
}

const app = express();
if (isProd) app.set("trust proxy", 1);

/**
 * Vercel + Vite: subpaths must hit `api/index.js`. `vercel.json` rewrites
 * `/api/:path*` → `/api?__vp=:path*` so we restore the real path here before routing.
 * Also handle runtimes that strip `/api` from `pathname` only (prefix fallback).
 */
if (process.env.VERCEL) {
  app.use((req, _res, next) => {
    try {
      const raw = req.url || "/";
      const u = new URL(raw, "http://vercel.internal");
      const vp = u.searchParams.get("__vp");
      if (vp !== null) {
        u.searchParams.delete("__vp");
        const tail = String(vp).replace(/^\/+|\/+$/g, "");
        u.pathname = tail ? `/api/${tail}` : "/api";
        const qs = u.searchParams.toString();
        const fixed = u.pathname + (qs ? `?${qs}` : "");
        req.url = fixed;
        req.originalUrl = fixed;
      } else if (!u.pathname.startsWith("/api")) {
        const fixed =
          "/api" +
          (u.pathname === "/" ? "" : u.pathname) +
          u.search;
        req.url = fixed;
        req.originalUrl = fixed;
      }
    } catch (e) {
      console.error("vercel path:", e);
    }
    next();
  });
}

app.use(express.json({ limit: "2mb" }));

/**
 * Bearer JWT only — matches the SPA (`Authorization: Bearer` from Clerk `getToken()`).
 * We avoid `@clerk/express` middleware here: its auth step is async, and Express 4 does not
 * wait on async middleware, so `getAuth()` could run too early and throw (500 HTML on Vercel).
 */
function requireClerkAuth(req, res, next) {
  void (async () => {
    const raw = req.headers.authorization;
    const token =
      typeof raw === "string" && raw.startsWith("Bearer ")
        ? raw.slice(7).trim()
        : null;
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (!secretKey) {
      console.error("CLERK_SECRET_KEY is not set");
      res.status(500).json({ error: "Server misconfiguration" });
      return;
    }
    try {
      const payload = await verifyToken(token, { secretKey });
      const userId = payload.sub;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      req.clerkUserId = userId;
      next();
    } catch (e) {
      console.error("Clerk verifyToken:", e?.message || e);
      res.status(401).json({ error: "Unauthorized" });
    }
  })().catch((e) => next(e));
}

const PLACEHOLDER_KEYS = new Set([
  "",
  "sk-your-key-here",
  "your-api-key-here",
  "REPLACE_ME",
]);

const uploadResume = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const n = (file.originalname || "").toLowerCase();
    const ok =
      n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".txt");
    if (!ok) {
      return cb(
        new Error("Only PDF, DOCX, or TXT files are allowed.")
      );
    }
    cb(null, true);
  },
});

app.post(
  "/api/resume/parse",
  requireClerkAuth,
  (req, res, next) => {
    uploadResume.single("resume")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(400)
            .json({ error: "File too large (max 8 MB)." });
        }
        if (err.message) {
          return res.status(400).json({ error: err.message });
        }
        return next(err);
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({
          error: "No file uploaded. Use PDF, DOCX, or TXT.",
        });
      }
      const text = await extractResumeText(
        req.file.originalname,
        req.file.mimetype,
        req.file.buffer
      );
      const trimmed = text.replace(/\0/g, "").trim();
      if (!trimmed) {
        return res.status(422).json({
          error:
            "No readable text in this file. Try another export, or use a text-based PDF/DOCX. Scanned PDFs need OCR.",
        });
      }
      res.json({
        text: trimmed,
        filename: req.file.originalname,
      });
    } catch (e) {
      console.error(e);
      res.status(400).json({
        error: e?.message || "Could not read file",
      });
    }
  }
);

app.get("/api/history", requireClerkAuth, (req, res) => {
  try {
    getDb();
    const entries = listHistoryForUser(req.clerkUserId).map((e) => {
      const n = normaliseAnalysisPayload(e.result);
      return n ? { ...e, result: n } : e;
    });
    res.json({ entries });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error:
        "History database is unavailable on this deployment. Analysis still works.",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.post("/api/history", requireClerkAuth, (req, res) => {
  const body = req.body ?? {};
  const id = body.id;
  const companyName = body.companyName;
  const jdText = body.jdText;
  const result = body.result;
  const createdAt = body.createdAt;
  const resumeId = body.resumeId;
  const resumeTitle = body.resumeTitle;
  const resumeBody = body.resumeBody;
  const jobUrlRaw = body.jobUrl;
  const appliedRaw = body.applied;
  if (
    typeof id !== "string" ||
    typeof companyName !== "string" ||
    typeof jdText !== "string" ||
    typeof createdAt !== "string" ||
    result == null ||
    typeof result !== "object"
  ) {
    return res.status(400).json({ error: "Invalid history entry" });
  }
  if (resumeId != null && typeof resumeId !== "string") {
    return res.status(400).json({ error: "Invalid history entry" });
  }
  if (resumeTitle != null && typeof resumeTitle !== "string") {
    return res.status(400).json({ error: "Invalid history entry" });
  }
  if (resumeBody != null && typeof resumeBody !== "string") {
    return res.status(400).json({ error: "Invalid history entry" });
  }
  if (jobUrlRaw != null && typeof jobUrlRaw !== "string") {
    return res.status(400).json({ error: "Invalid history entry" });
  }
  if (appliedRaw != null && typeof appliedRaw !== "boolean") {
    return res.status(400).json({ error: "Invalid history entry" });
  }
  const jobUrl =
    typeof jobUrlRaw === "string" && jobUrlRaw.trim()
      ? jobUrlRaw.trim().slice(0, 4000)
      : null;
  const applied = appliedRaw === true;
  const resultToStore = normaliseAnalysisPayload(result) ?? result;
  try {
    getDb();
    insertHistoryEntry(req.clerkUserId, {
      id,
      companyName,
      jdText,
      result: resultToStore,
      createdAt,
      resumeId: resumeId ?? null,
      resumeTitle: resumeTitle ?? null,
      resumeBody: resumeBody ?? null,
      jobUrl,
      applied,
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error: "Could not save history (database unavailable).",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.patch("/api/history/:id", requireClerkAuth, (req, res) => {
  const body = req.body ?? {};
  const hasJobUrl = Object.prototype.hasOwnProperty.call(body, "jobUrl");
  const hasApplied = Object.prototype.hasOwnProperty.call(body, "applied");
  if (!hasJobUrl && !hasApplied) {
    return res.status(400).json({ error: "Provide jobUrl and/or applied" });
  }
  if (hasJobUrl && body.jobUrl != null && typeof body.jobUrl !== "string") {
    return res.status(400).json({ error: "Invalid jobUrl" });
  }
  if (hasApplied && typeof body.applied !== "boolean") {
    return res.status(400).json({ error: "Invalid applied" });
  }
  const patch = {};
  if (hasJobUrl) {
    const t = typeof body.jobUrl === "string" ? body.jobUrl.trim() : "";
    patch.jobUrl = t ? t.slice(0, 4000) : null;
  }
  if (hasApplied) {
    patch.applied = body.applied === true;
  }
  try {
    getDb();
    const ok = updateHistoryEntryMeta(req.clerkUserId, req.params.id, patch);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error: "Could not update history (database unavailable).",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.delete("/api/history", requireClerkAuth, (req, res) => {
  try {
    getDb();
    clearHistoryForUser(req.clerkUserId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: "Database unavailable", code: "DB_UNAVAILABLE" });
  }
});

app.delete("/api/history/:id", requireClerkAuth, (req, res) => {
  try {
    getDb();
    const ok = deleteHistoryEntry(req.clerkUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: "Database unavailable", code: "DB_UNAVAILABLE" });
  }
});

app.get("/api/resumes", requireClerkAuth, (req, res) => {
  try {
    getDb();
    const resumes = listResumesForUser(req.clerkUserId);
    res.json({ resumes });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error: "Could not load resumes (database unavailable).",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.post("/api/resumes", requireClerkAuth, (req, res) => {
  const body = req.body ?? {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const bodyText = typeof body.body === "string" ? body.body : "";
  if (!title || !bodyText.trim()) {
    return res.status(400).json({ error: "title and body are required" });
  }
  const id = typeof body.id === "string" ? body.id : randomUUID();
  const now = new Date().toISOString();
  try {
    getDb();
    insertResume(req.clerkUserId, {
      id,
      title,
      body: bodyText,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ id, title, body: bodyText, createdAt: now, updatedAt: now });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error: "Could not save resume (database unavailable).",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.patch("/api/resumes/:id", requireClerkAuth, (req, res) => {
  const body = req.body ?? {};
  const title =
    typeof body.title === "string" ? body.title.trim() : undefined;
  const bodyText = typeof body.body === "string" ? body.body : undefined;
  if (title === undefined && bodyText === undefined) {
    return res.status(400).json({ error: "Provide title and/or body" });
  }
  try {
    getDb();
    const existing = getResumeForUser(req.clerkUserId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const nextTitle = title ?? existing.title;
    const nextBody = bodyText ?? existing.body;
    const updatedAt = new Date().toISOString();
    updateResume(req.clerkUserId, req.params.id, {
      title: nextTitle,
      body: nextBody,
      updatedAt,
    });
    res.json({
      id: req.params.id,
      title: nextTitle,
      body: nextBody,
      createdAt: existing.createdAt,
      updatedAt,
    });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error: "Could not update resume (database unavailable).",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.delete("/api/resumes/:id", requireClerkAuth, (req, res) => {
  try {
    getDb();
    const ok = deleteResume(req.clerkUserId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(503).json({
      error: "Could not delete resume (database unavailable).",
      code: "DB_UNAVAILABLE",
    });
  }
});

app.post("/api/analyse", requireClerkAuth, async (req, res) => {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || PLACEHOLDER_KEYS.has(key)) {
    console.error(
      "Set OPENAI_API_KEY in .env to your real secret key (not the example placeholder)."
    );
    return res.status(500).json({
      error:
        "OPENAI_API_KEY is missing or still set to the placeholder. Edit .env in the project root and set OPENAI_API_KEY=sk-... to your real key.",
      code: "MISSING_API_KEY",
    });
  }

  const { jdText, resumeText } = req.body ?? {};
  if (typeof jdText !== "string" || !jdText.trim()) {
    return res.status(400).json({ error: "jdText is required" });
  }
  if (typeof resumeText !== "string" || !resumeText.trim()) {
    return res.status(400).json({ error: "resumeText is required" });
  }

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Candidate resume:\n${resumeText.trim()}\n\n---\n\nJob description:\n${jdText.trim()}`,
          },
        ],
      }),
    });

    const data = await openaiRes.json().catch(() => ({}));

    if (!openaiRes.ok) {
      console.error("OpenAI API error:", data);
      return res.status(502).json({
        error: "OpenAI request failed",
        details: data,
      });
    }

    const choice0 = data?.choices?.[0];
    const content = choice0?.message?.content;
    if (!choice0?.message || typeof content !== "string" || !content.trim()) {
      return res.status(502).json({
        error: "No text in the model response",
        details: data,
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
    } catch (e) {
      console.error("Analyse JSON parse:", e);
      return res.status(502).json({
        error: "Model did not return valid JSON",
        details: String(e?.message || e),
      });
    }
    const normalised = normaliseAnalysisPayload(parsed);
    if (!normalised) {
      return res.status(502).json({ error: "Invalid analysis payload shape" });
    }
    choice0.message.content = JSON.stringify(normalised);

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error calling OpenAI" });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({
    error: err?.message || "Internal server error",
  });
});

/* Vercel serves `dist/` via CDN; only this Node serverless fn handles /api. */
if (isProd && !process.env.VERCEL) {
  const dist = path.join(__dirname, "dist");
  app.use(express.static(dist));
  app.get("*", (req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(
      `Server http://localhost:${PORT} (${isProd ? "production + static" : "API only — use Vite dev with proxy"})`
    );
  });
}
