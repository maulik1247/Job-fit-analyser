import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { clerkMiddleware, getAuth } from "@clerk/express";
import {
  getDb,
  insertHistoryEntry,
  listHistoryForUser,
  deleteHistoryEntry,
  clearHistoryForUser,
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

getDb();

const SYSTEM_PROMPT =
  "You are an expert recruiter and career coach. Analyse ONLY the job description provided (no candidate profile). Return ONLY a valid JSON object with exactly these keys:\n" +
  "- matchScore: number 0-100 scoring overall JD quality and clarity as a hiring brief\n" +
  "- keywordsMatched: array of strings — key skills, tools, and themes explicitly emphasized in the JD\n" +
  "- keywordsMissing: array of strings — important skills, qualifications, or themes the JD omits or leaves vague\n" +
  "- strengths: array of exactly 3 strings — strengths of how the role or JD is presented\n" +
  "- gaps: array of exactly 3 strings — gaps or risks in the JD or role definition\n" +
  "Return nothing else. No markdown, no code fences, no explanation. Pure JSON only.";

const PORT = Number(process.env.PORT) || 8787;
const isProd = process.env.NODE_ENV === "production";

if (!process.env.CLERK_SECRET_KEY?.trim()) {
  console.error("Set CLERK_SECRET_KEY in .env (from the Clerk dashboard).");
  process.exit(1);
}

const app = express();
if (isProd) app.set("trust proxy", 1);

app.use(express.json({ limit: "512kb" }));
app.use(clerkMiddleware());

function requireClerkAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.clerkUserId = userId;
  next();
}

const PLACEHOLDER_KEYS = new Set([
  "",
  "sk-your-key-here",
  "your-api-key-here",
  "REPLACE_ME",
]);

app.get("/api/history", requireClerkAuth, (req, res) => {
  const entries = listHistoryForUser(req.clerkUserId);
  res.json({ entries });
});

app.post("/api/history", requireClerkAuth, (req, res) => {
  const body = req.body ?? {};
  const id = body.id;
  const companyName = body.companyName;
  const jdText = body.jdText;
  const result = body.result;
  const createdAt = body.createdAt;
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
  try {
    insertHistoryEntry(req.clerkUserId, {
      id,
      companyName,
      jdText,
      result,
      createdAt,
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save history" });
  }
});

app.delete("/api/history", requireClerkAuth, (req, res) => {
  clearHistoryForUser(req.clerkUserId);
  res.json({ ok: true });
});

app.delete("/api/history/:id", requireClerkAuth, (req, res) => {
  const ok = deleteHistoryEntry(req.clerkUserId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
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

  const { jdText } = req.body ?? {};
  if (typeof jdText !== "string" || !jdText.trim()) {
    return res.status(400).json({ error: "jdText is required" });
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
        max_tokens: 1500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Job Description:\n${jdText}` },
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

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error calling OpenAI" });
  }
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
