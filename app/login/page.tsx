import { redirect } from "next/navigation";
import { logIn } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  async function login(formData: FormData) {
    "use server";
    if (await logIn(String(formData.get("password") ?? ""))) redirect("/");
    redirect("/login?error=1");
  }
  return (
    <div className="panel" style={{ maxWidth: 360, margin: "40px auto" }}>
      <h1>Log in</h1>
      {!process.env.APP_PASSWORD && <p className="error">APP_PASSWORD is not set on the server.</p>}
      <form action={login}>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoFocus required />
        {error && <p className="error small">Wrong password.</p>}
        <p><button type="submit">Log in</button></p>
      </form>
    </div>
  );
}
