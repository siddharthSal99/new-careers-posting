import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSettings, listSubscriptions } from "@/lib/db";
import { searchOpenJobIds } from "@/lib/search";
import { age, openJobs, type JobView } from "@/lib/views";
import { ScoreButton } from "./score-button";

export const dynamic = "force-dynamic";
// The Score button runs inside this page's server function.
export const maxDuration = 300;

type Params = { company?: string; all?: string; q?: string; posted?: string; sort?: string; new?: string };

const POSTED: Record<string, { label: string; ms: number }> = {
  "24h": { label: "Past 24 hours", ms: 86_400_000 },
  "7d": { label: "Past week", ms: 7 * 86_400_000 },
  "30d": { label: "Past month", ms: 30 * 86_400_000 },
};

const NEW: Record<string, { label: string; ms: number }> = {
  "24h": { label: "New today", ms: 86_400_000 },
  "7d": { label: "New this week", ms: 7 * 86_400_000 },
};

/** Date the company published the job, or when we first saw it if the board doesn't say. */
const postedDate = (j: JobView) => j.postedAt ?? j.firstSeenAt;

export default async function JobsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;
  const { company, all, posted } = params;
  const q = params.q?.trim() ?? "";
  const sort = params.sort === "fit" ? "fit" : "posted";
  const [jobs, companies, settings, keywordHits] = await Promise.all([
    openJobs(user.id),
    listSubscriptions(user.id),
    getSettings(user.id),
    q ? searchOpenJobIds(user.id, q) : Promise.resolve(null),
  ]);
  // Ignore a company the user no longer tracks (e.g. an old email link) rather than showing nothing.
  const companyId = company && companies.some((c) => c.id === Number(company)) ? Number(company) : null;
  const companyOptions = [...companies].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const postedWindow = posted ? POSTED[posted] : undefined;
  const newWindow = params.new ? NEW[params.new] : undefined;
  const now = Date.now();

  const shown = jobs
    .filter((j) => (companyId ? j.subscriptionId === companyId : true))
    .filter((j) => (all ? true : j.matches))
    .filter((j) => (postedWindow ? now - postedDate(j).getTime() <= postedWindow.ms : true))
    // "New" means it appeared after you started tracking the company, within the window.
    .filter((j) => (newWindow ? !j.isBaseline && now - j.firstSeenAt.getTime() <= newWindow.ms : true))
    .filter((j) => (keywordHits ? keywordHits.has(j.id) : true))
    .sort((a, b) =>
      sort === "fit"
        ? (b.score ?? -1) - (a.score ?? -1) || postedDate(b).getTime() - postedDate(a).getTime()
        : postedDate(b).getTime() - postedDate(a).getTime(),
    );
  // Job counts per company for the dropdown, respecting "Show non-matching too".
  const countFor = (subId: number | null) => jobs.filter((j) => (all ? true : j.matches) && (subId === null || j.subscriptionId === subId)).length;
  const unscored = shown.filter((j) => j.score === null || j.stale).map((j) => j.id);

  const href = (over: Partial<Params>) => {
    const merged = { ...params, ...over };
    const s = new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/jobs?${s}` : "/jobs";
  };

  return (
    <>
      <h1>Open jobs</h1>
      <div className="row small" style={{ marginBottom: 12, justifyContent: "flex-end" }}>
        {all ? <Link href={href({ all: undefined })}>Only matching</Link> : <Link href={href({ all: "1" })}>Show non-matching too</Link>}
      </div>

      {/* Keyed on the filters so the fields reset when they change via a link (e.g. Clear), not only on a full reload. */}
      <form key={JSON.stringify(params)} method="get" action="/jobs" className="panel filters">
        {all && <input type="hidden" name="all" value={all} />}
        <div className="filter-field" style={{ flex: "1 1 100%" }}>
          <label htmlFor="q">Keywords</label>
          <input id="q" name="q" type="text" defaultValue={q} placeholder='e.g. go kafka, "distributed systems", infra*' />
        </div>
        <div className="filter-field">
          <label htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyId ? String(companyId) : ""}>
            <option value="">All companies ({countFor(null)})</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({countFor(c.id)})</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="posted">Date posted</label>
          <select id="posted" name="posted" defaultValue={posted && POSTED[posted] ? posted : ""}>
            <option value="">Any time</option>
            {Object.entries(POSTED).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="new">Show</label>
          <select id="new" name="new" defaultValue={params.new && NEW[params.new] ? params.new : ""}>
            <option value="">All open jobs</option>
            {Object.entries(NEW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="sort">Sort by</label>
          <select id="sort" name="sort" defaultValue={sort}>
            <option value="posted">Most recent</option>
            <option value="fit">Fit score</option>
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit">Apply</button>
          {(q || posted || params.sort || params.new || company) && (
            <Link href={href({ q: undefined, posted: undefined, sort: undefined, new: undefined, company: undefined })} className="small">Clear</Link>
          )}
        </div>
      </form>

      <p className="muted small">
        {shown.length} job{shown.length === 1 ? "" : "s"}. Keywords search the title, company, department, location, AI reason and job description. Every term must match as a whole word; use "quotes" for phrases and a trailing * for word beginnings.
        Posting dates come from the company's job board; "new" marks jobs that appeared after you started tracking.
      </p>
      {shown.length > 0 && <ScoreButton ids={unscored.slice(0, 1000)} enabled={!!settings.anthropicKeyHint && !!settings.resume.trim()} />}

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Job</th>
              <th>Posted</th>
              <th style={{ paddingRight: 16 }}>Fit</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((j) => (
              <tr key={j.id} style={j.matches ? undefined : { opacity: 0.55 }}>
                <td style={{ paddingLeft: 16 }}>
                  <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a>{" "}
                  {!j.isBaseline && <span className="chip good">new</span>}{" "}
                  {j.repost && <span className="chip warn">likely repost</span>}
                  <div className="muted small">{[j.company, j.department, j.location].filter(Boolean).join(" · ")}</div>
                  {j.reason && <div className="small">{j.reason}</div>}
                  {j.blockers && j.blockers.length > 0 && <div className="small error">Blockers: {j.blockers.join("; ")}</div>}
                </td>
                <td className="small" title={postedDate(j).toISOString().slice(0, 10)}>{age(postedDate(j))}</td>
                <td className="small" style={{ paddingRight: 16 }}>
                  {j.score !== null ? (
                    <span
                      className={`chip ${j.verdict === "strong" ? "good" : j.verdict === "skip" ? "bad" : "warn"}`}
                      style={j.stale ? { opacity: 0.5 } : undefined}
                      title={j.stale ? "Scored against an older version of your resume" : undefined}
                    >
                      {j.score}/10
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 500 && <p className="muted small">Showing the first 500. Narrow the filters to see the rest.</p>}
    </>
  );
}
