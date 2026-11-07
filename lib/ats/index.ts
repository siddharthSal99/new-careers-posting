import type { AtsKind, FetchedJob } from "../types";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";

export async function fetchBoard(ats: AtsKind, token: string): Promise<{ jobs: FetchedJob[]; companyName?: string }> {
  switch (ats) {
    case "greenhouse":
      return fetchGreenhouse(token);
    case "ashby":
      return fetchAshby(token);
  }
}

export const ATS_LABEL: Record<AtsKind, string> = { greenhouse: "Greenhouse", ashby: "Ashby" };
