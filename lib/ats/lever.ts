import { fetchJson, htmlToText } from "../http";
import type { FetchedJob } from "../types";

interface LeverPosting {
  id: string;
  text: string;
  categories?: { team?: string | null; department?: string | null; location?: string | null; allLocations?: string[] | null };
  workplaceType?: string | null;
  createdAt?: number | null;
  hostedUrl: string;
  applyUrl?: string | null;
  descriptionPlain?: string | null;
  lists?: { text: string; content: string }[] | null;
  additionalPlain?: string | null;
  salaryRange?: { min?: number | null; max?: number | null; currency?: string | null; interval?: string | null } | null;
}

function salary(r: LeverPosting["salaryRange"]): string | null {
  if (!r || (r.min == null && r.max == null)) return null;
  const cur = r.currency ?? "USD";
  const fmt = (n: number) => {
    const v = n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
    return cur === "USD" ? `$${v}` : v;
  };
  const range = r.min != null && r.max != null && r.min !== r.max ? `${fmt(r.min)} – ${fmt(r.max)}` : fmt((r.min ?? r.max)!);
  const interval = r.interval && !/year/i.test(r.interval) ? ` ${r.interval.replace(/-/g, " ")}` : "";
  return `${range}${cur === "USD" ? "" : ` ${cur}`}${interval}`;
}

/** Lever's public postings API (no key needed): every open job on a company's board in one call. */
export async function fetchLever(token: string): Promise<{ jobs: FetchedJob[] }> {
  const data = await fetchJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`, 60_000);
  const jobs = data.map((j): FetchedJob => {
    const locations = [...new Set([j.categories?.location, ...(j.categories?.allLocations ?? [])].filter((x): x is string => !!x))];
    // The description is split into an intro, bulleted lists (responsibilities, requirements…) and a closing section.
    const lists = (j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
    const description = [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n").trim();
    return {
      externalId: j.id,
      title: j.text.trim(),
      department: j.categories?.team ?? j.categories?.department ?? null,
      location: locations.join(" | "),
      isRemote: j.workplaceType === "remote" || locations.some((l) => /remote/i.test(l)),
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt) : null,
      description,
      salary: salary(j.salaryRange),
      applyUrl: j.applyUrl ?? null,
    };
  });
  return { jobs };
}
