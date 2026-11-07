import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "jt_session";

function token(password: string) {
  return createHash("sha256").update(`jobtracker:${password}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function isAuthed() {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return process.env.NODE_ENV !== "production";
  const c = (await cookies()).get(COOKIE)?.value;
  return !!c && safeEqual(c, token(pw));
}

/** Call at the top of every page and server action. */
export async function requireAuth() {
  if (!(await isAuthed())) redirect("/login");
}

export async function logIn(password: string) {
  const pw = process.env.APP_PASSWORD;
  if (!pw || !safeEqual(token(password), token(pw))) return false;
  (await cookies()).set(COOKIE, token(pw), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return true;
}

export async function logOut() {
  (await cookies()).delete(COOKIE);
}
