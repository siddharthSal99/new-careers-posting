import { fetchBoard } from "./ats";
import { syncBoard } from "./companies";
import { db, getAnthropicKey, getSettings, listSubscriptions } from "./db";
import { renderDigest, sendDigest, type BrokenSource, type DigestJob } from "./email";
import { applyFilters } from "./filters";
import { backfillScores, resumeHash, scoreTargets, type ScoreTarget } from "./score-jobs";
import { mapLimit } from "./scoring";

export interface BoardResult {
  name: string;
  ok: boolean;
  total?: number;
  added?: number;
  removed?: number;
  error?: string;
}

export interface UserResult {
  userId: number;
  newMatching: number;
  scored: number;
  scoreErrors: number;
  /** Older open jobs scored with leftover time. */
  backfilled?: number;
  emailed: number;
  email: string;
}

export interface RunSummary {
  boards: BoardResult[];
  users: UserResult[];
}

// Vercel stops the function at 300 s; leave room for the last requests to finish.
const RUN_BUDGET_MS = 240_000;

/** Report a failing source in the email on its 2nd failure in a row, then once a week. */
function shouldReportFailure(failures: number) {
  return failures === 2 || (failures > 2 && (failures - 2) % 7 === 0);
}

/**
 * The daily check. Without `userId`: every board anyone tracks, then every user's digest (the cron job).
 * With `userId`: only that user's boards and digest ("Run daily check now").
 */
export async function runDaily(opts: { dryRun?: boolean; userId?: number } = {}): Promise<RunSummary> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const sql = await db();
  const [run] = await sql`insert into runs default values returning id`;
  const summary: RunSummary = { boards: [], users: [] };

  // 1. Fetch each board once and diff it against what's stored.
  const boards = await sql`
    select c.id, c.ats, c.board_token, min(s.name) as name from companies c
    join subscriptions s on s.company_id = c.id
    ${opts.userId ? sql`where c.id in (select company_id from subscriptions where user_id = ${opts.userId})` : sql``}
    group by c.id`;
  await mapLimit(boards, 4, async (b) => {
    try {
      const { jobs } = await fetchBoard(b.ats, b.board_token);
      const [{ active }] = await sql`select count(*)::int as active from jobs where company_id = ${b.id} and removed_at is null`;
      // An empty board when there were open jobs is more likely an outage or a moved board than
      // every job closing at once, so don't record removals or treat it as a success.
      if (jobs.length === 0 && active > 0) throw new Error(`board returned 0 jobs (had ${active})`);
      const r = await syncBoard(b.id, jobs);
      await sql`update companies set last_success_at = now(), last_error = null, consecutive_failures = 0 where id = ${b.id}`;
      summary.boards.push({ name: b.name, ok: true, total: r.total, added: r.added, removed: r.removed });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await sql`update companies set last_error = ${msg}, consecutive_failures = consecutive_failures + 1 where id = ${b.id}`;
      summary.boards.push({ name: b.name, ok: false, error: msg });
    }
  });

  // 2. Each user's digest.
  const users = opts.userId
    ? [{ id: opts.userId }]
    : await sql`select id from users u where exists (select 1 from subscriptions s where s.user_id = u.id) order by id`;
  for (const [i, u] of users.entries()) {
    const share = Math.max(15_000, (deadline - Date.now()) / (users.length - i));
    try {
      summary.users.push(await processUser(u.id, Math.min(share, 120_000), !!opts.dryRun));
    } catch (e) {
      console.error(`digest failed for user ${u.id}:`, e);
      summary.users.push({ userId: u.id, newMatching: 0, scored: 0, scoreErrors: 0, emailed: 0, email: `failed: ${(e as Error).message}` });
    }
  }

  // 3. Use leftover time to score older open jobs, so Jobs pages fill in over a few days.
  if (!opts.dryRun) {
    for (const [i, r] of summary.users.entries()) {
      const left = deadline - Date.now();
      if (left < 20_000) break;
      try {
        const b = await backfillScores(r.userId, { budgetMs: Math.min(90_000, left / (summary.users.length - i)) });
        if (b.ok) r.backfilled = b.scored;
      } catch (e) {
        console.error(`backfill failed for user ${r.userId}:`, (e as Error).message);
      }
    }
  }

  await sql`update runs set finished_at = now(), summary = ${sql.json(summary as any)} where id = ${run.id}`;
  return summary;
}

