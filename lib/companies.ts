import { db } from "./db";
import { applyFilters, repostKey } from "./filters";
import type { AtsKind, FetchedJob, Settings } from "./types";

/** Saves a new company and records every current job as the baseline (never emailed). */
export async function addCompany(input: {
  name: string;
  sourceUrl: string;
  ats: AtsKind;
  token: string;
  departments: string[];
  jobs: FetchedJob[];
}) {
  const sql = await db();
  return sql.begin(async (tx) => {
    const [c] = await tx`
      insert into companies (name, source_url, ats, board_token, departments, last_success_at)
      values (${input.name}, ${input.sourceUrl}, ${input.ats}, ${input.token}, ${input.departments}, now())
      on conflict (ats, board_token) do update set name = excluded.name, departments = excluded.departments
      returning id`;
    if (input.jobs.length) {
      const rows = input.jobs.map((j) => ({
        company_id: c.id,
        external_id: j.externalId,
        title: j.title,
        department: j.department,
        location: j.location,
        is_remote: j.isRemote,
        url: j.url,
        posted_at: j.postedAt,
        is_baseline: true,
        notified_at: new Date(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await tx`insert into jobs ${tx(rows.slice(i, i + 500))} on conflict (company_id, external_id) do nothing`;
      }
    }
    return c.id as number;
  });
}

export interface SyncResult {
  newJobIds: number[];
  removed: number;
  total: number;
}

/**
 * Compares a fresh fetch with what's stored for one company:
 * new IDs are inserted (and flagged if they look like a repost), missing IDs are marked removed,
 * and jobs that come back after being removed are reopened without counting as new.
 */
export async function syncCompany(
  companyId: number,
  companyDepartments: string[],
  fetched: FetchedJob[],
  settings: Settings,
): Promise<SyncResult> {
  const sql = await db();
  return sql.begin(async (tx) => {
    const existing = await tx`
      select id, external_id, title, location, removed_at from jobs where company_id = ${companyId}`;
    const byExt = new Map(existing.map((r) => [r.external_id as string, r]));
    const byKey = new Map<string, number>();
    for (const r of existing) byKey.set(repostKey(r.title, r.location), r.id);

    const seen = new Set<string>();
    const fresh: FetchedJob[] = [];
    const reopenIds: number[] = [];
    for (const j of fetched) {
      if (seen.has(j.externalId)) continue;
      seen.add(j.externalId);
      const row = byExt.get(j.externalId);
      if (!row) fresh.push(j);
      else if (row.removed_at) reopenIds.push(row.id);
    }

    const stillThere = existing.filter((r) => seen.has(r.external_id)).map((r) => r.id as number);
    if (stillThere.length) {
      await tx`update jobs set last_seen_at = now() where id = any(${stillThere})`;
    }
    if (reopenIds.length) await tx`update jobs set removed_at = null where id = any(${reopenIds})`;
    const gone = existing.filter((r) => !seen.has(r.external_id) && !r.removed_at).map((r) => r.id as number);
    if (gone.length) await tx`update jobs set removed_at = now() where id = any(${gone})`;

    const newJobIds: number[] = [];
    for (const j of fresh) {
      const f = applyFilters(j, settings, companyDepartments);
      const [r] = await tx`
        insert into jobs (company_id, external_id, title, department, location, is_remote, url, posted_at,
                          repost_of, description, notified_at)
        values (${companyId}, ${j.externalId}, ${j.title}, ${j.department}, ${j.location}, ${j.isRemote}, ${j.url},
                ${j.postedAt}, ${byKey.get(repostKey(j.title, j.location)) ?? null},
                ${f.pass ? j.description : null},
                ${f.pass ? null : tx`now()`})
        returning id`;
      if (f.pass) newJobIds.push(r.id);
    }
    return { newJobIds, removed: gone.length, total: seen.size };
  });
}
