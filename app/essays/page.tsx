import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listEssays } from "@/lib/essays";
import { deleteEssayAction, updateEssayAction } from "../actions";
import { EssayEditor } from "../essay-editor";

export const dynamic = "force-dynamic";

export default async function EssaysPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser("/essays");
  const q = ((await searchParams).q ?? "").trim();
  const all = await listEssays(user.id);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = terms.length
    ? all.filter((e) => {
        const hay = `${e.question} ${e.company} ${e.jobTitle} ${e.answer}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
    : all;

  return (
    <>
      <h1>Essays</h1>
      <p className="muted small">
        Your saved answers to application questions. They're kept after the job itself is gone, and the most relevant ones are used
        as reference when you generate a draft for a new question.
      </p>
      {all.length > 0 && (
        <form method="get" action="/essays" className="row" style={{ marginBottom: 12 }}>
          <input type="text" name="q" defaultValue={q} placeholder="Search questions, companies and answers" style={{ flex: "1 1 240px", width: "auto" }} />
          <button type="submit">Search</button>
          {q && <Link href="/essays" className="small">Clear</Link>}
        </form>
      )}
      {all.length === 0 && (
        <p className="notice">No saved essays yet. Open a job from the <Link href="/jobs">Jobs</Link> page to answer its essay questions.</p>
      )}
      {q && <p className="muted small">{shown.length} of {all.length} essays match.</p>}
      {shown.map((e) => (
        <details key={e.id} className="panel" style={{ marginBottom: 10 }}>
          <summary>
            <b>{e.question}</b>
            <div className="muted small" style={{ marginLeft: 16 }}>
              {e.company}
              {e.jobTitle && ` · ${e.jobTitle}`} · {e.answer.trim().split(/\s+/).length} words · updated {e.updatedAt.toISOString().slice(0, 10)}
            </div>
          </summary>
          <div style={{ marginTop: 10 }}>
            {e.jobId ? (
              <p className="small" style={{ marginTop: 0 }}>
                <Link href={`/jobs/${e.jobId}`}>Open the job →</Link>
              </p>
            ) : (
              <p className="muted small" style={{ marginTop: 0 }}>The job for this essay has been removed.</p>
            )}
            {e.questionDescription && <p className="muted small" style={{ whiteSpace: "pre-wrap" }}>{e.questionDescription}</p>}
            <EssayEditor
              initialAnswer={e.answer}
              initialSavedAt={e.updatedAt.toISOString()}
              hint={`${e.question} ${e.questionDescription}`}
              save={updateEssayAction.bind(null, e.id)}
              remove={deleteEssayAction.bind(null, e.id)}
            />
          </div>
        </details>
      ))}
    </>
  );
}
