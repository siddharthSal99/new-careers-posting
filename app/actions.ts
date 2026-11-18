"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { detectBoard, previewBoard } from "@/lib/ats/detect";
import { ATS_LABEL } from "@/lib/ats";
import { changePassword, deleteAccount, logIn, logOut, requireUser, safeNext, signUp } from "@/lib/auth";
import { subscribe, unsubscribe } from "@/lib/companies";
import { encryptSecret } from "@/lib/crypto";
import { anthropicKeyContext, db, saveSettings } from "@/lib/db";
import { deleteEssay, saveJobEssay, updateEssay } from "@/lib/essays";
import { getJobPage } from "@/lib/job-details";
import { runDaily, type RunSummary } from "@/lib/run";
import { backfillScores, type BackfillResult } from "@/lib/score-jobs";
import { keyHint, validateAnthropicKey } from "@/lib/scoring";
import type { AtsKind } from "@/lib/types";

export type FormState = { error?: string; ok?: string } | null;

// ---------- Accounts ----------

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const res = await logIn(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  if (res) return res;
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The passwords don't match." };
  const res = await signUp(String(formData.get("email") ?? ""), password, String(formData.get("code") ?? ""));
  if (res) return res;
  redirect("/settings?welcome=1");
}

export async function logoutAction() {
  await logOut();
  redirect("/login");
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const next = String(formData.get("next") ?? "");
  if (next !== String(formData.get("confirm") ?? "")) return { error: "The new passwords don't match." };
  const res = await changePassword(user.id, String(formData.get("current") ?? ""), next);
  return res ?? { ok: "Password changed. Other devices have been signed out." };
}

export async function deleteAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(formData.get("confirmText") ?? "").trim().toLowerCase() !== "delete") return { error: 'Type "delete" to confirm.' };
  const res = await deleteAccount(user.id, String(formData.get("password") ?? ""));
  if (res) return res;
  redirect("/signup");
}

// ---------- Settings ----------

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function clampInt(v: FormDataEntryValue | null, min: number, max: number, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export async function saveSettingsAction(formData: FormData) {
  const user = await requireUser();
  await saveSettings(user.id, {
    email: String(formData.get("email") ?? "").trim() || null,
    resume: String(formData.get("resume") ?? ""),
    titleInclude: list(formData.get("titleInclude")),
    titleExclude: list(formData.get("titleExclude")),
    locations: list(formData.get("locations")),
    remoteOk: formData.get("remoteOk") === "on",
    maxJobs: clampInt(formData.get("maxJobs"), 1, 100, 15),
    minScore: clampInt(formData.get("minScore"), 0, 10, 7),
  });
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

export async function saveAnthropicKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const key = String(formData.get("apiKey") ?? "").trim();
  const check = await validateAnthropicKey(key);
  if (!check.ok) return { error: check.error };
  let enc: string;
  try {
    enc = encryptSecret(key, anthropicKeyContext(user.id));
  } catch (e) {
    return { error: `The server can't store keys yet: ${(e as Error).message}` };
  }
  const sql = await db();
  await sql`update users set anthropic_key_enc = ${enc}, anthropic_key_hint = ${keyHint(key)} where id = ${user.id}`;
  revalidatePath("/", "layout");
  return { ok: "Key saved. AI matching is on." };
}

export async function removeAnthropicKeyAction() {
  const user = await requireUser();
  const sql = await db();
  await sql`update users set anthropic_key_enc = null, anthropic_key_hint = null where id = ${user.id}`;
  revalidatePath("/", "layout");
}

// ---------- Companies ----------

export type PreviewState =
  | { step: "idle"; error?: string; notes?: string[] }
  | {
      step: "preview";
      sourceUrl: string;
      ats: AtsKind;
      atsLabel: string;
      token: string;
      how: string;
      name: string;
      total: number;
      /** Open jobs skipped because they were posted more than 3 months ago. */
      tooOld: number;
      departments: { name: string; count: number }[];
      notes: string[];
    };

export async function previewAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  await requireUser();
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { step: "idle", error: "Paste a careers page URL." };
  const { detection, notes } = await detectBoard(url);
  if (!detection) return { step: "idle", error: "Couldn't find a supported job board for that page.", notes };
  try {
    const p = await previewBoard(detection.ref);
    return {
      step: "preview",
      sourceUrl: url,
      ats: detection.ref.ats,
      atsLabel: ATS_LABEL[detection.ref.ats],
      token: detection.ref.token,
      how: { url: "from the URL", page: "linked from the careers page", guess: "guessed from the domain — check the name and count", search: "found by web search" }[detection.how],
      name: String(formData.get("name") ?? "").trim() || p.companyName,
      total: p.jobs.length,
      tooOld: p.tooOld,
      departments: p.departments,
      notes,
    };
  } catch (e) {
    return { step: "idle", error: `Found ${detection.ref.ats} board "${detection.ref.token}" but couldn't load it: ${(e as Error).message}`, notes };
  }
}

