import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { fetchBoard } from "./ats";
import { db, getAnthropicKey, getSettings, listSubscriptions } from "./db";
import { applyFilters } from "./filters";
import { mapLimit, scoreJob, type Match } from "./scoring";
import type { AtsKind } from "./types";

/** Short fingerprint of the resume, stored with each score so edits to the resume mark old scores as stale. */
export function resumeHash(resume: string) {
  return createHash("sha256").update(resume.trim()).digest("hex").slice(0, 16);
}

export interface ScoreTarget {
  jobId: number;
  boardId: number;
  company: string;
  ats: AtsKind;
  boardToken: string;
  externalId: string;
  title: string;
  department: string | null;
  location: string;
  /** Usually stored; fetched from the board if missing. */
  description: string | null;
}

export interface ScoreOutcome {
  results: Map<number, Match>;
  scored: number;
  failed: number;
  /** Not attempted because the time budget ran out, or no description was available. */
  notAttempted: number;
  /** The most recent scoring error, e.g. a revoked key or no credits left. */
  lastError?: string;
}

/** Scores jobs for one user with that user's API key until the time budget runs out. */
export async function scoreTargets(
  userId: number,
  apiKey: string,
  resume: string,
  targets: ScoreTarget[],
  budgetMs: number,
): Promise<ScoreOutcome> {
  const deadline = Date.now() + budgetMs;
  const out: ScoreOutcome = { results: new Map(), scored: 0, failed: 0, notAttempted: 0 };
  if (!targets.length) return out;

  const needBoards = [...new Map(targets.filter((t) => !t.description).map((t) => [t.boardId, t])).values()];
  const descriptions = new Map<string, string>();
  await mapLimit(needBoards, 3, async (t) => {
    try {
      const { jobs } = await fetchBoard(t.ats, t.boardToken);
      for (const j of jobs) descriptions.set(`${t.boardId}:${j.externalId}`, j.description);
    } catch (e) {
      console.error(`couldn't fetch ${t.company} for descriptions:`, (e as Error).message);
    }
  });

  const sql = await db();
  const hash = resumeHash(resume);
  await mapLimit(targets, 4, async (t) => {
    const description = t.description ?? descriptions.get(`${t.boardId}:${t.externalId}`);
    if (!description || Date.now() > deadline) {
      out.notAttempted++;
      return;
    }
    try {
      const m = await scoreJob(apiKey, resume, { title: t.title, company: t.company, department: t.department, location: t.location, description });
      if (!m) throw new Error("no structured result");
      await sql`
        insert into user_jobs (user_id, job_id, score, verdict, reason, blockers, scored_resume_hash)
        values (${userId}, ${t.jobId}, ${m.score}, ${m.verdict}, ${m.reason}, ${m.blockers}, ${hash})
        on conflict (user_id, job_id) do update set score = excluded.score, verdict = excluded.verdict,
          reason = excluded.reason, blockers = excluded.blockers, scored_resume_hash = excluded.scored_resume_hash`;
      out.results.set(t.jobId, m);
      out.scored++;
    } catch (e) {
      out.failed++;
      out.lastError = describeError(e);
      console.error(`scoring failed for user ${userId}, job ${t.jobId}:`, (e as Error).message);
    }
  });
  return out;
}

export interface BackfillResult {
  ok: boolean;
  message: string;
  scored: number;
  failed: number;
  remaining: number;
}

/**
 * Scores a user's open jobs that have no score, or a score from an older resume.
 * With `ids`, only those jobs (the ones on screen); otherwise every open job that passes the user's filters.
 */
export async function backfillScores(userId: number, opts: { ids?: number[]; budgetMs: number }): Promise<BackfillResult> {
  const none = (message: string) => ({ ok: false, message, scored: 0, failed: 0, remaining: 0 });
  const [settings, apiKey, subs] = await Promise.all([getSettings(userId), getAnthropicKey(userId), listSubscriptions(userId)]);
  if (!apiKey) return none("Add your Anthropic API key in Settings first.");
  if (!settings.resume.trim()) return none("Paste your resume in Settings first.");

  const sql = await db();
  const hash = resumeHash(settings.resume);
  const subByBoard = new Map(subs.map((s) => [s.boardId, s]));
  const rows = await sql`
    select j.id, j.company_id, j.external_id, j.title, j.department, j.location, j.is_remote, j.description
    from jobs j
    join subscriptions s on s.company_id = j.company_id and s.user_id = ${userId}
    left join user_jobs uj on uj.job_id = j.id and uj.user_id = ${userId}
    where j.removed_at is null
      and (uj.score is null or uj.scored_resume_hash is distinct from ${hash})
      ${opts.ids ? sql`and j.id = any(${opts.ids})` : sql``}
    -- Jobs that are new for this user first, then the most recently posted.
    order by (j.first_seen_at > s.created_at) desc, coalesce(j.posted_at, j.first_seen_at) desc`;

  const targets: ScoreTarget[] = rows
    .filter((r) => {
      if (opts.ids) return true;
      const s = subByBoard.get(r.company_id);
      return !!s && applyFilters({ title: r.title, department: r.department, location: r.location, isRemote: r.is_remote }, settings, s.departments).pass;
    })
    .map((r) => {
      const s = subByBoard.get(r.company_id)!;
      return {
        jobId: r.id,
        boardId: r.company_id,
        company: s.name,
        ats: s.ats,
        boardToken: s.boardToken,
        externalId: r.external_id,
        title: r.title,
        department: r.department,
        location: r.location,
        description: r.description,
      };
    });

  const res = await scoreTargets(userId, apiKey, settings.resume, targets, opts.budgetMs);
  const remaining = targets.length - res.scored;
  const parts = [`Scored ${res.scored} job${res.scored === 1 ? "" : "s"}.`];
  if (res.failed) parts.push(`${res.failed} failed (see server logs).`);
  if (remaining > 0) parts.push(`${remaining} still unscored${res.notAttempted ? "; click again to continue" : ""}.`);
  return { ok: true, message: parts.join(" "), scored: res.scored, failed: res.failed, remaining };
}

/** A short, readable reason for a failed scoring call, e.g. "Anthropic error 400: Your credit balance is too low". */
function describeError(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: string } } | undefined;
    const msg = body?.error?.message ?? e.message;
    return (e.status ? `Anthropic error ${e.status}: ${msg}` : msg).slice(0, 200);
  }
  return (e as Error).message.slice(0, 200);
}
