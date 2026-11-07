import type { Settings } from "./types";

export interface FilterableJob {
  title: string;
  department: string | null;
  location: string;
  isRemote: boolean;
}

function norm(s: string) {
  return ` ${s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim()} `;
}

/** Whole-word (or whole-phrase) match, so "swe" doesn't match "answer". */
function hasTerm(text: string, term: string) {
  const t = norm(term).trim();
  return t.length > 0 && norm(text).includes(` ${t}`);
}

export interface FilterResult {
  pass: boolean;
  why: string;
}

export function applyFilters(job: FilterableJob, settings: Settings, companyDepartments: string[]): FilterResult {
  if (companyDepartments.length > 0 && !companyDepartments.includes(job.department ?? "(none)")) {
    return { pass: false, why: `department "${job.department ?? "(none)"}" not selected` };
  }
  const excluded = settings.titleExclude.find((t) => hasTerm(job.title, t));
  if (excluded) return { pass: false, why: `title contains "${excluded}"` };
  if (settings.titleInclude.length > 0 && !settings.titleInclude.some((t) => hasTerm(job.title, t))) {
    return { pass: false, why: "title has none of the include keywords" };
  }
  if (settings.locations.length > 0) {
    const locOk = settings.locations.some((l) => job.location.toLowerCase().includes(l.trim().toLowerCase()));
    if (!locOk && !(settings.remoteOk && job.isRemote)) {
      return { pass: false, why: `location "${job.location}" not in your list` };
    }
  }
  return { pass: true, why: "" };
}

/** Normalized title + location, used to spot reposts of the same role under a new ID. */
export function repostKey(title: string, location: string) {
  return `${norm(title).trim()}|${norm(location).trim()}`;
}
