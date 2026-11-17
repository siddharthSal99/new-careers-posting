import { currentUser } from "@/lib/auth";
import { getAnthropicKey, getSettings } from "@/lib/db";
import { STREAM_ERROR_MARK } from "@/lib/draft-protocol";
import { describeAnthropicError, streamDraft } from "@/lib/drafts";
import { listEssays } from "@/lib/essays";
import { getJobPage } from "@/lib/job-details";

export const dynamic = "force-dynamic";
export const maxDuration = 120;


const fail = (status: number, error: string) => Response.json({ error }, { status });

/**
 * Streams a draft answer for one essay question as plain text.
 * Body: { jobId, questionKey, referenceIds?: number[], guidance?: string, draft?: string }
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Log in again to generate drafts.");

  let body: { jobId?: unknown; questionKey?: unknown; referenceIds?: unknown; guidance?: unknown; draft?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Bad request.");
  }
  const job = await getJobPage(user.id, Number(body.jobId));
  if (!job) return fail(404, "Job not found.");
  const question = job.questions?.find((q) => q.key === body.questionKey && q.essay);
  if (!question) return fail(404, "That question isn't on this job's form.");

  const [apiKey, settings, essays] = await Promise.all([getAnthropicKey(user.id), getSettings(user.id), listEssays(user.id)]);
  if (!apiKey) return fail(400, "Add your Anthropic API key in Settings to generate drafts.");
  if (!settings.resume.trim()) return fail(400, "Paste your resume in Settings first; drafts are based on it.");

  // Only the user's own essays, at most 5, never this question's own saved answer (that's the draft).
  const wanted = new Set((Array.isArray(body.referenceIds) ? body.referenceIds : []).map(Number));
  const references = essays
    .filter((e) => wanted.has(e.id) && !(e.jobId === job.id && e.questionKey === question.key))
    .slice(0, 5);
  const guidance = typeof body.guidance === "string" ? body.guidance.slice(0, 2_000) : undefined;
  const draft = typeof body.draft === "string" ? body.draft.slice(0, 20_000) : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamDraft(apiKey, { job, question, resume: settings.resume, references, guidance, draft })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        console.error(`draft generation failed for user ${user.id}, job ${job.id}:`, (e as Error).message);
        controller.enqueue(encoder.encode(STREAM_ERROR_MARK + describeAnthropicError(e)));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
