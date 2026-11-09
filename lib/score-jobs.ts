import { createHash } from "node:crypto";
import { fetchBoard } from "./ats";
import { db, getSettings, listCompanies } from "./db";
import { applyFilters } from "./filters";
import { mapLimit, scoreJob, scoringEnabled, type Match } from "./scoring";
import type { AtsKind } from "./types";

/** Short fingerprint of the resume, stored with each score so edits to the resume mark old scores as stale. */
export function resumeHash(resume: string) {
  return createHash("sha256").update(resume.trim()).digest("hex").slice(0, 16);
}

export interface ScoreTarget {
  id: number;
  companyId: number;
  company: string;
  ats: AtsKind;
  boardToken: string;
  externalId: string;
  title: string;
  department: string | null;
  location: string;
  /** Stored for new jobs; fetched from the board for everything else. */
  description: string | null;
}

export interface ScoreOutcome {
  results: Map<number, Match>;
  scored: number;
  failed: number;
  /** Not attempted because the time budget ran out, or no longer on the board. */
  notAttempted: number;
}

/**
 * Scores jobs against the resume until the time budget runs out.
 * Jobs without a stored description get it from a fresh fetch of their company's board.
 */
export async function scoreTargets(targets: ScoreTarget[], resume: string, budgetMs: number): Promise<ScoreOutcome> {
  const deadline = Date.now() + budgetMs;
  const out: ScoreOutcome = { results: new Map(), scored: 0, failed: 0, notAttempted: 0 };
  if (!targets.length) return out;

  const needBoards = [...new Map(targets.filter((t) => !t.description).map((t) => [t.companyId, t])).values()];
  const descriptions = new Map<string, string>();
  await mapLimit(needBoards, 3, async (t) => {
    try {
      const { jobs } = await fetchBoard(t.ats, t.boardToken);
      for (const j of jobs) descriptions.set(`${t.companyId}:${j.externalId}`, j.description);
    } catch (e) {
      console.error(`couldn't fetch ${t.company} for descriptions:`, (e as Error).message);
    }
  });

  const sql = await db();
  const hash = resumeHash(resume);
  await mapLimit(targets, 4, async (t) => {
    const description = t.description ?? descriptions.get(`${t.companyId}:${t.externalId}`);
    if (!description || Date.now() > deadline) {
      out.notAttempted++;
      return;
    }
    try {
      const m = await scoreJob(resume, { title: t.title, company: t.company, department: t.department, location: t.location, description });
      if (!m) throw new Error("no structured result");
      await sql`update jobs set score = ${m.score}, verdict = ${m.verdict}, reason = ${m.reason}, blockers = ${m.blockers},
                scored_resume_hash = ${hash} where id = ${t.id}`;
      out.results.set(t.id, m);
      out.scored++;
    } catch (e) {
      out.failed++;
      console.error(`scoring failed for job ${t.id}:`, (e as Error).message);
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
 * Scores open jobs that have no score, or a score from an older resume.
 * With `ids`, only those jobs (the ones on screen); otherwise every open job that passes the filters.
 */
export async function backfillScores(opts: { ids?: number[]; budgetMs: number }): Promise<BackfillResult> {
  const settings = await getSettings();
  if (!scoringEnabled()) return { ok: false, message: "ANTHROPIC_API_KEY isn't set on the server.", scored: 0, failed: 0, remaining: 0 };
  if (!settings.resume.trim()) return { ok: false, message: "Paste your resume in Settings first.", scored: 0, failed: 0, remaining: 0 };

  const sql = await db();
  const hash = resumeHash(settings.resume);
  const companies = new Map((await listCompanies()).map((c) => [c.id, c]));
  const rows = await sql`
    select j.id, j.company_id, j.external_id, j.title, j.department, j.location, j.is_remote, j.description
    from jobs j
    where j.removed_at is null
      and (j.score is null or j.scored_resume_hash is distinct from ${hash})
      ${opts.ids ? sql`and j.id = any(${opts.ids})` : sql``}
    order by coalesce(j.posted_at, j.first_seen_at) desc`;

  const targets: ScoreTarget[] = rows
    .filter((r) => {
      if (opts.ids) return true;
      const c = companies.get(r.company_id);
      return !!c && applyFilters({ title: r.title, department: r.department, location: r.location, isRemote: r.is_remote }, settings, c.departments).pass;
    })
    .map((r) => {
      const c = companies.get(r.company_id)!;
      return {
        id: r.id,
        companyId: r.company_id,
        company: c.name,
        ats: c.ats,
        boardToken: c.boardToken,
        externalId: r.external_id,
        title: r.title,
        department: r.department,
        location: r.location,
        description: r.description,
      };
    });

  const res = await scoreTargets(targets, settings.resume, opts.budgetMs);
  const remaining = targets.length - res.scored;
  const parts = [`Scored ${res.scored} job${res.scored === 1 ? "" : "s"}.`];
  if (res.failed) parts.push(`${res.failed} failed (see server logs).`);
  if (remaining > 0) parts.push(`${remaining} still unscored${res.notAttempted ? "; click again to continue" : ""}.`);
  return { ok: true, message: parts.join(" "), scored: res.scored, failed: res.failed, remaining };
}
