/**
 * Shared by `server.js` and the Vite client so analyse + history always get
 * `shortlistRisks` / `positioningTips` (including backfills for older saves).
 */

function stringArray(v) {
  return Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
}

function padToThreeStrings(arr, fallbacks) {
  const out = stringArray(arr);
  const fb = Array.isArray(fallbacks) ? fallbacks : [];
  let i = 0;
  while (out.length < 3 && i < fb.length) {
    out.push(fb[i]);
    i += 1;
  }
  while (out.length < 3) {
    out.push("Add more specific, role-aligned detail backed by outcomes.");
  }
  return out.slice(0, 3);
}

/** If DB or API ever stored stringified JSON, recover a plain object. */
export function coerceAnalysisResult(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const inner = JSON.parse(raw.replace(/```json|```/gi, "").trim());
      if (
        inner != null &&
        typeof inner === "object" &&
        !Array.isArray(inner)
      ) {
        return inner;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  return null;
}

export function normaliseAnalysisPayload(raw) {
  const input = coerceAnalysisResult(raw);
  if (!input) return null;
  const gaps = stringArray(input.gaps);
  const strengths = stringArray(input.strengths);
  const kMiss = stringArray(input.keywordsMissing);
  const sr = stringArray(input.shortlistRisks);
  const pt = stringArray(input.positioningTips);

  const shortlistFallbacks = [
    gaps[0]
      ? `A quick skim may not show enough proof for what they care about: “${gaps[0].slice(0, 120)}${gaps[0].length > 120 ? "…" : ""}”`
      : "Lead with role fit in one line: what you solve for this employer, not only past titles.",
    gaps[1]
      ? `Second pass risk: tighten evidence around—${gaps[1].slice(0, 110)}${gaps[1].length > 110 ? "…" : ""}`
      : "Avoid dense jargon blocks; one clear metric per major win helps reviewers stay engaged.",
    "If impact is implied but not measured, reviewers default to “unclear scope”—add numbers where truthful.",
  ];

  const positioningFallbacks = [
    strengths[0]
      ? `Surface this earlier and tie it to the posting: ${strengths[0].slice(0, 130)}${strengths[0].length > 130 ? "…" : ""}`
      : "Reorder bullets so the closest match to this JD appears first under your current role.",
    kMiss[0]
      ? `Weave one concrete example that speaks to: ${kMiss[0].slice(0, 120)}${kMiss[0].length > 120 ? "…" : ""}`
      : "Align your summary headline with the exact role family and seniority in the JD.",
    "Thread one narrative from summary through experience so scope and level read consistent end-to-end.",
  ];

  return {
    matchScore: Math.max(0, Math.min(100, Number(input.matchScore) || 0)),
    keywordsMatched: stringArray(input.keywordsMatched),
    keywordsMissing: stringArray(input.keywordsMissing),
    strengths: padToThreeStrings(input.strengths, [
      "Add one accomplishment with scope, action, and measurable outcome for this role.",
      "Clarify seniority (team size, budget, region) where it strengthens fit.",
      "Tie an existing win to language the JD uses for impact.",
    ]),
    gaps: padToThreeStrings(input.gaps, [
      "Spell out how you meet a core JD requirement with a concrete example.",
      "Close a visible experience gap with adjacent proof or transferable scope.",
      "Address domain or stack fit more explicitly where the posting stresses it.",
    ]),
    shortlistRisks: padToThreeStrings(sr, shortlistFallbacks),
    positioningTips: padToThreeStrings(pt, positioningFallbacks),
  };
}

/** Use anywhere you display or persist an analysis object (SPA + API). */
export function shapeAnalysisForClient(raw) {
  if (raw == null) return null;
  const input = coerceAnalysisResult(raw);
  if (!input) {
    if (typeof raw === "object" && !Array.isArray(raw)) {
      return normaliseAnalysisPayload(raw) ?? raw;
    }
    return raw;
  }
  return normaliseAnalysisPayload(input) ?? input;
}
