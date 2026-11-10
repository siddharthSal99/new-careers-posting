import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loginAction } from "../actions";
import { ActionForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <div className="panel" style={{ maxWidth: 380, margin: "40px auto" }}>
      <h1>Log in</h1>
      <ActionForm action={loginAction} submit="Log in" pendingText="Logging in…">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" autoFocus required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </ActionForm>
      <p className="small muted">No account? <Link href="/signup">Sign up</Link></p>
    </div>
  );
}
