import { db, getSettings, listSubscriptions } from "./db";
import { applyFilters } from "./filters";
import { resumeHash } from "./score-jobs";

export interface JobView {
  id: number;
  subscriptionId: number;
  company: string;
  title: string;
  department: string | null;
  location: string;
  url: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  /** Already open when the user started tracking the company. */
  isBaseline: boolean;
  repost: boolean;
  score: number | null;
  verdict: string | null;
  reason: string | null;
  blockers: string[] | null;
  /** Scored against an older version of the resume. */
  stale: boolean;
  matches: boolean;
}

/** A user's open jobs, with whether each passes their current filters (re-evaluated, so filter changes show up here). */
export async function openJobs(userId: number): Promise<JobView[]> {
  const sql = await db();
  const [settings, subs] = await Promise.all([getSettings(userId), listSubscriptions(userId)]);
  const subByBoard = new Map(subs.map((s) => [s.boardId, s]));
  const rows = await sql`
    select j.id, j.company_id, j.title, j.department, j.location, j.is_remote, j.url, j.posted_at, j.first_seen_at,
           j.repost_of, j.first_seen_at <= s.created_at as is_baseline,
           uj.score, uj.verdict, uj.reason, uj.blockers, uj.scored_resume_hash
    from jobs j
    join subscriptions s on s.company_id = j.company_id and s.user_id = ${userId}
    left join user_jobs uj on uj.job_id = j.id and uj.user_id = ${userId}
    where j.removed_at is null`;
  const hash = resumeHash(settings.resume);
  return rows.map((r) => {
    const s = subByBoard.get(r.company_id)!;
    return {
      id: r.id,
      subscriptionId: s.id,
      company: s.name,
      title: r.title,
      department: r.department,
      location: r.location,
      url: r.url,
      postedAt: r.posted_at,
      firstSeenAt: r.first_seen_at,
      isBaseline: r.is_baseline,
      repost: r.repost_of !== null,
      score: r.score,
      verdict: r.verdict,
      reason: r.reason,
      blockers: r.blockers,
      stale: r.score !== null && r.scored_resume_hash !== hash,
      matches: applyFilters({ title: r.title, department: r.department, location: r.location, isRemote: r.is_remote }, settings, s.departments).pass,
    };
  });
}

export function age(d: Date | null) {
  if (!d) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 60) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
