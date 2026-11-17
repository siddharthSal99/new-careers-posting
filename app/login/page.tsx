import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, safeNext } from "@/lib/auth";
import { loginAction } from "../actions";
import { ActionForm } from "../auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <div className="panel" style={{ maxWidth: 380, margin: "40px auto" }}>
      <h1>Log in</h1>
      <ActionForm action={loginAction} submit="Log in" pendingText="Logging in…">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" autoFocus required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </ActionForm>
      <p className="small muted">No account? <Link href="/signup">Sign up</Link></p>
    </div>
  );
}
