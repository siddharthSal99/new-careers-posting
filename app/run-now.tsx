"use client";

import { useActionState } from "react";
import { runNowAction } from "./actions";
import type { RunSummary } from "@/lib/run";

export function RunNow() {
  const [summary, action, pending] = useActionState<RunSummary | null>(runNowAction, null);
  return (
    <form action={action}>
      <button type="submit" className="secondary" disabled={pending}>{pending ? "Checking all boards…" : "Run daily check now"}</button>
      {summary && (
        <div className="notice small">
          {summary.companies.map((c) => (
            <div key={c.name}>
              {c.name}: {c.ok ? `${c.total} open, ${c.newMatching} new matching, ${c.removed} removed` : <span className="error">{c.error}</span>}
            </div>
          ))}
          {summary.scored > 0 && <div>Scored {summary.scored} job(s) with AI{summary.scoreErrors ? `, ${summary.scoreErrors} failed` : ""}.</div>}
          <div>Email: {summary.email}</div>
        </div>
      )}
    </form>
  );
}
