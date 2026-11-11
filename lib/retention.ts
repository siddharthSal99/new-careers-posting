import { db } from "./db";

/** Jobs posted longer ago than this aren't stored, and stored ones are deleted once they pass it. */
export const RETENTION_DAYS = 90;

/**
 * Whether a job is recent enough to store. Jobs without a posting date are kept while open:
 * deleting a still-open job would make it look new the next time its board is fetched.
 */
export function withinRetention(postedAt: Date | null) {
  return !postedAt || Date.now() - postedAt.getTime() <= RETENTION_DAYS * 86_400_000;
}

/**
 * Deletes data past the retention window: jobs posted more than RETENTION_DAYS ago (with their
 * per-user scores), closed jobs removed more than RETENTION_DAYS ago, old run logs and expired sessions.
 */
export async function purgeOldData() {
  const sql = await db();
  const window = `${RETENTION_DAYS} days`;
  const jobs = await sql`
    delete from jobs
    where posted_at < now() - ${window}::interval or removed_at < now() - ${window}::interval`;
  const runs = await sql`delete from runs where started_at < now() - ${window}::interval`;
  const sessions = await sql`delete from sessions where expires_at < now()`;
  return { jobs: jobs.count, runs: runs.count, sessions: sessions.count };
}
