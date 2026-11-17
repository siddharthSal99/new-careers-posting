"use client";

import { useEffect, useState, useTransition } from "react";
import type { EssaySaveResult } from "./actions";

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** "200-400 words" / "up to 300 words" in the question's help text, if present. */
function wordTarget(hint: string) {
  const range = /(\d{2,4})\s*(?:-|–|to)\s*(\d{2,4})\s*words/i.exec(hint);
  if (range) return `${range[1]}–${range[2]} words`;
  const max = /(?:up to|max(?:imum)?|no more than|under)\s*(\d{2,4})\s*words/i.exec(hint);
  return max ? `up to ${max[1]} words` : null;
}

export function EssayEditor({
  initialAnswer,
  initialSavedAt,
  hint = "",
  save,
  remove,
  children,
  text,
  setText,
}: {
  initialAnswer: string;
  initialSavedAt: string | null;
  /** The question's help text, used to show a word target. */
  hint?: string;
  save: (answer: string) => Promise<EssaySaveResult>;
  remove?: () => Promise<void>;
  /** Extra controls (e.g. the Generate button) shown next to Save. */
  children?: React.ReactNode;
  /** Optional controlled text, so a parent can stream a generated draft in. */
  text?: string;
  setText?: (s: string) => void;
}) {
  const [own, setOwn] = useState(initialAnswer);
  const value = text ?? own;
  const setValue = setText ?? setOwn;
  const [saved, setSaved] = useState(initialAnswer);
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [saving, startSave] = useTransition();
  const dirty = value !== saved;
  const target = wordTarget(hint);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onSave = () =>
    startSave(async () => {
      const res = await save(value);
      if (!res.ok) return setMessage({ error: res.error });
      setSaved(value);
      setSavedAt(res.savedAt);
      setMessage({ ok: res.savedAt ? "Saved." : "Cleared." });
    });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ ok: "Copied to clipboard." });
    } catch {
      setMessage({ error: "Couldn't copy; select the text and copy it manually." });
    }
  };

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setMessage(null);
        }}
        style={{ minHeight: 220 }}
        placeholder="Write your answer, or generate a draft to start from."
        aria-label="Your answer"
      />
      <div className="row small" style={{ justifyContent: "space-between", marginTop: 4 }}>
        <span className="muted">
          {countWords(value)} words{target && ` (target ${target})`}
        </span>
        <span className={dirty ? "" : "muted"} style={dirty ? { color: "var(--warn)" } : undefined}>
          {dirty ? "Unsaved changes" : savedAt ? `Saved ${new Date(savedAt).toLocaleString()}` : "Not saved"}
        </span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={onSave} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="secondary" onClick={onCopy} disabled={!value.trim()}>Copy</button>
        {children}
        {remove && (
          <button
            type="button"
            className="danger"
            style={{ marginLeft: "auto" }}
            onClick={() => {
              if (confirm("Delete this saved essay?")) startSave(remove);
            }}
          >
            Delete
          </button>
        )}
      </div>
      {message?.error && <p className="error small">{message.error}</p>}
      {message?.ok && <p className="small" style={{ color: "var(--good)" }}>{message.ok}</p>}
    </div>
  );
}
