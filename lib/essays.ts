import { db } from "./db";

export interface Essay {
  id: number;
  jobId: number | null;
  questionKey: string | null;
  question: string;
  questionDescription: string;
  company: string;
  jobTitle: string;
  answer: string;
  updatedAt: Date;
}

function toEssay(r: Record<string, any>): Essay {
  return {
    id: r.id,
    jobId: r.job_id,
    questionKey: r.question_key,
    question: r.question,
    questionDescription: r.question_description,
    company: r.company,
    jobTitle: r.job_title,
    answer: r.answer,
    updatedAt: r.updated_at,
  };
}

/** Saves (or updates) the user's answer to one question on one job. Saving an empty answer deletes it. */
export async function saveJobEssay(
  userId: number,
  input: { jobId: number; questionKey: string; question: string; questionDescription: string; company: string; jobTitle: string; answer: string },
): Promise<Essay | null> {
  const sql = await db();
  if (!input.answer.trim()) {
    await sql`delete from essays where user_id = ${userId} and job_id = ${input.jobId} and question_key = ${input.questionKey}`;
    return null;
  }
  const [r] = await sql`
    insert into essays (user_id, job_id, question_key, question, question_description, company, job_title, answer)
    values (${userId}, ${input.jobId}, ${input.questionKey}, ${input.question}, ${input.questionDescription},
            ${input.company}, ${input.jobTitle}, ${input.answer})
    on conflict (user_id, job_id, question_key) where job_id is not null
    do update set answer = excluded.answer, question = excluded.question,
                  question_description = excluded.question_description, updated_at = now()
    returning *`;
  return toEssay(r);
}

export async function updateEssay(userId: number, essayId: number, answer: string): Promise<Essay | null> {
  const sql = await db();
  const [r] = await sql`
    update essays set answer = ${answer}, updated_at = now() where id = ${essayId} and user_id = ${userId} returning *`;
  return r ? toEssay(r) : null;
}

export async function deleteEssay(userId: number, essayId: number) {
  const sql = await db();
  await sql`delete from essays where id = ${essayId} and user_id = ${userId}`;
}

export async function essaysForJob(userId: number, jobId: number): Promise<Map<string, Essay>> {
  const sql = await db();
  const rows = await sql`select * from essays where user_id = ${userId} and job_id = ${jobId}`;
  return new Map(rows.map((r) => [r.question_key as string, toEssay(r)]));
}

export async function listEssays(userId: number): Promise<Essay[]> {
  const sql = await db();
  const rows = await sql`select * from essays where user_id = ${userId} order by updated_at desc`;
  return rows.map(toEssay);
}

// ---------- Finding past essays that are relevant to a new question ----------

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our please so tell than that the their them there these they this to us was we what when where which who why will with would you your yours about any also".split(
    " ",
  ),
);

// Broad kinds of question; two questions of the same kind are related even when they share few words
// (e.g. "Why Anthropic?" and "What excites you about working at OpenAI?").
const KINDS: [string, RegExp][] = [
  ["motivation", /\bwhy\b|\binterest(ed|s)?\b|\bexcit|\bmotivat|\bwant to (work|join)|\bdraws? you\b|\bpassion/i],
  ["cover-letter", /\bcover letter\b/i],
  ["project", /\bproject\b|\bsomething you('ve)? built\b|\bproud\b|\baccomplish|\bachievement\b/i],
  ["challenge", /\bchalleng|\bdifficult|\bfail(ure|ed)?\b|\bmistake\b|\bconflict\b|\bdisagree/i],
  ["impact", /\bimpact\b|\bmission\b|\bsafety\b|\bresponsib/i],
  ["additional", /\badditional information\b|\banything else\b/i],
];

function words(text: string, exclude: Set<string>) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !exclude.has(w)),
  );
}

function kindsOf(text: string) {
  return new Set(KINDS.filter(([, re]) => re.test(text)).map(([k]) => k));
}

/**
 * Picks up to `limit` of the user's saved essays most related to a question: same kind of question
 * (motivation, project, challenge…) counts most, then shared words in the question and help text.
 * Company names are ignored so "Why Anthropic?" matches "Why OpenAI?". With nothing related,
 * the most recent essays are returned as examples of the user's writing voice.
 */
export async function similarEssays(
  userId: number,
  q: { question: string; description: string; company: string; excludeJobId?: number },
  limit = 3,
): Promise<{ essays: Essay[]; related: boolean }> {
  const all = (await listEssays(userId)).filter((e) => e.jobId === null || e.jobId !== q.excludeJobId);
  if (!all.length) return { essays: [], related: false };
  const companies = new Set([q.company, ...all.map((e) => e.company)].flatMap((c) => c.toLowerCase().split(/\s+/)));
  const target = `${q.question} ${q.description}`;
  const targetWords = words(target, companies);
  const targetKinds = kindsOf(target);

  const scored = all.map((e) => {
    const ew = words(`${e.question} ${e.questionDescription}`, companies);
    const shared = [...ew].filter((w) => targetWords.has(w)).length;
    const overlap = shared / Math.max(1, Math.min(ew.size, targetWords.size));
    const sameKind = [...kindsOf(`${e.question} ${e.questionDescription}`)].some((k) => targetKinds.has(k));
    return { e, score: (sameKind ? 1 : 0) + overlap };
  });
  const related = scored.filter((s) => s.score >= 0.34).sort((a, b) => b.score - a.score || b.e.updatedAt.getTime() - a.e.updatedAt.getTime());
  if (related.length) return { essays: related.slice(0, limit).map((s) => s.e), related: true };
  return { essays: all.slice(0, Math.min(2, limit)), related: false };
}
