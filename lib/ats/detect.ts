import { fetchWithTimeout } from "../http";
import type { AtsKind, BoardRef } from "../types";
import { fetchBoard } from "./index";

const PATTERNS: { ats: AtsKind; re: RegExp }[] = [
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/g },
  { ats: "ashby", re: /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._-]+)/g },
  { ats: "greenhouse", re: /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/g },
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
  how: "url" | "page" | "guess";
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

  try {
    const res = await fetchWithTimeout(url.href, 15_000, {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36" },
    });
    if (res.ok) {
      const refs = findBoardRefs(await res.text());
      for (const ref of refs.slice(0, 3)) {
        if (await boardExists(ref)) return { detection: { ref, how: "page" }, notes };
      }
      notes.push("The careers page loaded but didn't mention a Greenhouse or Ashby board.");
    } else {
      notes.push(`The careers page refused the request (HTTP ${res.status}); trying to guess the board name instead.`);
    }
  } catch (e) {
    notes.push(`Couldn't load the careers page (${(e as Error).message}); trying to guess the board name instead.`);
  }

  for (const token of guessTokens(url.hostname)) {
    for (const ats of ["ashby", "greenhouse"] as const) {
      const ref = { ats, token };
      if (await boardExists(ref)) return { detection: { ref, how: "guess" }, notes };
    }
  }
  notes.push("No Greenhouse or Ashby board found. Paste the board URL itself (e.g. jobs.ashbyhq.com/company).");
  return { detection: null, notes };
}

async function boardExists(ref: BoardRef): Promise<boolean> {
  const url =
    ref.ats === "ashby"
      ? `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ref.token)}`
      : `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs`;
  try {
    const res = await fetchWithTimeout(url, 30_000);
    if (!res.ok) return false;
    // Require at least one job: guessed names can match unrelated, empty boards.
    const body = (await res.json()) as { jobs?: unknown[] };
    return Array.isArray(body.jobs) && body.jobs.length > 0;
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
