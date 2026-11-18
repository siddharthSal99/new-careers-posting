"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Explanation } from "@/lib/explain";
import { adoptExplainedScoreAction, explainFitAction } from "../../actions";

const RATING = { strong: { label: "Strong", cls: "good" }, partial: { label: "Partial", cls: "warn" }, gap: { label: "Gap", cls: "bad" } } as const;

export function FitExplainer({
  jobId,
  initial,
  currentScore,
  stale,
  cantReason,
}: {
  jobId: number;
  initial: Explanation | null;
  currentScore: number | null;
  /** The saved explanation was made with an older version of the resume. */
  stale: boolean;
  cantReason: string | null;
}) {
  const [ex, setEx] = useState(initial);
  const [isStale, setStale] = useState(stale);
  const [open, setOpen] = useState(!!initial);
  const [context, setContext] = useState(initial?.context ?? "");
  const [error, setError] = useState<string | null>(null);
  const [adopted, setAdopted] = useState(false);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      const res = await explainFitAction(jobId, context);
      if (!res.ok) return setError(res.error);
      setEx(res.explanation);
      setStale(false);
      setAdopted(false);
    });

  if (!open) {
    return (
      <div style={{ margin: "8px 2px" }}>
        <button type="button" className="secondary" onClick={() => setOpen(true)}>Explain this score</button>
        <span className="muted small"> See what matches, what's missing, and why.</span>
      </div>
    );
  }

  const found = ex?.keywords.filter((k) => k.inResume) ?? [];
  const missing = ex?.keywords.filter((k) => !k.inResume) ?? [];

  return (
    <div className="panel" style={{ margin: "12px 0" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Why this fit score?</h3>
        {ex && (
          <span className="small muted">
            Second opinion: <b className={`chip ${ex.score >= 7 ? "good" : ex.score >= 4 ? "warn" : "bad"}`}>{ex.score}/10</b>
            {currentScore !== null && ex.score !== currentScore && <> (daily score {currentScore}/10)</>}
          </span>
        )}
      </div>

      {cantReason ? (
        <p className="small">{cantReason} <Link href="/settings">Settings</Link></p>
      ) : (
        <>
          <label htmlFor="ctx" className="small">Anything your resume doesn't show? <span className="muted">(optional)</span></label>
          <textarea
            id="ctx"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={3000}
            style={{ minHeight: 60 }}
            placeholder="e.g. I worked directly with enterprise customers on integrations at Broadcom; I've built RAG systems with LangChain."
            disabled={pending}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" onClick={run} disabled={pending}>
              {pending ? "Analyzing… (about 20–40 seconds)" : ex ? "Analyze again" : "Analyze fit"}
            </button>
            <span className="muted small">Uses Claude Opus with your API key, about 3–5¢.</span>
          </div>
          {error && <p className="error small">{error}</p>}
        </>
      )}

      {ex && (
        <div style={{ opacity: pending ? 0.5 : 1 }}>
          {isStale && <p className="notice small">Your resume has changed since this analysis. Analyze again to update it.</p>}
          <p style={{ marginBottom: 4 }}>{ex.summary}</p>
          <p className="small muted" style={{ marginTop: 0 }}>{ex.scoreDrivers}</p>

          <div className="fit-grid">
            {ex.categories.map((c) => (
              <div key={c.name} className="fit-cat">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b className="small">{c.name}</b>
                  <span className={`chip ${RATING[c.rating].cls}`}>{RATING[c.rating].label}</span>
                </div>
                {c.matches.length > 0 && (
                  <ul className="fit-list small">
                    {c.matches.map((m, i) => <li key={i} className="fit-match">{m}</li>)}
                  </ul>
                )}
                {c.gaps.length > 0 && (
                  <ul className="fit-list small">
                    {c.gaps.map((g, i) => <li key={i} className="fit-gap">{g}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {ex.keywords.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b className="small">Posting keywords</b>{" "}
              <span className="muted small">{found.length} of {ex.keywords.length} appear in your resume{ex.context ? " or context" : ""}</span>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                {found.map((k) => <span key={k.term} className="chip good">✓ {k.term}</span>)}
                {missing.map((k) => <span key={k.term} className="chip bad">✗ {k.term}</span>)}
              </div>
            </div>
          )}

          {ex.resumeSuggestions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b className="small">Worth checking your resume for</b>
              <ul className="small" style={{ marginTop: 4 }}>
                {ex.resumeSuggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          <div className="row small" style={{ marginTop: 8, justifyContent: "space-between" }}>
            <span className="muted">Analyzed {new Date(ex.createdAt).toLocaleString()}</span>
            {(adopted || (currentScore !== ex.score && !isStale)) && (
              adopted ? (
                <span style={{ color: "var(--good)" }}>Fit score updated to {ex.score}/10.</span>
              ) : (
                <button type="button" className="secondary" disabled={pending}
                  onClick={() => start(async () => {
                    const r = await adoptExplainedScoreAction(jobId);
                    if (r.ok) setAdopted(true);
                    else setError(r.error ?? "Couldn't update the score.");
                  })}>
                  Use {ex.score}/10 as this job's fit score
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
