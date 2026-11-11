import { withinRetention } from "../retention";
import type { AtsKind, FetchedJob } from "../types";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";

export interface BoardFetch {
  /** Jobs posted within the retention window (or with no posting date). */
  jobs: FetchedJob[];
  /** Open jobs on the board that were skipped for being too old. */
  tooOld: number;
  companyName?: string;
}

export async function fetchBoard(ats: AtsKind, token: string): Promise<BoardFetch> {
  const raw: { jobs: FetchedJob[]; companyName?: string } =
    ats === "greenhouse" ? await fetchGreenhouse(token) : await fetchAshby(token);
  const jobs = raw.jobs.filter((j) => withinRetention(j.postedAt));
  return { jobs, tooOld: raw.jobs.length - jobs.length, companyName: raw.companyName };
}

export const ATS_LABEL: Record<AtsKind, string> = { greenhouse: "Greenhouse", ashby: "Ashby" };
