"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createRun, discoverRow, rateFit, searchRow, trackRow, type DiscoveryRow } from "@/lib/discover";

const MAX_COMPANIES = 60;

/** "krea.ai/careers" -> "https://krea.ai/careers"; anything that isn't a web address -> null. */
function normalizeUrl(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().slice(0, 300) : "";
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes(".") ? u.href : null;
  } catch {
    return null;
  }
}

export async function startDiscoveryAction(companies: { name: string; url: string | null }[]): Promise<{ runId: number } | { error: string }> {
  const user = await requireUser();
  const clean = companies
    .map((c) => ({ name: String(c.name ?? "").trim().slice(0, 120), url: normalizeUrl(c.url) }))
    .filter((c) => c.name);
  if (!clean.length) return { error: "Pick at least one company." };
  if (clean.length > MAX_COMPANIES) return { error: `Up to ${MAX_COMPANIES} companies at a time.` };
  return { runId: await createRun(user.id, clean) };
}

/** The free step for one company: find its board and check its jobs. */
export async function discoverRowAction(rowId: number): Promise<DiscoveryRow | null> {
  const user = await requireUser();
  return discoverRow(user.id, Number(rowId));
}

/** The paid step for one company: web search with the user's key. */
export async function searchRowAction(rowId: number): Promise<DiscoveryRow | null> {
  const user = await requireUser();
  return searchRow(user.id, Number(rowId));
}

export async function rateFitAction(runId: number): Promise<{ rated: number; error?: string }> {
  const user = await requireUser();
  return rateFit(user.id, Number(runId));
}

export async function trackRowAction(rowId: number): Promise<{ ok: true; row: DiscoveryRow } | { ok: false; error: string }> {
  const user = await requireUser();
  const res = await trackRow(user.id, Number(rowId));
  revalidatePath("/");
  return res;
}
