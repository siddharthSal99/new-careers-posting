import { Resend } from "resend";

export interface DigestJob {
  company: string;
  title: string;
  location: string;
  department: string | null;
  url: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  repost: boolean;
  score: number | null;
  verdict: string | null;
  reason: string | null;
  blockers: string[] | null;
}

export interface BrokenSource {
  company: string;
  error: string;
  failures: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function jobRow(j: DigestJob) {
  const badges = [
    j.score !== null ? `<b>${j.score}/10</b>` : "",
    j.repost ? `<span style="color:#b45309">likely repost</span>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const posted = j.postedAt ? `posted ${j.postedAt.toISOString().slice(0, 10)}` : "";
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">
    <a href="${esc(j.url)}" style="font-weight:600;color:#1d4ed8;text-decoration:none">${esc(j.title)}</a>
    <span style="color:#555"> — ${esc(j.company)}</span><br>
    <span style="color:#666;font-size:13px">${esc([j.location, j.department, posted].filter(Boolean).join(" · "))}${badges ? " · " + badges : ""}</span>
    ${j.reason ? `<div style="font-size:13px;margin-top:2px">${esc(j.reason)}</div>` : ""}
    ${j.blockers?.length ? `<div style="font-size:13px;color:#b91c1c">Blockers: ${esc(j.blockers.join("; "))}</div>` : ""}
  </td></tr>`;
}

export function renderDigest(jobs: DigestJob[], broken: BrokenSource[], appUrl?: string) {
  const scored = jobs.some((j) => j.score !== null);
  const strong = scored ? jobs.filter((j) => j.verdict !== "skip") : jobs;
  const skipped = scored ? jobs.filter((j) => j.verdict === "skip") : [];
  strong.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.company.localeCompare(b.company));

  const parts: string[] = [];
  parts.push(`<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px">`);
  if (strong.length) {
    parts.push(`<h2 style="font-size:18px">${strong.length} new job${strong.length === 1 ? "" : "s"} for you</h2>`);
    parts.push(`<table style="width:100%;border-collapse:collapse">${strong.map(jobRow).join("")}</table>`);
  }
  if (skipped.length) {
    parts.push(`<details style="margin-top:16px"><summary style="color:#666">${skipped.length} more the AI rated a poor fit</summary>
      <table style="width:100%;border-collapse:collapse">${skipped.map(jobRow).join("")}</table></details>`);
  }
  if (broken.length) {
    parts.push(`<h3 style="font-size:15px;color:#b91c1c;margin-top:24px">Sources that are failing</h3><ul>${broken
      .map((b) => `<li>${esc(b.company)}: ${esc(b.error)} (${b.failures} runs in a row)</li>`)
      .join("")}</ul>`);
  }
  if (appUrl) parts.push(`<p style="color:#888;font-size:12px;margin-top:24px"><a href="${esc(appUrl)}">Open job tracker</a></p>`);
  parts.push(`</div>`);

  const subject = strong.length
    ? `${strong.length} new job${strong.length === 1 ? "" : "s"}: ${[...new Set(strong.map((j) => j.company))].slice(0, 3).join(", ")}`
    : skipped.length
      ? `${skipped.length} new job${skipped.length === 1 ? "" : "s"} (none rated a strong fit)`
      : `Job tracker: ${broken.length} source${broken.length === 1 ? "" : "s"} failing`;
  return { subject, html: parts.join("\n") };
}

/** Sends the digest. Without RESEND_API_KEY it logs the email instead and reports it as not sent. */
export async function sendDigest(to: string | null, subject: string, html: string): Promise<{ sent: boolean; info: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.log(`[email not sent: ${!key ? "RESEND_API_KEY missing" : "no email in settings"}] ${subject}`);
    return { sent: false, info: !key ? "RESEND_API_KEY not set" : "no email address in settings" };
  }
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "Job Tracker <onboarding@resend.dev>",
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return { sent: true, info: `sent (${data?.id})` };
}
