import { db, getSettings, listCompanies } from "./db";
import { applyFilters } from "./filters";

export interface JobView {
  id: number;
  companyId: number;
  company: string;
  title: string;
  department: string | null;
  location: string;
  url: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  isBaseline: boolean;
  repost: boolean;
  score: number | null;
  verdict: string | null;
  reason: string | null;
  matches: boolean;
}

/** Open jobs with whether each passes the current filters (re-evaluated, so filter changes show up here). */
export async function openJobs(): Promise<JobView[]> {
  const sql = await db();
  const [settings, companies] = await Promise.all([getSettings(), listCompanies()]);
  const deps = new Map(companies.map((c) => [c.id, c.departments]));
  const rows = await sql`
    select j.id, j.company_id, c.name as company, j.title, j.department, j.location, j.is_remote, j.url,
           j.posted_at, j.first_seen_at, j.is_baseline, j.repost_of, j.score, j.verdict, j.reason
    from jobs j join companies c on c.id = j.company_id
    where j.removed_at is null`;
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    company: r.company,
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
    matches: applyFilters({ title: r.title, department: r.department, location: r.location, isRemote: r.is_remote }, settings, deps.get(r.company_id) ?? []).pass,
  }));
}

export function age(d: Date | null) {
  if (!d) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 60) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
