"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { STREAM_ERROR_MARK } from "@/lib/draft-protocol";
import type { EssaySaveResult } from "../../actions";
import { EssayEditor } from "../../essay-editor";

export interface EssayRef {
  id: number;
  label: string;
}

export function JobEssay({
  jobId,
  questionKey,
  hint,
  initialAnswer,
  initialSavedAt,
  save,
  canGenerate,
  cantGenerateReason,
  suggested,
  related,
  library,
}: {
  jobId: number;
  questionKey: string;
  hint: string;
  initialAnswer: string;
  initialSavedAt: string | null;
  save: (answer: string) => Promise<EssaySaveResult>;
  canGenerate: boolean;
  cantGenerateReason: string | null;
  /** Past essays picked as most relevant to this question. */
  suggested: EssayRef[];
  /** Whether `suggested` are related to the question or just recent examples of the user's writing. */
  related: boolean;
  /** Every saved essay the user could add as a reference. */
  library: EssayRef[];
}) {
  const [text, setText] = useState(initialAnswer);
  const [refs, setRefs] = useState<EssayRef[]>(suggested);
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function generate(revise: boolean) {
    if (!revise && text.trim() && !confirm("Replace your current text with a new draft?")) return;
    const before = text;
    setError(null);
    setBusy(true);
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/essays/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, questionKey, referenceIds: refs.map((r) => r.id), guidance, draft: revise ? before : undefined }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let out = "";
      setText("");
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
        const cut = out.indexOf(STREAM_ERROR_MARK);
        if (cut >= 0) {
          setText(out.slice(0, cut).trim() || before);
          throw new Error(out.slice(cut + 1));
        }
        setText(out);
      }
      if (!out.trim()) setText(before);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const addable = library.filter((e) => !refs.some((r) => r.id === e.id));

  return (
    <>
      {canGenerate && (
        <div className="small" style={{ margin: "8px 0" }}>
          <div className="muted">
            {refs.length
              ? related
                ? "Drafts will draw on these past answers:"
                : "No closely related past answers; these show your writing style:"
              : library.length
                ? "Drafts will use your resume and the job description. Add past answers to draw on:"
                : "Drafts use your resume and the job description. Saved answers will be reused for future questions."}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            {refs.map((r) => (
              <span key={r.id} className="chip">
                {r.label}{" "}
                <button type="button" className="chip-x" aria-label={`Don't use ${r.label}`} onClick={() => setRefs(refs.filter((x) => x.id !== r.id))} disabled={busy}>
                  ×
                </button>
              </span>
            ))}
            {addable.length > 0 && refs.length < 5 && (
              <select
                value=""
                onChange={(e) => {
                  const pick = library.find((x) => x.id === Number(e.target.value));
                  if (pick) setRefs([...refs, pick]);
                }}
                disabled={busy}
                style={{ width: "auto", padding: "2px 6px", fontSize: 13 }}
                aria-label="Add a past answer"
              >
                <option value="">+ add a past answer</option>
                {addable.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            )}
          </div>
          <input
            type="text"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="Optional guidance, e.g. “focus on the caching project, keep it under 250 words”"
            style={{ marginTop: 8 }}
            disabled={busy}
            maxLength={2000}
            aria-label="Guidance for the draft"
          />
        </div>
      )}
      <EssayEditor initialAnswer={initialAnswer} initialSavedAt={initialSavedAt} hint={hint} save={save} text={text} setText={busy ? () => {} : setText}>
        {canGenerate ? (
          busy ? (
            <>
              <span className="small muted">Writing…</span>
              <button type="button" className="secondary" onClick={() => abort.current?.abort()}>Stop</button>
            </>
          ) : (
            <>
              <button type="button" className="secondary" onClick={() => generate(false)}>Generate draft</button>
              {text.trim() && <button type="button" className="secondary" onClick={() => generate(true)}>Revise draft</button>}
            </>
          )
        ) : (
          cantGenerateReason && (
            <span className="small muted">
              {cantGenerateReason} <Link href="/settings">Settings</Link>
            </span>
          )
        )}
      </EssayEditor>
      {error && <p className="error small">{error}</p>}
    </>
  );
}
