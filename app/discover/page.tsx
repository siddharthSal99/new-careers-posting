import { requireUser } from "@/lib/auth";
import { getSettings, listSubscriptions } from "@/lib/db";
import { getRunRows, listRuns } from "@/lib/discover";
import { DiscoverClient } from "./discover-client";

export const dynamic = "force-dynamic";
// Server actions on this page (finding boards, web search, rating fit) run in this page's function.
export const maxDuration = 120;

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ run?: string; new?: string }> }) {
  const user = await requireUser("/discover");
  const params = await searchParams;
  const [runs, settings, subs] = await Promise.all([listRuns(user.id), getSettings(user.id), listSubscriptions(user.id)]);
  const runId = params.new ? null : params.run ? Number(params.run) : (runs[0]?.id ?? null);
  const run = runId && runs.some((r) => r.id === runId) ? { id: runId, rows: await getRunRows(user.id, runId) } : null;
  const aiProblem = !settings.anthropicKeyHint
    ? "Add your Anthropic API key in Settings to read screenshots, search the web and rate fit."
    : !settings.resume.trim()
      ? "Paste your resume in Settings to rate fit."
      : null;

  return (
    <>
      <h1>Discover</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        Upload a screenshot listing companies. You pick which to check, then each one gets its job board found, its open roles checked
        against your filters, and a fit rating, so you can decide which to track.
      </p>
      <DiscoverClient
        key={run?.id ?? "new"}
        run={run}
        runs={runs.map((r) => ({ id: r.id, createdAt: r.created_at.toISOString(), companies: r.companies, found: r.found }))}
        trackedNames={subs.map((s) => s.name.toLowerCase())}
        hasKey={!!settings.anthropicKeyHint}
        hasResume={!!settings.resume.trim()}
        aiProblem={aiProblem}
      />
    </>
  );
}
