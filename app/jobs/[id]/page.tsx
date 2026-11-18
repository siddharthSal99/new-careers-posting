import Link from "next/link";
import { notFound } from "next/navigation";
import { aiPolicyQuestion } from "@/lib/ats/details";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { essaysForJob, listEssays, similarEssays, type Essay } from "@/lib/essays";
import { getJobPage } from "@/lib/job-details";
import { saveJobEssayAction } from "../../actions";
import { JobEssay } from "./job-essay";

const refLabel = (e: Essay) => `${e.company}: ${e.question.length > 50 ? `${e.question.slice(0, 50)}…` : e.question}`;
import { age } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id;
  const user = await requireUser(`/jobs/${encodeURIComponent(rawId)}`);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const job = await getJobPage(user.id, id);
  if (!job) notFound();

  const questions = job.questions ?? [];
  const essays = questions.filter((q) => q.essay);
  const aiPolicy = aiPolicyQuestion(questions);
  const otherRequired = questions.filter((q) => !q.essay && q.required && q !== aiPolicy);
  const posted = job.postedAt ?? job.firstSeenAt;
  const [saved, settings, library] = await Promise.all([essaysForJob(user.id, job.id), getSettings(user.id), listEssays(user.id)]);
  const cantGenerateReason = !settings.anthropicKeyHint
    ? "Add your Anthropic API key to generate drafts:"
    : !settings.resume.trim()
      ? "Paste your resume to generate drafts:"
      : null;
  const suggestions = new Map(
    await Promise.all(
      essays.map(async (q) => [q.key, await similarEssays(user.id, { question: q.label, description: q.description, company: job.company, excludeJobId: job.id })] as const),
    ),
  );
  const libraryRefs = library.filter((e) => e.jobId !== job.id).map((e) => ({ id: e.id, label: refLabel(e) }));

  return (
    <>
      <p className="small" style={{ marginTop: 0 }}>
        <Link href={`/jobs?company=${job.subscriptionId}`}>← {job.company} jobs</Link>
      </p>
      <h1 style={{ marginBottom: 4 }}>{job.title}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {[job.company, job.department, job.location].filter(Boolean).join(" · ")}
      </p>
      {job.removedAt && <p className="notice error">This job was taken down on {job.removedAt.toISOString().slice(0, 10)}.</p>}

      <div className="panel job-facts">
        <div>
          <div className="muted small">Salary</div>
          <div>{job.salary ?? <span className="muted">Not posted</span>}</div>
        </div>
        <div>
          <div className="muted small">Posted</div>
          <div title={posted.toISOString().slice(0, 10)}>
            {age(posted) === "today" ? "today" : `${age(posted)} ago`}{" "}
            {!job.isBaseline && <span className="chip good">new</span>} {job.repost && <span className="chip warn">likely repost</span>}
          </div>
        </div>
        <div>
          <div className="muted small">Fit</div>
          <div>
            {job.score !== null ? (
              <span className={`chip ${job.verdict === "strong" ? "good" : job.verdict === "skip" ? "bad" : "warn"}`}>{job.score}/10</span>
            ) : (
              <span className="muted">Not scored</span>
            )}
          </div>
        </div>
        <div className="job-apply">
          <a className="button" href={job.applyUrl} target="_blank" rel="noreferrer">Apply on {job.company}'s site ↗</a>
        </div>
      </div>
      {(job.reason || job.blockers?.length) && (
        <div className="small" style={{ margin: "8px 2px" }}>
          {job.reason && <div>{job.reason}</div>}
          {job.blockers && job.blockers.length > 0 && <div className="error">Blockers: {job.blockers.join("; ")}</div>}
        </div>
      )}

      <h2>Application questions</h2>
      {job.questionsUnavailable && <p className="notice small">{job.questionsUnavailable}</p>}
      {job.detailsError && !job.questions && (
        <p className="notice small">Couldn't load this job's application form ({job.detailsError}). Use the Apply button to see it on the company's site.</p>
      )}
      {aiPolicy && (
        <div className="notice small">
          <b>{job.company} has a policy on using AI in applications.</b> Read it before using generated drafts.
          <div style={{ marginTop: 4 }}>{aiPolicy.description || aiPolicy.label}</div>
          {aiPolicy.links.map((l) => (
            <div key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer">{l.text} ↗</a>
            </div>
          ))}
        </div>
      )}
      {job.questions && essays.length === 0 && <p className="muted small">This application has no essay questions.</p>}
      {essays.map((q) => {
        const essay = saved.get(q.key);
        return (
          <div key={q.key} className="panel" style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>
              {q.label} {q.required ? <span className="chip warn">required</span> : <span className="chip">optional</span>}
            </div>
            {q.description && <p className="muted small" style={{ whiteSpace: "pre-wrap" }}>{q.description}</p>}
            <JobEssay
              jobId={job.id}
              questionKey={q.key}
              hint={`${q.label} ${q.description}`}
              initialAnswer={essay?.answer ?? ""}
              initialSavedAt={essay?.updatedAt.toISOString() ?? null}
              save={saveJobEssayAction.bind(null, job.id, q.key)}
              canGenerate={!cantGenerateReason}
              cantGenerateReason={cantGenerateReason}
              suggested={(suggestions.get(q.key)?.essays ?? []).map((e) => ({ id: e.id, label: refLabel(e) }))}
              related={suggestions.get(q.key)?.related ?? false}
              library={libraryRefs}
            />
          </div>
        );
      })}
      {otherRequired.length > 0 && (
        <details className="small" style={{ margin: "12px 0" }}>
          <summary>Other required questions on the form ({otherRequired.length})</summary>
          <ul>
            {otherRequired.map((q) => <li key={q.key}>{q.label}</li>)}
          </ul>
        </details>
      )}

      <h2>Job description</h2>
      <div className="panel small" style={{ whiteSpace: "pre-wrap" }}>
        {job.description ?? <span className="muted">No description saved. See the company's site.</span>}
      </div>
    </>
  );
}
