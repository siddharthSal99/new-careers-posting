import { db } from "./db";
import { repostKey } from "./filters";
import type { AtsKind, FetchedJob } from "./types";

/**
 * Starts tracking a board for a user. The board's current jobs are recorded first, then the
 * subscription is created, so everything open right now counts as already seen for this user.
 */
export async function subscribe(input: {
  userId: number;
  name: string;
  sourceUrl: string;
  ats: AtsKind;
  token: string;
  departments: string[];
  jobs: FetchedJob[];
}) {
  const sql = await db();
  const [board] = await sql`
    insert into companies (name, source_url, ats, board_token)
    values (${input.name}, ${input.sourceUrl}, ${input.ats}, ${input.token})
    on conflict (ats, board_token) do update set name = companies.name
    returning id`;
  await syncBoard(board.id, input.jobs);
  await sql`update companies set last_success_at = now(), last_error = null, consecutive_failures = 0 where id = ${board.id}`;
  await sql`
    insert into subscriptions (user_id, company_id, name, source_url, departments)
    values (${input.userId}, ${board.id}, ${input.name}, ${input.sourceUrl}, ${input.departments})
    on conflict (user_id, company_id) do update
      set name = excluded.name, source_url = excluded.source_url, departments = excluded.departments`;
}

/** Stops tracking; deletes the board and its jobs if no one else tracks it. */
export async function unsubscribe(userId: number, subscriptionId: number) {
  const sql = await db();
  await sql.begin(async (tx) => {
    const [s] = await tx`delete from subscriptions where id = ${subscriptionId} and user_id = ${userId} returning company_id`;
    if (!s) return;
    await tx`delete from user_jobs uj using jobs j where uj.job_id = j.id and uj.user_id = ${userId} and j.company_id = ${s.company_id}`;
    await tx`delete from companies where id = ${s.company_id}
             and not exists (select 1 from subscriptions where company_id = ${s.company_id})`;
  });
}

export interface SyncResult {
  added: number;
  removed: number;
  total: number;
}

/**
 * Compares a fresh fetch with what's stored for one board:
 * new IDs are inserted (and linked to an earlier job if they look like a repost), missing IDs are marked removed,
 * and jobs that come back after being removed are reopened without counting as new.
 */
export async function syncBoard(boardId: number, fetched: FetchedJob[]): Promise<SyncResult> {
  const sql = await db();
  return sql.begin(async (tx) => {
    const existing = await tx`
      select id, external_id, title, location, removed_at, description is null as no_description
      from jobs where company_id = ${boardId}`;
    const byExt = new Map(existing.map((r) => [r.external_id as string, r]));
    const byKey = new Map<string, number>();
    for (const r of existing) byKey.set(repostKey(r.title, r.location), r.id);

    const seen = new Map<string, FetchedJob>();
    for (const j of fetched) if (!seen.has(j.externalId)) seen.set(j.externalId, j);
    const fresh = [...seen.values()].filter((j) => !byExt.has(j.externalId));
    const reopenIds = existing.filter((r) => r.removed_at && seen.has(r.external_id)).map((r) => r.id as number);
    const stillThere = existing.filter((r) => seen.has(r.external_id)).map((r) => r.id as number);
    const gone = existing.filter((r) => !seen.has(r.external_id) && !r.removed_at).map((r) => r.id as number);

    if (stillThere.length) await tx`update jobs set last_seen_at = now() where id = any(${stillThere})`;
    if (reopenIds.length) await tx`update jobs set removed_at = null where id = any(${reopenIds})`;
    // Descriptions are only needed while a job is open.
    if (gone.length) await tx`update jobs set removed_at = now(), description = null where id = any(${gone})`;

    // Fill in descriptions for open jobs that don't have one (saved before descriptions were stored, or reopened).
    const fill = existing
      .filter((r) => r.no_description && seen.get(r.external_id)?.description)
      .map((r) => ({ id: r.id as number, d: seen.get(r.external_id)!.description }));
    for (let i = 0; i < fill.length; i += 200) {
      const chunk = fill.slice(i, i + 200);
      await tx`
        update jobs set description = v.d
        from (select unnest(${chunk.map((f) => f.id)}::int[]) as id, unnest(${chunk.map((f) => f.d)}::text[]) as d) v
        where jobs.id = v.id`;
    }

    const rows = fresh.map((j) => ({
      company_id: boardId,
      external_id: j.externalId,
      title: j.title,
      department: j.department,
      location: j.location,
      is_remote: j.isRemote,
      url: j.url,
      posted_at: j.postedAt,
      repost_of: byKey.get(repostKey(j.title, j.location)) ?? null,
      description: j.description || null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx`insert into jobs ${tx(rows.slice(i, i + 500))} on conflict (company_id, external_id) do nothing`;
    }
    return { added: rows.length, removed: gone.length, total: seen.size };
  });
}
