import { fetchJobDetails, type AppQuestion } from "./ats/details";
import { db } from "./db";
import type { AtsKind } from "./types";

/** Re-fetch application questions after this long; forms rarely change. */
const DETAILS_TTL_MS = 7 * 86_400_000;

export interface JobPage {
  id: number;
  subscriptionId: number;
  company: string;
  ats: AtsKind;
  boardToken: string;
  externalId: string;
  title: string;
  department: string | null;
  location: string;
  url: string;
  applyUrl: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  removedAt: Date | null;
  isBaseline: boolean;
  repost: boolean;
  description: string | null;
  salary: string | null;
  score: number | null;
  verdict: string | null;
  reason: string | null;
  blockers: string[] | null;
  questions: AppQuestion[] | null;
  /** Why the questions couldn't be loaded, if they couldn't. */
  detailsError: string | null;
}

/**
 * Loads a job for the job page, only if it's on a board this user tracks, fetching its
 * application questions (and Greenhouse pay range) the first time anyone opens it.
 */
export async function getJobPage(userId: number, jobId: number): Promise<JobPage | null> {
  const sql = await db();
  const [r] = await sql`
    select j.*, s.id as sub_id, s.name as company, s.created_at as sub_created, c.ats, c.board_token,
           uj.score, uj.verdict, uj.reason, uj.blockers
    from jobs j
    join subscriptions s on s.company_id = j.company_id and s.user_id = ${userId}
    join companies c on c.id = j.company_id
    left join user_jobs uj on uj.job_id = j.id and uj.user_id = ${userId}
    where j.id = ${jobId}`;
  if (!r) return null;

  let details = r.details as { salary: string | null; questions: AppQuestion[] } | null;
  let detailsError: string | null = null;
  const stale = !r.details_fetched_at || Date.now() - r.details_fetched_at.getTime() > DETAILS_TTL_MS;
  // Closed jobs keep whatever was fetched while they were open.
  if (stale && !r.removed_at) {
    try {
      details = await fetchJobDetails(r.ats, r.board_token, r.external_id);
      await sql`
        update jobs set details = ${sql.json(details as any)}, details_fetched_at = now(),
          salary = coalesce(${details.salary}, salary)
        where id = ${jobId}`;
    } catch (e) {
      detailsError = (e as Error).message.slice(0, 200);
      console.error(`couldn't load application details for job ${jobId}:`, detailsError);
    }
  }

  return {
    id: r.id,
    subscriptionId: r.sub_id,
    company: r.company,
    ats: r.ats,
    boardToken: r.board_token,
    externalId: r.external_id,
    title: r.title,
    department: r.department,
    location: r.location,
    url: r.url,
    applyUrl: r.apply_url ?? r.url,
    postedAt: r.posted_at,
    firstSeenAt: r.first_seen_at,
    removedAt: r.removed_at,
    isBaseline: r.first_seen_at <= r.sub_created,
    repost: r.repost_of !== null,
    description: r.description,
    salary: details?.salary ?? r.salary,
    score: r.score,
    verdict: r.verdict,
    reason: r.reason,
    blockers: r.blockers,
    questions: details?.questions ?? null,
    detailsError,
  };
}
