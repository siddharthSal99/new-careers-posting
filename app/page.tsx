import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { ATS_LABEL } from "@/lib/ats";
import { db, getSettings, listCompanies } from "@/lib/db";
import { age, openJobs } from "@/lib/views";
import { scoringEnabled } from "@/lib/scoring";
import { AddCompany, DepartmentPicker } from "./add-company";
import { deleteCompanyAction, updateDepartmentsAction } from "./actions";
import { RunNow } from "./run-now";

export const dynamic = "force-dynamic";
// "Run daily check now" runs inside this page's server function.
export const maxDuration = 300;

export default async function Home() {
  await requireAuth();
  const sql = await db();
  const [companies, jobs, settings, deptRows] = await Promise.all([
    listCompanies(),
    openJobs(),
    getSettings(),
    sql`select company_id, coalesce(department, '(none)') as name, count(*)::int as count
        from jobs where removed_at is null group by 1, 2 order by 3 desc`,
  ]);
  const weekAgo = Date.now() - 7 * 86_400_000;

  const setup: string[] = [];
  if (!settings.email) setup.push("add your email address");
  if (!settings.resume.trim()) setup.push("paste your resume (for AI matching)");
  if (!settings.locations.length) setup.push("set the locations you want");

  return (
    <>
      <h1>Companies</h1>
      {setup.length > 0 && (
        <p className="notice">
          In <Link href="/settings">Settings</Link>: {setup.join(", ")}.
        </p>
      )}
      <AddCompany />

      {companies.length > 0 && (
        <>
          <h2>Tracking {companies.length}</h2>
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 16 }}>Company</th>
                  <th>Open</th>
                  <th>Matching</th>
                  <th>New (7d)</th>
                  <th className="hide-sm">Last check</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const cj = jobs.filter((j) => j.companyId === c.id);
                  const matching = cj.filter((j) => j.matches);
                  const fresh = matching.filter((j) => !j.isBaseline && j.firstSeenAt.getTime() > weekAgo);
                  return (
                    <tr key={c.id}>
                      <td style={{ paddingLeft: 16 }}>
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.name}</a>
                        <div className="muted small">{ATS_LABEL[c.ats]} · {c.boardToken} · {c.departments.length ? `${c.departments.length} departments` : "all departments"}</div>
                        {c.lastError && <div className="small error">Failing ({c.consecutiveFailures}×): {c.lastError}</div>}
                        <details className="small" style={{ marginTop: 4 }}>
                          <summary className="muted">Edit</summary>
                          <form action={updateDepartmentsAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <label htmlFor={`n${c.id}`}>Name</label>
                            <input id={`n${c.id}`} name="name" type="text" defaultValue={c.name} />
                            <DepartmentPicker
                              departments={deptRows.filter((d) => d.company_id === c.id).map((d) => ({ name: d.name, count: d.count }))}
                              selected={c.departments}
                            />
                            <button type="submit">Save</button>
                          </form>
                        </details>
                      </td>
                      <td>{cj.length}</td>
                      <td><Link href={`/jobs?company=${c.id}`}>{matching.length}</Link></td>
                      <td>{fresh.length}</td>
                      <td className="hide-sm muted small">{c.lastSuccessAt ? (age(c.lastSuccessAt) === "today" ? "today" : `${age(c.lastSuccessAt)} ago`) : "never"}</td>
                      <td>
                        <form action={deleteCompanyAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button type="submit" className="danger small">Remove</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h2>Daily check</h2>
          <p className="muted small">
            Runs once a day. AI matching is {scoringEnabled() ? "on" : "off (set ANTHROPIC_API_KEY to turn it on)"}.
          </p>
          <RunNow />
        </>
      )}
    </>
  );
}
