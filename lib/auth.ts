import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { db } from "./db";
import type { User } from "./types";

const COOKIE = "jt_session";
const SESSION_DAYS = 30;
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  return null;
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const sql = await db();
  const [u] = await sql`
    select u.id, u.email from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  return u ? { id: u.id, email: u.email } : null;
}

/** Call at the top of every page and server action that needs a signed-in user. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

async function startSession(userId: number) {
  const token = randomToken();
  const sql = await db();
  await sql`delete from sessions where user_id = ${userId} and expires_at < now()`;
  await sql`insert into sessions (token_hash, user_id, expires_at)
            values (${sha256(token)}, ${userId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86_400,
    path: "/",
  });
}

export async function logIn(emailInput: string, password: string): Promise<{ error: string } | null> {
  const email = normalizeEmail(emailInput);
  const generic = { error: "Wrong email or password." };
  const sql = await db();
  const [u] = await sql`select id, password_hash, locked_until > now() as locked from users where email = ${email}`;
  if (!u) {
    // Same work as a real check, so response time doesn't reveal which emails have accounts.
    await verifyPassword(password, await dummyPasswordHash());
    return generic;
  }
  if (u.locked) return { error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.` };
  if (!(await verifyPassword(password, u.password_hash))) {
    await sql`
      update users set
        failed_logins = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_logins + 1 end,
        locked_until = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS}
                            then now() + ${`${LOCKOUT_MINUTES} minutes`}::interval else locked_until end
      where id = ${u.id}`;
    return generic;
  }
  await sql`update users set failed_logins = 0, locked_until = null where id = ${u.id}`;
  await startSession(u.id);
  return null;
}

export function signupCodeRequired() {
  return !!process.env.SIGNUP_CODE;
}

export async function signUp(emailInput: string, password: string, code: string): Promise<{ error: string } | null> {
  const email = normalizeEmail(emailInput);
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  const required = process.env.SIGNUP_CODE;
  if (required) {
    const a = Buffer.from(sha256(code.trim()));
    const b = Buffer.from(sha256(required));
    if (!timingSafeEqual(a, b)) return { error: "That invite code isn't right." };
  }

  const passwordHash = await hashPassword(password);
  const sql = await db();
  const result = await sql.begin(async (tx) => {
    // Serialize sign-ups so exactly one account inherits the single-user data.
    await tx`select pg_advisory_xact_lock(4206001)`;
    const [{ n }] = await tx`select count(*)::int as n from users`;
    const [u] = await tx`
      insert into users (email, password_hash, digest_email) values (${email}, ${passwordHash}, ${email})
      on conflict (email) do nothing returning id`;
    if (!u) return null;
    if (n === 0) await adoptSingleUserData(tx, u.id);
    return u.id as number;
  });
  if (!result) return { error: "An account with that email already exists. Log in instead." };
  await startSession(result);
  return null;
}

/**
 * The first account takes over everything from the single-user version: settings, tracked companies,
 * and which jobs were already emailed or scored. On a fresh install there's nothing to copy.
 */
async function adoptSingleUserData(tx: any, userId: number) {
  await tx`
    update users u set
      digest_email = coalesce(s.email, u.digest_email), resume = s.resume,
      title_include = s.title_include, title_exclude = s.title_exclude,
      locations = s.locations, remote_ok = s.remote_ok
    from settings s where s.id = 1 and u.id = ${userId}`;
  await tx`
    insert into subscriptions (user_id, company_id, name, source_url, departments, created_at)
    select ${userId}, id, name, source_url, departments, created_at from companies
    on conflict do nothing`;
  await tx`
    insert into user_jobs (user_id, job_id, notified_at, score, verdict, reason, blockers, scored_resume_hash)
    select ${userId}, id, notified_at, score, verdict, reason, blockers, scored_resume_hash from jobs
    where notified_at is not null or score is not null
    on conflict do nothing`;
}

export async function changePassword(userId: number, current: string, next: string): Promise<{ error: string } | null> {
  const sql = await db();
  const [u] = await sql`select password_hash from users where id = ${userId}`;
  if (!u || !(await verifyPassword(current, u.password_hash))) return { error: "Your current password isn't right." };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  await sql`update users set password_hash = ${await hashPassword(next)} where id = ${userId}`;
  // Sign out everywhere else.
  await sql`delete from sessions where user_id = ${userId}`;
  await startSession(userId);
  return null;
}

export async function deleteAccount(userId: number, password: string): Promise<{ error: string } | null> {
  const sql = await db();
  const [u] = await sql`select password_hash from users where id = ${userId}`;
  if (!u || !(await verifyPassword(password, u.password_hash))) return { error: "That password isn't right." };
  await sql.begin(async (tx) => {
    await tx`delete from users where id = ${userId}`;
    // Boards nobody tracks any more.
    await tx`delete from companies c where not exists (select 1 from subscriptions s where s.company_id = c.id)`;
  });
  (await cookies()).delete(COOKIE);
  return null;
}

export async function logOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const sql = await db();
    await sql`delete from sessions where token_hash = ${sha256(token)}`;
  }
  jar.delete(COOKIE);
}
