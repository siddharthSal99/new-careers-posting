import { requireUser } from "@/lib/auth";
import { encryptionConfigured } from "@/lib/crypto";
import { getSettings } from "@/lib/db";
import { changePasswordAction, deleteAccountAction, logoutAction, removeAnthropicKeyAction, saveAnthropicKeyAction, saveSettingsAction } from "../actions";
import { ActionForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; welcome?: string }> }) {
  const user = await requireUser();
  const [s, { saved, welcome }] = await Promise.all([getSettings(user.id), searchParams]);
  return (
    <>
      <h1>Settings</h1>
      <p className="muted small">Signed in as {user.email}</p>
      {welcome && <p className="notice">Welcome! Set your filters and paste your resume, add an Anthropic API key for AI matching, then add companies.</p>}
      {saved && <p className="notice">Saved. Filter changes apply to future new jobs and to the Jobs page.</p>}

      <h2>Job preferences</h2>
      <form action={saveSettingsAction} className="panel">
        <label htmlFor="email" style={{ marginTop: 0 }}>Send the daily digest to</label>
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
        <p className="muted small">Used to score jobs with Claude Haiku using your API key below. Contact details aren't needed.</p>

        <p><button type="submit">Save preferences</button></p>
      </form>

      <h2>AI matching</h2>
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          {s.anthropicKeyHint ? <>Using your Anthropic API key <code>{s.anthropicKeyHint}</code>.</> : "Add an Anthropic API key to score jobs against your resume."}{" "}
          <span className="muted small">
            Scoring uses Claude Haiku and typically costs well under $1/month. Create a key at{" "}
            <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com</a>; a dedicated key with a spend limit is a good idea.
          </span>
        </p>
        {!encryptionConfigured() ? (
          <p className="error small">This server can't store API keys yet (ENCRYPTION_KEY isn't set).</p>
        ) : (
          <ActionForm action={saveAnthropicKeyAction} submit={s.anthropicKeyHint ? "Replace key" : "Save key"} pendingText="Checking key…">
            <label htmlFor="apiKey">{s.anthropicKeyHint ? "New API key" : "API key"}</label>
            <input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder="sk-ant-…" required />
            <p className="muted small">The key is checked with Anthropic, then stored encrypted. It's never shown again or sent back to your browser.</p>
          </ActionForm>
        )}
        {s.anthropicKeyHint && (
          <form action={removeAnthropicKeyAction}>
            <button type="submit" className="danger">Remove key</button>
          </form>
        )}
      </div>

      <h2>Account</h2>
      <div className="panel">
        <ActionForm action={changePasswordAction} submit="Change password" pendingText="Changing…">
          <label htmlFor="current" style={{ marginTop: 0 }}>Current password</label>
          <input id="current" name="current" type="password" autoComplete="current-password" required />
          <label htmlFor="next">New password</label>
          <input id="next" name="next" type="password" autoComplete="new-password" required />
          <label htmlFor="confirm">Confirm new password</label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </ActionForm>
        <form action={logoutAction}>
          <button type="submit" className="secondary">Log out</button>
        </form>
        <details style={{ marginTop: 16 }}>
          <summary className="small error">Delete account</summary>
          <ActionForm action={deleteAccountAction} submit="Delete my account" pendingText="Deleting…" danger>
            <p className="small">Deletes your account, tracked companies, scores and saved API key. This can't be undone.</p>
            <label htmlFor="delPassword">Password</label>
            <input id="delPassword" name="password" type="password" autoComplete="current-password" required />
            <label htmlFor="confirmText">Type "delete" to confirm</label>
            <input id="confirmText" name="confirmText" type="text" autoComplete="off" required />
          </ActionForm>
        </details>
      </div>
    </>
  );
}
