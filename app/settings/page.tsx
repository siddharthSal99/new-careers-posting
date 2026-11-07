import { requireAuth } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { scoringEnabled } from "@/lib/scoring";
import { logoutAction, saveSettingsAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAuth();
  const [s, { saved }] = await Promise.all([getSettings(), searchParams]);
  return (
    <>
      <h1>Settings</h1>
      {saved && <p className="notice">Saved. Filter changes apply to future new jobs and to the Jobs page.</p>}
      <form action={saveSettingsAction} className="panel">
        <label htmlFor="email" style={{ marginTop: 0 }}>Email for the daily digest</label>
        <input id="email" name="email" type="email" defaultValue={s.email ?? ""} />

        <label htmlFor="titleInclude">Title must contain one of</label>
        <input id="titleInclude" name="titleInclude" type="text" defaultValue={s.titleInclude.join(", ")} />
        <p className="muted small">Comma-separated, whole words. Leave empty to allow any title.</p>

        <label htmlFor="titleExclude">Title must not contain</label>
        <input id="titleExclude" name="titleExclude" type="text" defaultValue={s.titleExclude.join(", ")} />
        <p className="muted small">e.g. sales, recruiter, manager, intern, staff, principal</p>

        <label htmlFor="locations">Locations</label>
        <input id="locations" name="locations" type="text" defaultValue={s.locations.join(", ")} placeholder="San Francisco, New York, Seattle" />
        <p className="muted small">A job matches if its location text contains any of these. Leave empty for anywhere.</p>
        <label className="inline" style={{ marginTop: 6 }}>
          <input type="checkbox" name="remoteOk" defaultChecked={s.remoteOk} /> Also include remote jobs
        </label>

        <label htmlFor="resume">Resume</label>
        <textarea id="resume" name="resume" defaultValue={s.resume} style={{ minHeight: 260 }} placeholder="Paste your resume as plain text" />
        <p className="muted small">
          Used to score new jobs with Claude Haiku. {scoringEnabled() ? "AI matching is on." : "AI matching is off until ANTHROPIC_API_KEY is set on the server."}
        </p>

        <p><button type="submit">Save settings</button></p>
      </form>
      <form action={logoutAction} style={{ marginTop: 16 }}>
        <button type="submit" className="secondary">Log out</button>
      </form>
    </>
  );
}