export async function saveCompanyAction(formData: FormData) {
  const user = await requireUser();
  const ats = String(formData.get("ats"));
  if (ats !== "greenhouse" && ats !== "ashby" && ats !== "lever") throw new Error("unsupported board type");
  const token = String(formData.get("token"));
  const all = formData.get("allDepartments") === "on";
  const departments = all ? [] : formData.getAll("departments").map(String);
  // Fetch again on save: the full board is too large to round-trip through the browser.
  const p = await previewBoard({ ats, token });
  await subscribe({
    userId: user.id,
    name: String(formData.get("name") || p.companyName),
    sourceUrl: String(formData.get("sourceUrl")),
    ats,
    token,
    departments,
    jobs: p.jobs,
  });
  revalidatePath("/");
  redirect("/");
}

export async function updateDepartmentsAction(formData: FormData) {
  const user = await requireUser();
  const all = formData.get("allDepartments") === "on";
  const departments = all ? [] : formData.getAll("departments").map(String);
  const sql = await db();
  await sql`update subscriptions set departments = ${departments}, name = ${String(formData.get("name"))}
            where id = ${Number(formData.get("id"))} and user_id = ${user.id}`;
  revalidatePath("/");
}

export async function deleteCompanyAction(formData: FormData) {
  const user = await requireUser();
  await unsubscribe(user.id, Number(formData.get("id")));
  revalidatePath("/");
}

// ---------- Running and scoring ----------

export async function runNowAction(_prev: RunSummary | null): Promise<RunSummary | null> {
  const user = await requireUser();
  const s = await runDaily({ userId: user.id });
  revalidatePath("/");
  return s;
}

export async function scoreJobsAction(_prev: BackfillResult | null, formData: FormData): Promise<BackfillResult> {
  const user = await requireUser();
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  // Stay well inside the 300 s function limit; the button can be clicked again to continue.
  const res = await backfillScores(user.id, { ids: ids.length ? ids : undefined, budgetMs: 200_000 });
  revalidatePath("/jobs");
  return res;
}

// ---------- Essays ----------

const MAX_ESSAY_CHARS = 20_000;

export type EssaySaveResult = { ok: true; savedAt: string | null } | { ok: false; error: string };

/** Saves the user's answer to an essay question on a job they track. An empty answer deletes the saved one. */
export async function saveJobEssayAction(jobId: number, questionKey: string, answer: string): Promise<EssaySaveResult> {
  const user = await requireUser();
  if (answer.length > MAX_ESSAY_CHARS) return { ok: false, error: `That's over ${MAX_ESSAY_CHARS.toLocaleString()} characters.` };
  const job = await getJobPage(user.id, Number(jobId));
  if (!job) return { ok: false, error: "Job not found." };
  const q = job.questions?.find((x) => x.key === questionKey && x.essay);
  if (!q) return { ok: false, error: "That question isn't on this job's form any more." };
  const saved = await saveJobEssay(user.id, {
    jobId: job.id,
    questionKey: q.key,
    question: q.label,
    questionDescription: q.description,
    company: job.company,
    jobTitle: job.title,
    answer,
  });
  revalidatePath("/essays");
  return { ok: true, savedAt: saved ? saved.updatedAt.toISOString() : null };
}

export async function updateEssayAction(essayId: number, answer: string): Promise<EssaySaveResult> {
  const user = await requireUser();
  if (answer.length > MAX_ESSAY_CHARS) return { ok: false, error: `That's over ${MAX_ESSAY_CHARS.toLocaleString()} characters.` };
  const saved = await updateEssay(user.id, Number(essayId), answer);
  if (!saved) return { ok: false, error: "Essay not found." };
  revalidatePath("/essays");
  return { ok: true, savedAt: saved.updatedAt.toISOString() };
}

export async function deleteEssayAction(essayId: number) {
  const user = await requireUser();
  await deleteEssay(user.id, Number(essayId));
  revalidatePath("/essays");
}
