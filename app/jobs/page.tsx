import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listCompanies } from "@/lib/db";
import { age, openJobs } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ company?: string; all?: string }> }) {
  await requireAuth();
  const { company, all } = await searchParams;
  const [jobs, companies] = await Promise.all([openJobs(), listCompanies()]);
  const companyId = company ? Number(company) : null;
  const shown = jobs
    .filter((j) => (companyId ? j.companyId === companyId : true))
    .filter((j) => (all ? true : j.matches))
    // Newest first: by when the company published it, falling back to when we first saw it.
    .sort((a, b) => (b.postedAt ?? b.firstSeenAt).getTime() - (a.postedAt ?? a.firstSeenAt).getTime());

  const q = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `/jobs?${s}` : "/jobs";
  };

  return (
    <>
      <h1>Open jobs</h1>
      <div className="row small" style={{ marginBottom: 12 }}>
        <Link href={q({ all })} className={companyId ? "" : "chip"}>All companies</Link>
        {companies.map((c) => (
          <Link key={c.id} href={q({ company: String(c.id), all })} className={companyId === c.id ? "chip" : ""}>{c.name}</Link>
        ))}
        <span style={{ marginLeft: "auto" }}>
          {all ? <Link href={q({ company })}>Only matching</Link> : <Link href={q({ company, all: "1" })}>Show non-matching too</Link>}
        </span>
      </div>
      <p className="muted small">
        {shown.length} jobs, newest first. "Posted" comes from the company's job board; "new" marks jobs that appeared after you started tracking.
      </p>
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Job</th>
              <th>Posted</th>
              <th className="hide-sm">Fit</th>
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
                </td>
                <td className="small">{age(j.postedAt ?? j.firstSeenAt)}</td>
                <td className="hide-sm small">{j.score !== null ? <span className={`chip ${j.verdict === "strong" ? "good" : j.verdict === "skip" ? "bad" : "warn"}`}>{j.score}/10</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 500 && <p className="muted small">Showing the newest 500.</p>}
    </>
  );
}
