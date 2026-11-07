"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { previewAction, saveCompanyAction, type PreviewState } from "./actions";

const ENGINEERING = /engineer|software|research|infra|platform|scaling|product|applied|security|data|compute|\bml\b|machine|hardware|developer/i;
const NOT_ENGINEERING = /sales|market|finance|legal|people|recruit|communications|policy|go to market|operations|partnership|workplace|support|product management|product design|\bgov/i;

function Submit({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? pendingText : children}</button>;
}

export function AddCompany() {
  const [state, action] = useActionState<PreviewState, FormData>(previewAction, { step: "idle" });

  if (state.step === "preview") {
    return (
      <div className="panel">
        <p>
          <b>{state.atsLabel}</b> board <code>{state.token}</code> ({state.how}): <b>{state.total}</b> open jobs.
        </p>
        {state.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
        <form action={saveCompanyAction}>
          <input type="hidden" name="ats" value={state.ats} />
          <input type="hidden" name="token" value={state.token} />
          <input type="hidden" name="sourceUrl" value={state.sourceUrl} />
          <label htmlFor="name">Company name</label>
          <input id="name" name="name" type="text" defaultValue={state.name} />
          <DepartmentPicker departments={state.departments} selected={state.departments.filter((d) => ENGINEERING.test(d.name) && !NOT_ENGINEERING.test(d.name)).map((d) => d.name)} />
          <p className="muted small">
            All {state.total} current jobs are saved as already seen. From tomorrow you'll be emailed only jobs that are new and match these departments and your filters in Settings.
          </p>
          <div className="row">
            <Submit pendingText="Saving…">Track this company</Submit>
            <a href="/">Cancel</a>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="panel">
      <label htmlFor="url" style={{ marginTop: 0 }}>Careers page URL</label>
      <input id="url" name="url" type="text" placeholder="https://openai.com/careers/search/ or jobs.ashbyhq.com/openai" required />
      <label htmlFor="cname">Name <span className="muted small">(optional)</span></label>
      <input id="cname" name="name" type="text" />
      {state.error && <p className="error">{state.error}</p>}
      {state.notes?.map((n) => <p key={n} className="muted small">{n}</p>)}
      <p><Submit pendingText="Looking for the job board…">Find jobs</Submit></p>
    </form>
  );
}

export function DepartmentPicker({ departments, selected }: { departments: { name: string; count: number }[]; selected: string[] }) {
  const [all, setAll] = useState(selected.length === 0);
  return (
    <>
      <label>Departments to watch</label>
      <label className="inline">
        <input type="checkbox" name="allDepartments" checked={all} onChange={(e) => setAll(e.target.checked)} /> All departments
      </label>
      {!all && (
        <div className="grid-checks">
          {departments.map((d) => (
            <label key={d.name} className="inline">
              <input type="checkbox" name="departments" value={d.name} defaultChecked={selected.includes(d.name)} />
              {d.name} <span className="muted small">({d.count})</span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}
