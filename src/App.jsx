import { useState, useEffect, useCallback } from "react";
import {
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";

const GENERIC_ERROR =
  "Something went wrong. Please try again.";

const VALIDATION_MESSAGE = "Please paste a job description before analysing.";

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
  const [jdText, setJdText] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeEntryId, setActiveEntryId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [highlightJd, setHighlightJd] = useState(false);
  const [validationMessage, setValidationMessage] = useState(null);

  const loadHistory = useCallback(async () => {
    const r = await apiFetch("/api/history");
    if (!r.ok) return;
    const data = await r.json();
    setHistory(Array.isArray(data.entries) ? data.entries : []);
  }, [apiFetch]);

  useEffect(() => {
    loadHistory().catch(console.error);
  }, [loadHistory]);

  const startNewAnalysis = () => {
    setCompanyName("");
    setJdText("");
    setResult(null);
    setError(null);
    setValidationMessage(null);
    setHighlightJd(false);
    setActiveEntryId(null);
    setSidebarOpen(false);
  };

  const handleAnalyse = async () => {
    const jdOk = jdText.trim().length > 0;
    setHighlightJd(!jdOk);
    setValidationMessage(null);
    setError(null);

    if (!jdOk) {
      setValidationMessage(VALIDATION_MESSAGE);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let res;
      try {
        res = await apiFetch("/api/analyse", {
          method: "POST",
          body: JSON.stringify({ jdText }),
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

      setResult(parsed);

      const entry = {
        id: crypto.randomUUID(),
        companyName: companyName.trim() || "Untitled company",
        jdText,
        result: parsed,
        createdAt: new Date().toISOString(),
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
    setJdText(entry.jdText);
    setResult(entry.result);
    setActiveEntryId(entry.id);
    setError(null);
    setValidationMessage(null);
    setHighlightJd(false);
    setSidebarOpen(false);
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

  const scoreBg =
    result != null
      ? result.matchScore >= 70
        ? "bg-emerald-600/30 border-emerald-500/50"
        : result.matchScore >= 40
          ? "bg-amber-600/25 border-amber-500/50"
          : "bg-red-600/25 border-red-500/50"
      : "";

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
                          <span className="mt-0.5 block text-xs tabular-nums text-zinc-500">
                            {score}/100
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
                    Analysing the role...
                  </>
                ) : (
                  "Analyse"
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
                  Analysed role
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
                      Job description
                    </p>
                    <div className="mt-1.5 w-full rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-3 py-3 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
                      {jdText}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  JD Quality Score
                </h2>
                <div
                  className={`mx-auto flex max-w-xs flex-col items-center justify-center rounded-2xl border px-8 py-10 ${scoreBg}`}
                >
                  <p className="mb-2 text-sm font-medium text-zinc-400">
                    JD Quality Score
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
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="mb-4 text-lg font-semibold text-white">
                  Keywords Matched
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
                  Keywords Missing
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
                    Strengths
                  </h2>
                  <ul className="list-disc space-y-2 pl-5 text-zinc-300">
                    {(result.strengths || []).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">
                    Gaps
                  </h2>
                  <ul className="list-disc space-y-2 pl-5 text-zinc-300">
                    {(result.gaps || []).map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
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
            Sign in to run analyses. History is saved per account.
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
