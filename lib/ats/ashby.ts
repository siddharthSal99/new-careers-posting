import { fetchJson } from "../http";
import type { FetchedJob } from "../types";

interface AshbyJob {
  id: string;
  title: string;
  department?: string | null;
  team?: string | null;
  location?: string | null;
  secondaryLocations?: { location: string }[];
  isRemote?: boolean | null;
  workplaceType?: string | null;
  isListed?: boolean;
  publishedAt?: string | null;
  jobUrl: string;
  descriptionPlain?: string | null;
}

export async function fetchAshby(token: string): Promise<{ jobs: FetchedJob[] }> {
  const data = await fetchJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
    60_000,
  );
  const jobs = data.jobs
    .filter((j) => j.isListed !== false)
    .map((j): FetchedJob => {
      const locations = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(
        (x): x is string => !!x,
      );
      return {
        externalId: j.id,
        title: j.title.trim(),
        department: j.department ?? j.team ?? null,
        location: [...new Set(locations)].join(" | "),
        // `isRemote` is true for hybrid roles too, so trust workplaceType and the location text.
        isRemote: /remote/i.test(j.workplaceType ?? "") || locations.some((l) => /remote/i.test(l)),
        url: j.jobUrl,
        postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        description: j.descriptionPlain ?? "",
      };
    });
  return { jobs };
}
