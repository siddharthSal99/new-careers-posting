import { decodeEntities, fetchJson, htmlToText } from "../http";
import type { FetchedJob } from "../types";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  offices?: { name: string; location?: string | null }[];
  departments?: { name: string }[];
  metadata?: { name: string; value: unknown }[] | null;
  first_published?: string | null;
  updated_at?: string;
  content?: string;
  company_name?: string;
}

export async function fetchGreenhouse(token: string): Promise<{ jobs: FetchedJob[]; companyName?: string }> {
  const data = await fetchJson<{ jobs: GhJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
    60_000,
  );
  const jobs = data.jobs.map((j): FetchedJob => {
    const loc = j.location?.name ?? "";
    const locationType = j.metadata?.find((m) => /location type|workplace/i.test(m.name))?.value;
    const isRemote = /remote/i.test(loc) || (typeof locationType === "string" && /remote/i.test(locationType));
    return {
      externalId: String(j.id),
      title: j.title.trim(),
      department: j.departments?.[0]?.name ?? null,
      location: loc,
      isRemote,
      url: j.absolute_url,
      postedAt: j.first_published ? new Date(j.first_published) : null,
      // Greenhouse returns the content HTML-escaped.
      description: j.content ? htmlToText(decodeEntities(j.content)) : "",
    };
  });
  return { jobs, companyName: data.jobs[0]?.company_name };
}
