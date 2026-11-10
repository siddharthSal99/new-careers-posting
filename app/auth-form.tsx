"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";

/** A form bound to a server action that returns { error } or { ok }, showing the message under the fields. */
export function ActionForm({
  action,
  children,
  submit,
  pendingText,
  className,
  danger,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submit: string;
  pendingText?: string;
  className?: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p className="error small">{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--good)" }}>{state.ok}</p>}
      <p>
        <button type="submit" className={danger ? "danger" : undefined} disabled={pending}>{pending ? (pendingText ?? "Working…") : submit}</button>
      </p>
    </form>
  );
}
