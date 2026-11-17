import { decodeEntities, fetchJson, fetchWithTimeout, htmlToText } from "../http";
import type { AtsKind } from "../types";

/** One question on a job's application form. */
export interface AppQuestion {
  /** Stable id from the platform (field name or path). */
  key: string;
  label: string;
  /** Plain-text help text under the question, e.g. "great answers are often 200-400 words". */
  description: string;
  required: boolean;
  /** Free-text, long-answer question (an essay). */
  essay: boolean;
  links: { text: string; href: string }[];
}

export interface JobDetails {
  salary: string | null;
  questions: AppQuestion[];
}

function linksIn(html: string) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: decodeEntities(m[1]), text: htmlToText(m[2]) || decodeEntities(m[1]) }))
    .filter((l) => /^https?:\/\//.test(l.href));
}

function money(cents: number, currency: string) {
  const n = cents / 100;
  const short = n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n));
  return currency === "USD" ? `$${short}` : short;
}

// ---------- Greenhouse: official job board API ----------

interface GhQuestion {
  label: string;
  description?: string | null;
  required: boolean;
  fields: { name: string; type: string }[];
}

async function greenhouseDetails(token: string, jobId: string): Promise<JobDetails> {
  const d = await fetchJson<{
    questions?: GhQuestion[];
    pay_input_ranges?: { min_cents: number; max_cents: number; currency_type: string; title?: string | null }[];
  }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}?questions=true&pay_transparency=true`,
  );

  const ranges = d.pay_input_ranges ?? [];
  const salary = ranges.length
    ? ranges
        .map((r) => {
          const suffix = r.currency_type === "USD" ? "" : ` ${r.currency_type}`;
          const range = `${money(r.min_cents, r.currency_type)} – ${money(r.max_cents, r.currency_type)}${suffix}`;
          const title = (r.title ?? "").replace(/:\s*$/, "").trim();
          return ranges.length > 1 && title ? `${title}: ${range}` : range;
        })
        .join("; ")
    : null;

  const questions = (d.questions ?? []).map((q): AppQuestion => {
    const types = q.fields.map((f) => f.type);
    const descHtml = decodeEntities(q.description ?? "");
    // A textarea is an essay, except where it's the paste-instead-of-upload alternative for a resume.
    const essay = types.includes("textarea") && (!types.includes("input_file") || /cover letter/i.test(q.label));
    return {
      key: q.fields[0]?.name ?? q.label,
      label: q.label.trim(),
      description: htmlToText(descHtml),
      required: q.required,
      essay,
      links: linksIn(descHtml),
    };
  });
  return { salary, questions };
}

// ---------- Ashby: the (unofficial) GraphQL API its hosted job pages use ----------

const ASHBY_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    applicationForm { sections { fieldEntries { ... on FormFieldEntry { id field isRequired descriptionHtml } } } }
  }
}`;

interface AshbyFieldEntry {
  id?: string;
  field?: { path?: string; title?: string; type?: string };
  isRequired?: boolean;
  descriptionHtml?: string | null;
}

async function ashbyDetails(token: string, jobId: string): Promise<JobDetails> {
  const res = await fetchWithTimeout("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", 30_000, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      operationName: "ApiJobPosting",
      variables: { organizationHostedJobsPageName: token, jobPostingId: jobId },
      query: ASHBY_QUERY,
    }),
  });
  if (!res.ok) throw new Error(`Ashby returned ${res.status}`);
  const body = (await res.json()) as {
    errors?: { message: string }[];
    data?: { jobPosting?: { applicationForm?: { sections: { fieldEntries: AshbyFieldEntry[] }[] } } | null };
  };
  if (body.errors?.length) throw new Error(`Ashby: ${body.errors[0].message}`);
  const form = body.data?.jobPosting?.applicationForm;
  if (!form) throw new Error("Ashby didn't return an application form for this job");
  const questions = form.sections.flatMap((s) =>
    s.fieldEntries
      .filter((e) => e.field?.title)
      .map((e): AppQuestion => {
        const descHtml = e.descriptionHtml ?? "";
        return {
          key: e.field!.path ?? e.id ?? e.field!.title!,
          label: e.field!.title!.trim(),
          description: htmlToText(descHtml),
          required: !!e.isRequired,
          essay: e.field!.type === "LongText",
          links: linksIn(descHtml),
        };
      }),
  );
  // Ashby's pay range comes from the official list API instead (stored on the job at sync).
  return { salary: null, questions };
}

export async function fetchJobDetails(ats: AtsKind, token: string, externalId: string): Promise<JobDetails> {
  return ats === "greenhouse" ? greenhouseDetails(token, externalId) : ashbyDetails(token, externalId);
}

/** A question about the company's policy on using AI in the application, if the form has one. */
export function aiPolicyQuestion(questions: AppQuestion[]) {
  return (
    questions.find((q) => {
      const text = `${q.label} ${q.description}`;
      return (
        !q.essay &&
        /\b(AI|artificial intelligence|Claude|ChatGPT|LLMs?)\b/i.test(text) &&
        /\b(polic|guideline|use of|using|generat)/i.test(text)
      );
    }) ?? null
  );
}
