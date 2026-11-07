export type AtsKind = "greenhouse" | "ashby";

/** A job as returned by a board adapter, normalized across platforms. */
export interface FetchedJob {
  externalId: string;
  title: string;
  department: string | null;
  /** Every location the posting lists, joined with " | " */
  location: string;
  isRemote: boolean;
  url: string;
  /** When the platform says the job was first published, if it says. */
  postedAt: Date | null;
  /** Plain-text description, used only for AI scoring of new jobs. */
  description: string;
}

export interface BoardRef {
  ats: AtsKind;
  token: string;
}

export interface Settings {
  email: string | null;
  resume: string;
  titleInclude: string[];
  titleExclude: string[];
  locations: string[];
  remoteOk: boolean;
}

export interface Company {
  id: number;
  name: string;
  sourceUrl: string;
  ats: AtsKind;
  boardToken: string;
  departments: string[];
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}