async function processUser(userId: number, scoreBudgetMs: number, dryRun: boolean): Promise<UserResult> {
  const sql = await db();
  const [settings, subs, apiKey] = await Promise.all([getSettings(userId), listSubscriptions(userId), getAnthropicKey(userId)]);
  const result: UserResult = { userId, newMatching: 0, scored: 0, scoreErrors: 0, emailed: 0, email: "" };
  const subByBoard = new Map(subs.map((s) => [s.boardId, s]));

  // Jobs that appeared after the user started tracking the board and haven't been handled for them yet.
  const candidates = await sql`
    select j.*, uj.score, uj.verdict, uj.reason, uj.blockers, uj.scored_resume_hash
    from jobs j
    join subscriptions s on s.company_id = j.company_id and s.user_id = ${userId}
    left join user_jobs uj on uj.job_id = j.id and uj.user_id = ${userId}
    where j.removed_at is null and j.first_seen_at > s.created_at and uj.notified_at is null
    order by j.first_seen_at`;
  const pending = candidates.filter((j) => {
    const s = subByBoard.get(j.company_id)!;
    return applyFilters({ title: j.title, department: j.department, location: j.location, isRemote: j.is_remote }, settings, s.departments).pass;
  });
  const filteredOut = candidates.filter((j) => !pending.includes(j)).map((j) => j.id as number);
  // Jobs that fail the filters are never emailed, even if the filters change later.
  if (filteredOut.length && !dryRun) {
    await sql`
      insert into user_jobs (user_id, job_id, notified_at) select ${userId}, unnest(${filteredOut}::int[]), now()
      on conflict (user_id, job_id) do update set notified_at = now()`;
  }
  result.newMatching = pending.length;

  // Score with the user's own key. Failures leave the job unscored, not dropped.
  if (apiKey && settings.resume.trim() && pending.length) {
    const hash = resumeHash(settings.resume);
    const targets: ScoreTarget[] = pending
      .filter((j) => j.score === null || j.scored_resume_hash !== hash)
      .map((j) => {
        const s = subByBoard.get(j.company_id)!;
        return {
          jobId: j.id, boardId: j.company_id, company: s.name, ats: s.ats, boardToken: s.boardToken,
          externalId: j.external_id, title: j.title, department: j.department, location: j.location, description: j.description,
        };
      });
    const res = await scoreTargets(userId, apiKey, settings.resume, targets, scoreBudgetMs);
    for (const j of pending) {
      const m = res.results.get(j.id);
      if (m) Object.assign(j, { score: m.score, verdict: m.verdict, reason: m.reason, blockers: m.blockers });
    }
    result.scored = res.scored;
    result.scoreErrors = res.failed;
  }

  const broken: BrokenSource[] = subs
    .filter((s) => s.lastError && shouldReportFailure(s.consecutiveFailures))
    .map((s) => ({ company: s.name, error: s.lastError!, failures: s.consecutiveFailures }));

  if (pending.length === 0 && broken.length === 0) {
    result.email = "nothing new; no email";
    return result;
  }
  const digest: DigestJob[] = pending.map((j) => ({
    company: subByBoard.get(j.company_id)!.name,
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
  if (dryRun) {
    result.email = `dry run: would send "${subject}"`;
    return result;
  }
  try {
    const res = await sendDigest(settings.email, subject, html);
    result.email = res.info;
    if (res.sent && pending.length) {
      const ids = pending.map((j) => j.id as number);
      await sql`
        insert into user_jobs (user_id, job_id, notified_at) select ${userId}, unnest(${ids}::int[]), now()
        on conflict (user_id, job_id) do update set notified_at = now()`;
      result.emailed = ids.length;
    }
  } catch (e) {
    result.email = `send failed: ${(e as Error).message}`;
  }
  return result;
}
