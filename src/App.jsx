import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.jsx";
import { shapeAnalysisForClient } from "../analysisNormalize.js";

const RESUME_SELECT_NONE = "__shadcn_resume_none__";

const GENERIC_ERROR =
  "Something went wrong. Please try again.";

const VALIDATION_JD = "Please paste a job description.";
const VALIDATION_RESUME =
  "Select a saved resume. Add one under My resumes in the sidebar if needed.";
const VALIDATION_NO_RESUMES =
  "Add at least one resume from the sidebar: My resumes → + Add.";

/** Safe href for opening a pasted job URL (adds https if missing). */
function jobPostingHref(raw) {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    return new URL(t.includes("://") ? t : `https://${t}`).href;
  } catch {
    return null;
  }
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-900 border-t-transparent"
      aria-hidden
    />
  );
}

function JDAnalyserApp() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const apiFetch = useCallback(
    async (url, options = {}) => {
      const token = await getToken();
      const headers = new Headers(options.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (
        options.body &&
        typeof options.body === "string" &&
        !headers.has("Content-Type")
      ) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(url, { ...options, headers });
    },
    [getToken]
  );

  const emailDisplay =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "Signed in";

  const menuInitial = "M";

  const [companyName, setCompanyName] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [applied, setApplied] = useState(false);
  const [jdText, setJdText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumes, setResumes] = useState([]);
  const [selectedResumeId, setSelectedResumeId] = useState(null);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [newResumeTitle, setNewResumeTitle] = useState("");
  const [modalResumeFile, setModalResumeFile] = useState(null);
  const [modalDragActive, setModalDragActive] = useState(false);
  const [savingResume, setSavingResume] = useState(false);
  const [modalError, setModalError] = useState(null);
  const modalFileInputRef = useRef(null);
  const modalDragDepthRef = useRef(0);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeEntryId, setActiveEntryId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [highlightJd, setHighlightJd] = useState(false);
  const [highlightResume, setHighlightResume] = useState(false);
  const [validationMessage, setValidationMessage] = useState(null);
  const [savingJobMeta, setSavingJobMeta] = useState(false);

  const loadResumes = useCallback(async () => {
    const r = await apiFetch("/api/resumes");
    if (!r.ok) return;
    const data = await r.json();
    setResumes(Array.isArray(data.resumes) ? data.resumes : []);
  }, [apiFetch]);

  const loadHistory = useCallback(async () => {
    const r = await apiFetch("/api/history");
    if (!r.ok) return;
    const data = await r.json();
    setHistory(Array.isArray(data.entries) ? data.entries : []);
  }, [apiFetch]);

  useEffect(() => {
    loadHistory().catch(console.error);
    loadResumes().catch(console.error);
  }, [loadHistory, loadResumes]);

  /** Keep `result` aligned with history + same shape as server (recruiter arrays backfilled). */
  useEffect(() => {
    if (!activeEntryId) return;
    const h = history.find((e) => e.id === activeEntryId);
    const shaped = shapeAnalysisForClient(h?.result);
    if (shaped && typeof shaped === "object" && !Array.isArray(shaped)) {
      setResult(shaped);
    }
  }, [history, activeEntryId]);

  const closeResumeModal = useCallback(() => {
    setResumeModalOpen(false);
    setModalResumeFile(null);
    setModalDragActive(false);
    setNewResumeTitle("");
    setModalError(null);
    modalDragDepthRef.current = 0;
    if (modalFileInputRef.current) modalFileInputRef.current.value = "";
  }, []);

  function isAllowedResumeFile(file) {
    const n = (file?.name || "").toLowerCase();
    return n.endsWith(".pdf") || n.endsWith(".docx") || n.endsWith(".txt");
  }

  function stageModalFile(file) {
    if (!file || !isAllowedResumeFile(file)) {
      setModalError("Please use a PDF, DOCX, or TXT file.");
      return;
    }
    setModalError(null);
    setModalResumeFile(file);
  }

  useEffect(() => {
    if (!resumeModalOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeResumeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resumeModalOpen, closeResumeModal]);

  const parseResumeFile = async (file) => {
    const fd = new FormData();
    fd.append("resume", file);
    const r = await apiFetch("/api/resume/parse", { method: "POST", body: fd });
    const raw = await r.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(
        r.ok
          ? "Invalid response from server."
          : raw.trim().slice(0, 240) || `Request failed (${r.status}).`
      );
    }
    if (!r.ok) {
      const fallback =
        raw.trim().slice(0, 240) || `Could not read file (${r.status})`;
      throw new Error(
        typeof data.error === "string" ? data.error : fallback
      );
    }
    return {
      text: data.text,
      filename: data.filename || file.name,
    };
  };

  const startNewAnalysis = () => {
    setCompanyName("");
    setJobUrl("");
    setApplied(false);
    setJdText("");
    setResumeText("");
    setSelectedResumeId(null);
    setResult(null);
    setError(null);
    setValidationMessage(null);
    setHighlightJd(false);
    setHighlightResume(false);
    setActiveEntryId(null);
    setSidebarOpen(false);
  };

  const handleAnalyse = async () => {
    const jdOk = jdText.trim().length > 0;
    const picked = resumes.find((r) => r.id === selectedResumeId);
    const resumeBody = picked?.body?.trim() ?? "";
    const resumeOk = Boolean(picked && resumeBody);
    setHighlightJd(!jdOk);
    setHighlightResume(!resumeOk);
    setValidationMessage(null);
    setError(null);

    if (!jdOk) {
      setValidationMessage(VALIDATION_JD);
      return;
    }
    if (resumes.length === 0) {
      setValidationMessage(VALIDATION_NO_RESUMES);
      setHighlightResume(true);
      return;
    }
    if (!resumeOk) {
      setValidationMessage(VALIDATION_RESUME);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let res;
      try {
        res = await apiFetch("/api/analyse", {
          method: "POST",
          body: JSON.stringify({
            jdText,
            resumeText: resumeBody,
          }),
        });
      } catch (networkErr) {
        console.error(networkErr);
        setError(
          "Cannot reach the API server. From the project folder run: npm run dev."
        );
        return;
      }

      const responseText = await res.text();
      let data = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        console.error("Non-JSON response:", responseText?.slice(0, 500));
      }

      if (!res.ok) {
        console.error("Analyse API error:", res.status, data);
        if (res.status === 401) {
          setError("Session expired. Please sign in again.");
          return;
        }
        const serverMsg =
          typeof data?.error === "string" ? data.error : null;
        const openaiMsg = data?.details?.error?.message;

        if (res.status === 404) {
          setError(
            "API not found. Run npm run dev so the backend is running."
          );
        } else if (data?.code === "MISSING_API_KEY" && serverMsg) {
          setError(serverMsg);
        } else if (res.status === 502 && openaiMsg) {
          setError(`OpenAI: ${openaiMsg}`);
        } else if (res.status === 502) {
          setError(
            "OpenAI rejected the request. Check billing at platform.openai.com."
          );
        } else if (serverMsg) {
          setError(serverMsg);
        } else if (responseText && responseText.length < 400) {
          setError(`Server error (${res.status}): ${responseText}`);
        } else {
          setError(
            `Server error (${res.status}). If deployed on Vercel, check Functions logs and env vars (OPENAI_API_KEY, CLERK_SECRET_KEY).`
          );
        }
        return;
      }

      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") {
        console.error("Unexpected response shape:", data);
        const refusal = data?.choices?.[0]?.finish_reason;
        setError(
          refusal === "content_filter"
            ? "OpenAI blocked this content. Try a shorter or different JD."
            : "No text in the model response. Check Vercel logs or try again."
        );
        return;
      }

      const clean = raw.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr, "Raw:", raw);
        setError(
          "Could not read the model response. Try again or check the server terminal."
        );
        return;
      }

      const shaped =
        shapeAnalysisForClient(parsed) ??
        (parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : null);
      if (!shaped || typeof shaped !== "object" || Array.isArray(shaped)) {
        setError(
          "Could not read the model response. Try again or check the server terminal."
        );
        return;
      }
      setResult(shaped);
      setJobUrl("");
      setApplied(false);

      const resumeTitleForHistory = picked?.title ?? "Resume";

      const entry = {
        id: crypto.randomUUID(),
        companyName: companyName.trim() || "Untitled company",
        jdText,
        result: shaped,
        createdAt: new Date().toISOString(),
        resumeId: selectedResumeId ?? null,
        resumeTitle: resumeTitleForHistory,
        resumeBody: resumeBody,
        jobUrl: null,
        applied: false,
      };
      setActiveEntryId(entry.id);
      const saveRes = await apiFetch("/api/history", {
        method: "POST",
        body: JSON.stringify(entry),
      });
      if (saveRes.ok) {
        await loadHistory();
      }
    } catch (err) {
      console.error(err);
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const openHistoryEntry = (entry) => {
    setCompanyName(entry.companyName === "Untitled company" ? "" : entry.companyName);
    setJobUrl(typeof entry.jobUrl === "string" ? entry.jobUrl : "");
    setApplied(Boolean(entry.applied));
    setJdText(entry.jdText);
    setResumeText(entry.resumeBody ?? "");
    setSelectedResumeId(
      entry.resumeId != null &&
        resumes.some((r) => r.id === entry.resumeId)
        ? entry.resumeId
        : null
    );
    const shaped =
      shapeAnalysisForClient(entry.result) ??
      (entry.result &&
      typeof entry.result === "object" &&
      !Array.isArray(entry.result)
        ? entry.result
        : null);
    setResult(shaped);
    setActiveEntryId(entry.id);
    setError(null);
    setValidationMessage(null);
    setHighlightJd(false);
    setHighlightResume(false);
    setSidebarOpen(false);
  };

  const saveNewResume = async () => {
    const file = modalResumeFile;
    if (!file) return;
    const explicit = newResumeTitle.trim();
    const title =
      explicit ||
      file.name.replace(/\.[^.]+$/i, "").trim() ||
      file.name;
    setSavingResume(true);
    setModalError(null);
    try {
      const { text } = await parseResumeFile(file);
      const r = await apiFetch("/api/resumes", {
        method: "POST",
        body: JSON.stringify({ title, body: text }),
      });
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        setModalError(
          typeof errData.error === "string"
            ? errData.error
            : "Could not save resume."
        );
        return;
      }
      const row = await r.json();
      await loadResumes();
      setSelectedResumeId(row.id);
      setResumeText(row.body);
      closeResumeModal();
    } catch (e) {
      console.error(e);
      setModalError(e?.message || GENERIC_ERROR);
    } finally {
      setSavingResume(false);
    }
  };

  const deleteResumeById = async (id) => {
    try {
      const r = await apiFetch(`/api/resumes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) return;
      await loadResumes();
      if (selectedResumeId === id) {
        setSelectedResumeId(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteHistoryEntry = async (id) => {
    try {
      const r = await apiFetch(`/api/history/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) return;
      setHistory((prev) => prev.filter((h) => h.id !== id));
      setActiveEntryId((cur) => (cur === id ? null : cur));
    } catch (e) {
      console.error(e);
    }
  };

  const clearAllHistory = async () => {
    try {
      const r = await apiFetch("/api/history", {
        method: "DELETE",
      });
      if (!r.ok) return;
      setHistory([]);
      setActiveEntryId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const saveJobMeta = async () => {
    if (!activeEntryId) return;
    setSavingJobMeta(true);
    try {
      const r = await apiFetch(
        `/api/history/${encodeURIComponent(activeEntryId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            jobUrl: jobUrl.trim() ? jobUrl.trim() : null,
            applied,
          }),
        }
      );
      if (!r.ok) return;
      await loadHistory();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingJobMeta(false);
    }
  };

  const scoreBg =
    result != null
      ? result.matchScore >= 70
        ? "bg-emerald-600/30 border-emerald-500/50"
        : result.matchScore >= 40
          ? "bg-amber-600/25 border-amber-500/50"
          : "bg-red-600/25 border-red-500/50"
      : "";

  const historyEntryForView = activeEntryId
    ? history.find((h) => h.id === activeEntryId)
    : null;
  const resumeLabelForView =
    (selectedResumeId &&
      resumes.find((r) => r.id === selectedResumeId)?.title) ||
    historyEntryForView?.resumeTitle ||
    (resumeText.trim() ? "Resume" : "—");

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-zinc-950 text-zinc-100">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {sidebarCollapsed && (
        <button
          type="button"
          className="fixed left-3 top-3 z-30 hidden items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 shadow-md hover:bg-zinc-800 md:flex"
          aria-label="Expand sidebar"
          onClick={() => setSidebarCollapsed(false)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 text-zinc-100 transition-[transform,width] duration-200 ease-out md:static md:z-0 md:overflow-hidden ${
          sidebarCollapsed
            ? "w-[min(18rem,100vw)] md:w-0 md:border-transparent md:pointer-events-none"
            : "w-[min(18rem,100vw)] md:w-72"
        } ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex h-full min-h-0 w-[min(18rem,100vw)] flex-col md:w-72">
          {/* Top bar: panel toggle (desktop) + close (mobile) — matches chat UI shell */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-2 py-2">
            <button
              type="button"
              className="hidden shrink-0 rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 md:inline-flex"
              aria-label="Collapse sidebar"
              onClick={() => setSidebarCollapsed(true)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <span className="hidden flex-1 md:block" aria-hidden />
            <button
              type="button"
              className="ml-auto rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* + New analysis — same pattern as “+ New chat” */}
          <div className="shrink-0 px-2 pb-1 pt-2">
            <button
              type="button"
              onClick={startNewAnalysis}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-normal text-zinc-100 transition hover:bg-zinc-800/80"
            >
              <span className="flex h-8 w-8 items-center justify-center text-xl font-light leading-none text-zinc-400">
                +
              </span>
              <span>New analysis</span>
            </button>
          </div>

          <div className="shrink-0 border-b border-zinc-800 px-3 pb-3 pt-1">
            <div className="flex items-center justify-between gap-2 px-1 pt-2">
              <p className="text-xs font-medium text-zinc-500">My resumes</p>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setResumeModalOpen(true);
                  setModalResumeFile(null);
                  setNewResumeTitle("");
                  setModalDragActive(false);
                  modalDragDepthRef.current = 0;
                  if (modalFileInputRef.current) {
                    modalFileInputRef.current.value = "";
                  }
                }}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                + Add
              </button>
            </div>
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto">
              {resumes.length === 0 ? (
                <li className="px-2 py-2 text-xs text-zinc-500">
                  No saved resumes. Click Add or upload on the main screen.
                </li>
              ) : (
                resumes.map((r) => (
                  <li
                    key={r.id}
                    className="group flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-zinc-800/70"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedResumeId(r.id);
                        setResumeText(r.body);
                        setResumeUploadName(null);
                        setSidebarOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300"
                      title={r.title}
                    >
                      {r.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteResumeById(r.id)}
                      className="shrink-0 text-zinc-500 hover:text-red-400"
                      aria-label={`Delete ${r.title}`}
                    >
                      ×
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="shrink-0 px-4 pb-1 pt-3">
            <p className="text-xs font-medium text-zinc-500">Recents</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {history.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">
                No saved analyses yet.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {history.map((entry) => {
                  const score = Math.round(
                    Number(entry.result?.matchScore) || 0
                  );
                  const isActive = activeEntryId === entry.id;
                  return (
                    <li key={entry.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => openHistoryEntry(entry)}
                        className={`flex w-full items-start gap-2 rounded-lg px-3 py-2.5 pr-9 text-left text-sm transition ${
                          isActive
                            ? "bg-zinc-800 text-zinc-50"
                            : "text-zinc-300 hover:bg-zinc-800/70"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {entry.companyName}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                            <span className="truncate">
                              {entry.resumeTitle
                                ? `${entry.resumeTitle} · `
                                : ""}
                              {score}/100
                            </span>
                            {entry.applied && (
                              <span className="shrink-0 rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                                Applied
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteHistoryEntry(entry.id);
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
                        aria-label="Delete"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {history.length > 0 && (
            <div className="shrink-0 border-t border-zinc-800 p-2">
              <button
                type="button"
                onClick={clearAllHistory}
                className="w-full rounded-lg py-2 text-center text-xs text-red-400/90 hover:bg-red-950/40 hover:text-red-300"
              >
                Clear all history
              </button>
            </div>
          )}

          <div className="mt-auto shrink-0 border-t border-zinc-800 bg-zinc-950/50 p-3">
            <div className="flex items-center gap-3">
              <p
                className="min-w-0 flex-1 truncate text-xs text-zinc-500"
                title={emailDisplay}
              >
                {emailDisplay}
              </p>
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center [&_.cl-userButtonAvatarBox]:opacity-0 [&_.cl-userButtonTrigger]:flex [&_.cl-userButtonTrigger]:h-10 [&_.cl-userButtonTrigger]:w-10 [&_.cl-userButtonTrigger]:items-center [&_.cl-userButtonTrigger]:justify-center [&_.cl-userButtonTrigger]:rounded-lg [&_.cl-userButtonTrigger]:border [&_.cl-userButtonTrigger]:border-zinc-600 [&_.cl-userButtonBox]:border-0">
                <span
                  className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center text-sm font-semibold text-zinc-100"
                  aria-hidden
                >
                  {menuInitial}
                </span>
                <UserButton
                  appearance={{ baseTheme: "light" }}
                  afterSignOutUrl="/"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-zinc-300 hover:bg-zinc-800"
            aria-label="Open sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </button>
          <span className="font-semibold text-zinc-100">JD Analyser</span>
        </header>

        <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto px-4 py-8">
          <h1 className="mb-8 hidden text-center text-3xl font-semibold tracking-tight text-white md:block">
            JD Analyser
          </h1>

          {!result && (
            <>
              <div className="mb-4 flex flex-col gap-2">
                <label
                  htmlFor="company"
                  className="text-sm font-medium text-zinc-400"
                >
                  Company name
                </label>
                <input
                  id="company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Acme Inc."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                  autoComplete="organization"
                />
                <p className="text-xs text-zinc-500">
                  Stored with each run and listed in the sidebar.
                </p>
              </div>

              <div className="mb-6 flex flex-col gap-2">
                <label
                  htmlFor="resumePick"
                  className="text-sm font-medium text-zinc-400"
                >
                  Resume
                </label>
                <Select
                  value={selectedResumeId ?? RESUME_SELECT_NONE}
                  onValueChange={(val) => {
                    if (val === RESUME_SELECT_NONE) {
                      setSelectedResumeId(null);
                      setResumeText("");
                      return;
                    }
                    const r = resumes.find((x) => x.id === val);
                    setSelectedResumeId(val);
                    setResumeText(r?.body ?? "");
                    setHighlightResume(false);
                    setValidationMessage(null);
                  }}
                >
                  <SelectTrigger
                    id="resumePick"
                    className={
                      highlightResume
                        ? "border-red-500 focus:ring-red-500"
                        : undefined
                    }
                    aria-invalid={highlightResume || undefined}
                  >
                    <SelectValue
                      placeholder={
                        resumes.length
                          ? "Choose a saved resume…"
                          : "No resumes yet — add one in the sidebar"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    <SelectItem value={RESUME_SELECT_NONE}>
                      {resumes.length
                        ? "Choose a saved resume…"
                        : "No resumes yet — add one in the sidebar"}
                    </SelectItem>
                    {resumes.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-zinc-500">
                  Upload PDF, DOCX, or TXT under{" "}
                  <span className="text-zinc-400">My resumes → + Add</span>.
                  Then pick it here to compare with the job description.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="jd"
                  className="text-sm font-medium text-zinc-400"
                >
                  Paste Job Description
                </label>
                <textarea
                  id="jd"
                  value={jdText}
                  onChange={(e) => {
                    setJdText(e.target.value);
                    setHighlightJd(false);
                    setValidationMessage(null);
                  }}
                  className={`min-h-[200px] w-full resize-y rounded-lg border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none ring-0 transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 ${
                    highlightJd ? "border-red-500" : "border-zinc-700"
                  }`}
                  placeholder="Paste the full job description…"
                />
              </div>

              {validationMessage && (
                <p className="mt-3 text-center text-sm text-red-400">
                  {validationMessage}
                </p>
              )}

              <button
                type="button"
                onClick={handleAnalyse}
                disabled={loading}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Spinner />
                    Comparing resume to job…
                  </>
                ) : (
                  "Analyse fit"
                )}
              </button>
            </>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-950/50 px-4 py-3 text-center text-sm text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-8 md:mt-2">
              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  Compared run
                </h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Company
                    </p>
                    <p className="mt-1.5 text-base font-medium text-zinc-100">
                      {companyName.trim() || "Untitled company"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Resume used
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      {resumeLabelForView}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Job description
                    </p>
                    <div className="mt-1.5 w-full rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-3 py-3 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
                      {jdText}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="text-lg font-semibold text-white">
                  Analyse fit
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Fit score plus recruiter-style read: shortlist risks and how to
                  position yourself—not just keywords.
                </p>
                <div
                  className={`mx-auto mt-6 flex max-w-xs flex-col items-center justify-center rounded-2xl border px-8 py-10 ${scoreBg}`}
                >
                  <p className="mb-2 text-sm font-medium text-zinc-400">
                    Fit score
                  </p>
                  <p className="flex items-baseline justify-center gap-0 tabular-nums text-white">
                    <span className="text-6xl font-bold">
                      {Math.round(Number(result.matchScore) || 0)}
                    </span>
                    <span className="text-3xl font-semibold text-zinc-400">
                      /100
                    </span>
                  </p>
                </div>

                {(() => {
                  const shortlistRisks = result.shortlistRisks || [];
                  const positioningTips = result.positioningTips || [];
                  const bothMissing =
                    shortlistRisks.length === 0 && positioningTips.length === 0;

                  return (
                    <div className="mt-10 space-y-8 border-t border-zinc-800 pt-10">
                      {bothMissing ? (
                        <div className="rounded-lg border border-zinc-700 bg-zinc-950/50 p-4 text-sm text-zinc-500">
                          <p className="font-medium text-zinc-400">
                            Recruiter insights not in this saved run
                          </p>
                          <p className="mt-2 leading-relaxed">
                            This history entry was saved before those fields
                            existed. Use{" "}
                            <span className="text-zinc-400">New analysis</span>{" "}
                            and <span className="text-zinc-400">Analyse fit</span>{" "}
                            to refresh—they will show here with the score.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-5">
                            <h3 className="text-base font-semibold text-amber-100">
                              Why a recruiter might not shortlist you
                            </h3>
                            <p className="mt-1 text-xs text-amber-200/80">
                              Screening and signal—not the same as missing
                              keywords alone.
                            </p>
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-amber-100/95">
                              {shortlistRisks.length > 0 ? (
                                shortlistRisks.map((t, i) => (
                                  <li key={i}>{t}</li>
                                ))
                              ) : (
                                <li className="text-amber-200/70">
                                  Not returned for this run—try analysing again.
                                </li>
                              )}
                            </ul>
                          </div>
                          <div className="rounded-lg border border-sky-900/40 bg-sky-950/20 p-5">
                            <h3 className="text-base font-semibold text-sky-100">
                              Improve your positioning
                            </h3>
                            <p className="mt-1 text-xs text-sky-200/80">
                              Story, framing, and emphasis—not just keyword
                              stuffing.
                            </p>
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-sky-100/95">
                              {positioningTips.length > 0 ? (
                                positioningTips.map((t, i) => (
                                  <li key={i}>{t}</li>
                                ))
                              ) : (
                                <li className="text-sky-200/70">
                                  Not returned for this run—try analysing again.
                                </li>
                              )}
                            </ul>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  JD asks · resume supports
                </h2>
                <div className="flex flex-wrap gap-2">
                  {(result.keywordsMatched || []).map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full bg-emerald-900/50 px-3 py-1 text-sm text-emerald-200 ring-1 ring-emerald-700/50"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  JD asks · resume gaps
                </h2>
                <div className="flex flex-wrap gap-2">
                  {(result.keywordsMissing || []).map((kw) => (
                    <span
                      key={kw}
                      className="rounded-full bg-red-900/40 px-3 py-1 text-sm text-red-200 ring-1 ring-red-700/50"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Your strengths for this role
                  </h2>
                  <ul className="list-disc space-y-2 pl-5 text-zinc-300">
                    {(result.strengths || []).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Gaps vs this JD
                  </h2>
                  <ul className="list-disc space-y-2 pl-5 text-zinc-300">
                    {(result.gaps || []).map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </section>
              </div>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="mb-1 text-lg font-semibold text-white">
                  Application
                </h2>
                <p className="mb-6 text-sm text-zinc-500">
                  After you review the fit: say whether you applied, add the
                  listing URL, then save. Recents in the sidebar list company and
                  score; runs you mark “Yes” show an Applied badge so you can
                  scan companies you applied to.
                </p>
                <div className="space-y-6">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Applied for this job?
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setApplied(false)}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                          !applied
                            ? "border-zinc-500 bg-zinc-800 text-white"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                        }`}
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={() => setApplied(true)}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                          applied
                            ? "border-emerald-600/80 bg-emerald-950/50 text-emerald-200"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                        }`}
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="jobUrlResult"
                      className="text-xs font-medium uppercase tracking-wide text-zinc-500"
                    >
                      Job posting URL
                    </label>
                    <input
                      id="jobUrlResult"
                      type="text"
                      inputMode="url"
                      value={jobUrl}
                      onChange={(e) => setJobUrl(e.target.value)}
                      placeholder="https://…"
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                    />
                    {jobUrl.trim() && jobPostingHref(jobUrl) && (
                      <a
                        href={jobPostingHref(jobUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-sm text-blue-400 underline hover:text-blue-300"
                      >
                        Open posting
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={saveJobMeta}
                    disabled={savingJobMeta || !activeEntryId}
                    className="rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingJobMeta ? "Saving…" : "Save application details"}
                  </button>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {resumeModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label="Close dialog"
            onClick={closeResumeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resume-modal-title"
            className="relative z-10 w-full max-w-md rounded-xl border border-zinc-600 bg-zinc-900 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2
                id="resume-modal-title"
                className="text-lg font-semibold tracking-tight text-white"
              >
                Add resume
              </h2>
              <button
                type="button"
                onClick={closeResumeModal}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label
              htmlFor="resume-modal-label"
              className="text-xs font-medium text-zinc-500"
            >
              Label{" "}
              <span className="font-normal text-zinc-600">(optional)</span>
            </label>
            <input
              id="resume-modal-label"
              type="text"
              value={newResumeTitle}
              onChange={(e) => setNewResumeTitle(e.target.value)}
              placeholder="Defaults to file name"
              className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
            />

            <input
              ref={modalFileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="hidden"
              id="modal-resume-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) stageModalFile(f);
              }}
            />

            <div
              onDragEnter={(e) => {
                e.preventDefault();
                modalDragDepthRef.current += 1;
                setModalDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                modalDragDepthRef.current -= 1;
                if (modalDragDepthRef.current <= 0) {
                  modalDragDepthRef.current = 0;
                  setModalDragActive(false);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                modalDragDepthRef.current = 0;
                setModalDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) stageModalFile(f);
              }}
              className={`mt-4 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
                modalDragActive
                  ? "border-zinc-400 bg-zinc-800/70"
                  : "border-zinc-600 bg-zinc-950/60"
              }`}
            >
              <p className="text-sm font-medium text-zinc-200">
                {modalResumeFile
                  ? modalResumeFile.name
                  : "Drag and drop your resume here"}
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                PDF, DOCX, or TXT · max 8 MB
              </p>
              <button
                type="button"
                onClick={() => modalFileInputRef.current?.click()}
                className="mt-4 text-xs font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
              >
                Browse files
              </button>
              {modalResumeFile && (
                <button
                  type="button"
                  onClick={() => {
                    setModalResumeFile(null);
                    if (modalFileInputRef.current) {
                      modalFileInputRef.current.value = "";
                    }
                  }}
                  className="mt-4 block w-full text-xs text-red-400/90 hover:text-red-300"
                >
                  Remove file
                </button>
              )}
            </div>

            {modalError && (
              <p className="mt-4 text-sm text-red-400" role="alert">
                {modalError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2 border-t border-zinc-800 pt-4">
              <button
                type="button"
                onClick={closeResumeModal}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingResume || !modalResumeFile}
                onClick={() => saveNewResume()}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingResume ? "Saving…" : "Save resume"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-zinc-950 text-zinc-100">
        <Spinner />
        <span className="ml-2 text-sm text-zinc-400">Loading…</span>
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-zinc-950 px-4 py-10">
          <h1 className="mb-2 text-2xl font-semibold text-white">
            JD Analyser
          </h1>
          <p className="mb-6 max-w-sm text-center text-sm text-zinc-500">
            Sign in to compare your resume to job descriptions. History and saved resumes are stored per account.
          </p>
          <div className="w-full max-w-md">
            <SignIn routing="hash" appearance={{ baseTheme: "light" }} />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <JDAnalyserApp />
      </SignedIn>
    </>
  );
}
