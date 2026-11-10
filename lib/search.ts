import { db } from "./db";

/**
 * Splits a search box value into terms: words, "quoted phrases", and prefix* terms.
 * Each becomes a case-insensitive Postgres regex that matches whole words only,
 * so "go" doesn't match "good" or "Chicago" and "c++" still works.
 */
export function keywordPatterns(q: string): string[] {
  const terms = [...q.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).replace(/"/g, "").trim()).filter(Boolean);
  return terms.map((t) => {
    const prefix = t.endsWith("*") && t.length > 1;
    const word = (prefix ? t.slice(0, -1) : t).toLowerCase();
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const before = "(^|[^[:alnum:]_])";
    const after = prefix ? "" : "($|[^[:alnum:]_])";
    return `${before}${escaped}${after}`;
  });
}

/** IDs of the user's open jobs where every term appears in the title, company, department, location, AI reason or description. */
export async function searchOpenJobIds(userId: number, q: string): Promise<Set<number> | null> {
  const patterns = keywordPatterns(q);
  if (!patterns.length) return null;
  const sql = await db();
  const rows = await sql`
    select j.id from jobs j
    join subscriptions s on s.company_id = j.company_id and s.user_id = ${userId}
    left join user_jobs uj on uj.job_id = j.id and uj.user_id = ${userId}
    where j.removed_at is null
      and concat_ws(' ', j.title, s.name, j.department, j.location, uj.reason, j.description) ~* all(${patterns}::text[])`;
  return new Set(rows.map((r) => r.id as number));
}
