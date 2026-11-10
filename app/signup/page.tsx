import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, MIN_PASSWORD_LENGTH, signupCodeRequired } from "@/lib/auth";
import { signupAction } from "../actions";
import { ActionForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return (
    <div className="panel" style={{ maxWidth: 380, margin: "40px auto" }}>
      <h1>Create an account</h1>
      <ActionForm action={signupAction} submit="Create account" pendingText="Creating account…">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" autoFocus required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        <p className="muted small">At least {MIN_PASSWORD_LENGTH} characters. There's no password reset, so keep it somewhere safe.</p>
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        {signupCodeRequired() && (
          <>
            <label htmlFor="code">Invite code</label>
            <input id="code" name="code" type="text" autoComplete="off" required />
          </>
        )}
      </ActionForm>
      <p className="small muted">Already have an account? <Link href="/login">Log in</Link></p>
    </div>
  );
}
