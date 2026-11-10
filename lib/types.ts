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
  /** Plain-text description. */
  description: string;
}

export interface BoardRef {
  ats: AtsKind;
  token: string;
}

export interface User {
  id: number;
  email: string;
}

/** A user's own preferences. */
export interface Settings {
  /** Where the digest is sent. */
  email: string | null;
  resume: string;
  titleInclude: string[];
  titleExclude: string[];
  locations: string[];
  remoteOk: boolean;
  /** e.g. "sk-ant-…a1b2" when the user has saved a key. */
  anthropicKeyHint: string | null;
}

/** A user tracking a board. `id` is the subscription; `boardId` is the shared board (companies table). */
export interface Subscription {
  id: number;
  boardId: number;
  name: string;
  sourceUrl: string;
  ats: AtsKind;
  boardToken: string;
  departments: string[];
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}
