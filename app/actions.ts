"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { detectBoard, previewBoard } from "@/lib/ats/detect";
import { ATS_LABEL } from "@/lib/ats";
import { logOut, requireAuth } from "@/lib/auth";
import { addCompany } from "@/lib/companies";
import { db, getSettings, saveSettings } from "@/lib/db";
import { runDaily, type RunSummary } from "@/lib/run";
import type { AtsKind } from "@/lib/types";

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
      departments: { name: string; count: number }[];
      notes: string[];
    };

export async function previewAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  await requireAuth();
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
      how: { url: "from the URL", page: "linked from the careers page", guess: "guessed from the domain — check the name and count" }[detection.how],
      name: String(formData.get("name") ?? "").trim() || p.companyName,
      total: p.jobs.length,
      departments: p.departments,
      notes,
    };
  } catch (e) {
    return { step: "idle", error: `Found ${detection.ref.ats} board "${detection.ref.token}" but couldn't load it: ${(e as Error).message}`, notes };
  }
}

export async function saveCompanyAction(formData: FormData) {
  await requireAuth();
  const ats = String(formData.get("ats")) as AtsKind;
  const token = String(formData.get("token"));
  const all = formData.get("allDepartments") === "on";
  const departments = all ? [] : formData.getAll("departments").map(String);
  // Fetch again on save: the full board is too large to round-trip through the browser.
  const p = await previewBoard({ ats, token });
  await addCompany({
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
  await requireAuth();
  const id = Number(formData.get("id"));
  const all = formData.get("allDepartments") === "on";
  const departments = all ? [] : formData.getAll("departments").map(String);
  const sql = await db();
  await sql`update companies set departments = ${departments}, name = ${String(formData.get("name"))} where id = ${id}`;
  revalidatePath("/");
}

export async function deleteCompanyAction(formData: FormData) {
  await requireAuth();
  const sql = await db();
  await sql`delete from companies where id = ${Number(formData.get("id"))}`;
  revalidatePath("/");
}

export async function runNowAction(_prev: RunSummary | null): Promise<RunSummary | null> {
  await requireAuth();
  const s = await runDaily();
  revalidatePath("/");
  return s;
}

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export async function saveSettingsAction(formData: FormData) {
  await requireAuth();
  const cur = await getSettings();
  await saveSettings({
    ...cur,
    email: String(formData.get("email") ?? "").trim() || null,
    resume: String(formData.get("resume") ?? ""),
    titleInclude: list(formData.get("titleInclude")),
    titleExclude: list(formData.get("titleExclude")),
    locations: list(formData.get("locations")),
    remoteOk: formData.get("remoteOk") === "on",
  });
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

export async function logoutAction() {
  await logOut();
  redirect("/login");
}
