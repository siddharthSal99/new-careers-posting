import { fetchWithTimeout } from "../http";
import type { AtsKind, BoardRef } from "../types";
import { fetchBoard } from "./index";

const PATTERNS: { ats: AtsKind; re: RegExp }[] = [
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/g },
  { ats: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._-]+)/g },
  { ats: "greenhouse", re: /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/g },
  { ats: "lever", re: /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9._-]+)/g },
  { ats: "lever", re: /api\.(?:eu\.)?lever\.co\/v0\/postings\/([A-Za-z0-9._-]+)/g },
  { ats: "greenhouse", re: /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([A-Za-z0-9_-]+)/g },
  { ats: "greenhouse", re: /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?!embed\b)([A-Za-z0-9_-]+)/g },
];

/** Finds a board reference written directly in a URL or in page HTML. */
export function findBoardRefs(text: string): BoardRef[] {
  const counts = new Map<string, { ref: BoardRef; n: number }>();
  for (const { ats, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const token = m[1];
      if (["embed", "api", "v1", "static", "assets"].includes(token.toLowerCase())) continue;
      const key = `${ats}:${token.toLowerCase()}`;
      const cur = counts.get(key) ?? { ref: { ats, token }, n: 0 };
      cur.n++;
      counts.set(key, cur);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.ref);
}

/** Board names worth trying for a company domain, e.g. careers.openai.com -> ["openai"]. */
export function guessTokens(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".");
  const skip = new Set(["careers", "jobs", "join", "work", "about", "apply", "boards", "job-boards"]);
  const core = labels.slice(0, -1).filter((l) => !skip.has(l));
  const main = core[core.length - 1];
  if (!main) return [];
  return [...new Set([main, main.replace(/-/g, ""), main.replace(/-/g, "_")])];
}

export interface Detection {
  ref: BoardRef;
  how: "url" | "page" | "guess" | "search";
}

/**
 * Works out which job board a careers URL points to.
 * 1. The URL is itself a Greenhouse/Ashby board URL.
 * 2. The careers page links to or embeds a board.
 * 3. Guess the board name from the domain and check whether that board exists.
 */
export async function detectBoard(input: string): Promise<{ detection: Detection | null; notes: string[] }> {
  const notes: string[] = [];
  let url: URL;
  try {
    url = new URL(input.trim().match(/^https?:\/\//) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return { detection: null, notes: ["That doesn't look like a URL."] };
  }

  const direct = findBoardRefs(url.href)[0];
  if (direct) return { detection: { ref: direct, how: "url" }, notes };

  if (!isPublicHttpUrl(url)) return { detection: null, notes: ["That address isn't a public website."] };
  try {
    const res = await fetchWithTimeout(url.href, 15_000, {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36" },
    });
    if (res.ok) {
      const refs = findBoardRefs(await res.text());
      for (const ref of refs.slice(0, 3)) {
        if (await boardExists(ref)) return { detection: { ref, how: "page" }, notes };
      }
      notes.push("The careers page loaded but didn't mention a Greenhouse, Ashby or Lever board.");
    } else {
      notes.push(`The careers page refused the request (HTTP ${res.status}); trying to guess the board name instead.`);
    }
  } catch (e) {
    notes.push(`Couldn't load the careers page (${(e as Error).message}); trying to guess the board name instead.`);
  }

  for (const token of guessTokens(url.hostname)) {
    for (const ats of ["ashby", "greenhouse", "lever"] as const) {
      const ref = { ats, token };
      if (await boardExists(ref)) return { detection: { ref, how: "guess" }, notes };
    }
  }
  notes.push("No Greenhouse, Ashby or Lever board found. Paste the board URL itself (e.g. jobs.ashbyhq.com/company or jobs.lever.co/company).");
  return { detection: null, notes };
}

async function boardExists(ref: BoardRef): Promise<boolean> {
  const url =
    ref.ats === "ashby"
      ? `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.token)}`
      : ref.ats === "lever"
        ? `https://api.lever.co/v0/postings/${encodeURIComponent(ref.token)}?mode=json&limit=1`
        : `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs`;
  try {
    const res = await fetchWithTimeout(url, 30_000);
    if (!res.ok) return false;
    // Require at least one job: guessed names can match unrelated, empty boards.
    const body = (await res.json()) as { jobs?: unknown[] } | unknown[];
    // Lever returns a bare array of postings.
    const jobs = Array.isArray(body) ? body : body.jobs;
    return Array.isArray(jobs) && jobs.length > 0;
  } catch {
    return false;
  }
}

export async function previewBoard(ref: BoardRef) {
  const { jobs, tooOld, companyName } = await fetchBoard(ref.ats, ref.token);
  const departments = new Map<string, number>();
  for (const j of jobs) {
    const d = j.department ?? "(none)";
    departments.set(d, (departments.get(d) ?? 0) + 1);
  }
  return {
    jobs,
    tooOld,
    companyName: companyName ?? ref.token.charAt(0).toUpperCase() + ref.token.slice(1),
    departments: [...departments.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}

// ---------- Guessing a board from a company name (used by Discover) ----------

/** Board names worth trying for a company name, e.g. "Black Forest Labs" -> black-forest-labs, blackforestlabs, … */
export function nameTokens(name: string): string[] {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.(ai|io|com|co|app|art)$/, "");
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const core = words.filter((w) => !["inc", "ltd", "llc", "the", "co", "corp", "hq"].includes(w));
  const w = core.length ? core : words;
  const out = [
    w.join(""),
    w.join("-"),
    `${w.join("")}ai`,
    `${w.join("-")}-ai`,
    `${w.join("")}labs`,
    `${w.join("")}hq`,
    w.length > 1 ? w[0] : "",
    // "Kling AI" -> kling; "Inworld AI" -> inworld
    w.length > 1 && /^(ai|labs|studios?|technologies|tech)$/.test(w[w.length - 1]) ? w.slice(0, -1).join("") : "",
  ];
  return [...new Set(out.filter((t) => t.length >= 2))];
}

/** Tries likely board names from a company's URL (if any) and name on every supported platform. Free: public APIs only. */
export async function guessBoard(name: string, urlHint?: string | null): Promise<Detection | null> {
  const tokens: string[] = [];
  if (urlHint) {
    try {
      tokens.push(...guessTokens(new URL(/^https?:\/\//.test(urlHint) ? urlHint : `https://${urlHint}`).hostname));
    } catch {
      // not a URL; use the name only
    }
  }
  tokens.push(...nameTokens(name));
  for (const token of [...new Set(tokens)]) {
    const found = await Promise.all((["ashby", "greenhouse", "lever"] as const).map(async (ats) => ((await boardExists({ ats, token })) ? ats : null)));
    const ats = found.find(Boolean);
    if (ats) return { ref: { ats, token }, how: "guess" };
  }
  return null;
}

/**
 * Whether a URL is safe for the server to fetch: http(s) on a public hostname. Pages come from user input,
 * screenshots and web search, so internal addresses (localhost, private IPs, cloud metadata) are refused.
 */
export function isPublicHttpUrl(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h.includes(":")) return false; // IPv6 literals
  return true;
}
