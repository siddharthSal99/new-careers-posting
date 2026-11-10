"use client";

import { useActionState } from "react";
import { runNowAction } from "./actions";
import type { RunSummary } from "@/lib/run";

export function RunNow() {
  const [summary, action, pending] = useActionState<RunSummary | null>(runNowAction, null);
  const me = summary?.users[0];
  return (
    <form action={action}>
      <button type="submit" className="secondary" disabled={pending}>{pending ? "Checking your boards…" : "Run daily check now"}</button>
      {summary && (
        <div className="notice small">
          {summary.boards.map((b) => (
            <div key={b.name}>
              {b.name}: {b.ok ? `${b.total} open, ${b.added} added, ${b.removed} removed` : <span className="error">{b.error}</span>}
            </div>
          ))}
          {me && (
            <>
              <div>{me.newMatching} new job{me.newMatching === 1 ? "" : "s"} matching your filters.</div>
              {(me.scored > 0 || me.scoreErrors > 0) && <div>Scored {me.scored} with AI{me.scoreErrors ? `, ${me.scoreErrors} failed` : ""}.</div>}
              {!!me.backfilled && <div>Also scored {me.backfilled} older job{me.backfilled === 1 ? "" : "s"}.</div>}
              <div>Email: {me.email}</div>
            </>
          )}
        </div>
      )}
    </form>
  );
}
