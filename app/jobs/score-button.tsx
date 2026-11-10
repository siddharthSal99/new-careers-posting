"use client";

import { useActionState } from "react";
import { scoreJobsAction } from "../actions";
import type { BackfillResult } from "@/lib/score-jobs";

export function ScoreButton({ ids, enabled }: { ids: number[]; enabled: boolean }) {
  const [result, action, pending] = useActionState<BackfillResult | null, FormData>(scoreJobsAction, null);
  return (
    <form action={action} className="row" style={{ margin: "8px 0" }}>
      <input type="hidden" name="ids" value={ids.join(",")} />
      <button type="submit" className="secondary" disabled={pending || !enabled || ids.length === 0}>
        {pending
          ? "Scoring… (up to ~3 min)"
          : ids.length === 0
            ? "Every job in this view is scored"
            : `Score ${ids.length} unscored job${ids.length === 1 ? "" : "s"} in this view`}
      </button>
      {!enabled && <span className="muted small">AI matching needs your Anthropic API key and resume in Settings.</span>}
      {result && <span className={`small ${result.ok ? "" : "error"}`}>{result.message}</span>}
    </form>
  );
}
