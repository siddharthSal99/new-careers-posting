import { Resend } from "resend";

export interface DigestJob {
  company: string;
  title: string;
  location: string;
  department: string | null;
  url: string;
  postedAt: Date | null;
  repost: boolean;
  score: number | null;
  /** AI matching is on but this job couldn't be scored. */
  unscored?: boolean;
  reason: string | null;
  blockers: string[] | null;
}

export interface BrokenSource {
  company: string;
  error: string;
  failures: number;
}

export interface MoreLine {
  company: string;
  count: number;
  /** Link to this company's new jobs in the app, when APP_URL is set. */
  href: string | null;
}

export interface Digest {
  /** The jobs listed in full, best first. */
  shown: DigestJob[];
  /** New matching jobs not listed, per company. */
  more: MoreLine[];
  /** New jobs that passed the filters this time (listed or not). */
  totalNew: number;
  /** How many of those scored below the threshold; null when AI matching is off. */
  belowThreshold: number | null;
  threshold: number | null;
  broken: BrokenSource[];
  /** Shown when AI scoring is on but some listed jobs couldn't be scored. */
  scoringProblem: string | null;
  /** Link to all new jobs in the app, when APP_URL is set. */
  allHref: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function jobRow(j: DigestJob) {
  const badges = [
    j.score !== null ? `<b>${j.score}/10</b>` : j.unscored ? `<span style="color:#666">not scored</span>` : "",
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

export function renderDigest(d: Digest) {
  const { shown, more, broken } = d;
  const hidden = more.reduce((n, m) => n + m.count, 0);
  const parts: string[] = [];
  parts.push(`<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px">`);

  if (shown.length) {
    // Only claim the threshold when every listed job was actually scored.
    const heading =
      d.threshold !== null && shown.every((j) => j.score !== null)
        ? `${plural(shown.length, "new job")} scoring ${d.threshold}/10 or higher`
        : `${plural(shown.length, "new job")} for you`;
    parts.push(`<h2 style="font-size:18px;margin-bottom:4px">${heading}</h2>`);
    if (hidden > 0) {
      const note = [`${d.totalNew} new jobs matched your filters`];
      if (d.belowThreshold) note.push(`${d.belowThreshold} scored below ${d.threshold}/10`);
      parts.push(`<p style="color:#666;font-size:13px;margin-top:0">${esc(note.join("; "))}. These are the top ${shown.length}.</p>`);
    }
    parts.push(`<table style="width:100%;border-collapse:collapse">${shown.map(jobRow).join("")}</table>`);
  }

  if (d.scoringProblem) {
    parts.push(`<p style="color:#b45309;font-size:13px">${esc(d.scoringProblem)}</p>`);
  }

  if (more.length) {
    parts.push(`<h3 style="font-size:15px;margin-top:24px">More new jobs in the app</h3><ul style="padding-left:18px">`);
    for (const m of more) {
      const label = `${esc(m.company)}: ${plural(m.count, "more job")}`;
      parts.push(`<li>${m.href ? `<a href="${esc(m.href)}" style="color:#1d4ed8">${label}</a>` : label}</li>`);
    }
    parts.push(`</ul>`);
    if (d.allHref) parts.push(`<p><a href="${esc(d.allHref)}" style="color:#1d4ed8">See all new jobs, sorted by fit</a></p>`);
  }

  if (broken.length) {
    parts.push(`<h3 style="font-size:15px;color:#b91c1c;margin-top:24px">Sources that are failing</h3><ul>${broken
      .map((b) => `<li>${esc(b.company)}: ${esc(b.error)} (${b.failures} runs in a row)</li>`)
      .join("")}</ul>`);
  }
  parts.push(`</div>`);

  const companies = [...new Set(shown.map((j) => j.company))];
  const names = companies.slice(0, 3).join(", ") + (companies.length > 3 ? ` +${companies.length - 3}` : "");
  const subject = shown.length
    ? hidden > 0
      ? `Top ${shown.length} of ${d.totalNew} new jobs: ${names}`
      : `${plural(shown.length, "new job")}: ${names}`
    : `Job tracker: ${plural(broken.length, "source")} failing`;
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
