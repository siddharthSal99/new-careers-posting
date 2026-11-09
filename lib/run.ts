import { fetchBoard } from "./ats";
import { syncCompany } from "./companies";
import { db, getSettings, listCompanies } from "./db";
import { renderDigest, sendDigest, type BrokenSource, type DigestJob } from "./email";
import { mapLimit, scoringEnabled } from "./scoring";
import { backfillScores, resumeHash, scoreTargets, type ScoreTarget } from "./score-jobs";

export interface RunSummary {
  companies: { name: string; ok: boolean; total?: number; newMatching?: number; removed?: number; error?: string }[];
  scored: number;
  scoreErrors: number;
  /** Older open jobs scored with leftover time. */
  backfilled?: number;
  emailed: number;
  email: string;
}

/** Report a failing source in the email on its 2nd failure in a row, then once a week. */
function shouldReportFailure(failures: number) {
  return failures === 2 || (failures > 2 && (failures - 2) % 7 === 0);
}

export async function runDaily(opts: { dryRun?: boolean } = {}): Promise<RunSummary> {
  const startedAt = Date.now();
  const sql = await db();
  const settings = await getSettings();
  const companies = await listCompanies();
  const [run] = await sql`insert into runs default values returning id`;
  const summary: RunSummary = { companies: [], scored: 0, scoreErrors: 0, emailed: 0, email: "" };
  const broken: BrokenSource[] = [];

  // 1. Fetch every board (a few at a time) and diff it against what's stored.
  await mapLimit(companies, 4, async (c) => {
    try {
      const { jobs } = await fetchBoard(c.ats, c.boardToken);
      const [{ active }] = await sql`
        select count(*)::int as active from jobs where company_id = ${c.id} and removed_at is null`;
      // An empty board when we had open jobs is more likely an outage or a moved board than
      // every job closing at once, so don't record removals or treat it as a success.
      if (jobs.length === 0 && active > 0) throw new Error(`board returned 0 jobs (had ${active})`);
      const r = await syncCompany(c.id, c.departments, jobs, settings);
      await sql`update companies set last_success_at = now(), last_error = null, consecutive_failures = 0 where id = ${c.id}`;
      summary.companies.push({ name: c.name, ok: true, total: r.total, newMatching: r.newJobIds.length, removed: r.removed });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      const [u] = await sql`
        update companies set last_error = ${msg}, consecutive_failures = consecutive_failures + 1
        where id = ${c.id} returning consecutive_failures`;
      summary.companies.push({ name: c.name, ok: false, error: msg });
      if (shouldReportFailure(u.consecutive_failures)) broken.push({ company: c.name, error: msg, failures: u.consecutive_failures });
    }
  });

  // 2. Everything that passed the filters and hasn't been emailed yet (includes leftovers from a failed send).
  const pending = await sql`
    select j.*, c.name as company from jobs j join companies c on c.id = j.company_id
    where j.notified_at is null and j.removed_at is null
    order by j.first_seen_at`;

  // 3. Score with Claude when there's a key and a resume. Failures leave the job unscored, not dropped.
  if (scoringEnabled() && settings.resume.trim()) {
    const hash = resumeHash(settings.resume);
    const byId = new Map(companies.map((c) => [c.id, c]));
    const targets: ScoreTarget[] = pending
      .filter((j) => j.score === null || j.scored_resume_hash !== hash)
      .map((j) => {
        const c = byId.get(j.company_id)!;
        return {
          id: j.id, companyId: j.company_id, company: j.company, ats: c.ats, boardToken: c.boardToken,
          externalId: j.external_id, title: j.title, department: j.department, location: j.location, description: j.description,
        };
      });
    const res = await scoreTargets(targets, settings.resume, 150_000);
    for (const j of pending) {
      const m = res.results.get(j.id);
      if (m) Object.assign(j, { score: m.score, verdict: m.verdict, reason: m.reason, blockers: m.blockers });
    }
    summary.scored += res.scored;
    summary.scoreErrors += res.failed;
  }

  // 4. Email only when there's something to say.
  if (pending.length === 0 && broken.length === 0) {
    summary.email = "nothing new; no email";
  } else {
    const digest: DigestJob[] = pending.map((j) => ({
      company: j.company,
      title: j.title,
      location: j.location,
      department: j.department,
      url: j.url,
      postedAt: j.posted_at,
      firstSeenAt: j.first_seen_at,
      repost: j.repost_of !== null,
      score: j.score,
      verdict: j.verdict,
      reason: j.reason,
      blockers: j.blockers,
    }));
    const { subject, html } = renderDigest(digest, broken, process.env.APP_URL);
    if (opts.dryRun) {
      summary.email = `dry run: would send "${subject}"`;
    } else {
      try {
        const res = await sendDigest(settings.email, subject, html);
        summary.email = res.info;
        if (res.sent && pending.length) {
          const ids = pending.map((j) => j.id as number);
          await sql`update jobs set notified_at = now() where id = any(${ids})`;
          summary.emailed = ids.length;
        }
      } catch (e) {
        summary.email = `send failed: ${(e as Error).message}`;
      }
    }
  }

  // 5. Use leftover time to score older open jobs, so the Jobs page fills in over a few days.
  const elapsed = Date.now() - startedAt;
  if (!opts.dryRun && scoringEnabled() && settings.resume.trim() && elapsed < 150_000) {
    try {
      const b = await backfillScores({ budgetMs: Math.min(90_000, 200_000 - elapsed) });
      summary.backfilled = b.scored;
    } catch (e) {
      console.error("backfill failed:", (e as Error).message);
    }
  }

  await sql`update runs set finished_at = now(), summary = ${sql.json(summary as any)} where id = ${run.id}`;
  return summary;
}
