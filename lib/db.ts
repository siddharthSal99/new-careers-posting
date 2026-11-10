import postgres from "postgres";
import { decryptSecret } from "./crypto";
import { SCHEMA } from "./schema";
import type { Settings, Subscription } from "./types";

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { sql?: Sql; schemaReady?: Promise<void> };

function connect(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes("host=/");
  return postgres(url, {
    ssl: local ? false : "require",
    max: 5,
    // Neon's pooler (PgBouncer) does not support prepared statements.
    prepare: false,
    onnotice: () => {},
  });
}

/** Returns the shared connection, creating tables on first use. */
export async function db(): Promise<Sql> {
  globalForDb.sql ??= connect();
  const sql = globalForDb.sql;
  globalForDb.schemaReady ??= (async () => {
    await sql.unsafe(SCHEMA);
  })().catch((err) => {
    globalForDb.schemaReady = undefined;
    throw err;
  });
  await globalForDb.schemaReady;
  return sql;
}

export async function closeDb() {
  await globalForDb.sql?.end();
  globalForDb.sql = undefined;
  globalForDb.schemaReady = undefined;
}

export async function getSettings(userId: number): Promise<Settings> {
  const sql = await db();
  const [r] = await sql`select * from users where id = ${userId}`;
  if (!r) throw new Error(`no user ${userId}`);
  return {
    email: r.digest_email ?? r.email,
    resume: r.resume,
    titleInclude: r.title_include,
    titleExclude: r.title_exclude,
    locations: r.locations,
    remoteOk: r.remote_ok,
    anthropicKeyHint: r.anthropic_key_enc ? r.anthropic_key_hint : null,
  };
}

export async function saveSettings(userId: number, s: Omit<Settings, "anthropicKeyHint">) {
  const sql = await db();
  await sql`
    update users set
      digest_email = ${s.email}, resume = ${s.resume},
      title_include = ${s.titleInclude}, title_exclude = ${s.titleExclude},
      locations = ${s.locations}, remote_ok = ${s.remoteOk}
    where id = ${userId}`;
}

export const anthropicKeyContext = (userId: number) => `user:${userId}:anthropic`;

/** The user's decrypted Anthropic key, or null if they haven't saved one (or it can't be decrypted). */
export async function getAnthropicKey(userId: number): Promise<string | null> {
  const sql = await db();
  const [r] = await sql`select anthropic_key_enc from users where id = ${userId}`;
  if (!r?.anthropic_key_enc) return null;
  try {
    return decryptSecret(r.anthropic_key_enc, anthropicKeyContext(userId));
  } catch (e) {
    console.error(`can't decrypt the Anthropic key for user ${userId} (was ENCRYPTION_KEY changed?):`, (e as Error).message);
    return null;
  }
}

export function toSubscription(r: Record<string, any>): Subscription {
  return {
    id: r.id,
    boardId: r.company_id,
    name: r.name,
    sourceUrl: r.source_url,
    ats: r.ats,
    boardToken: r.board_token,
    departments: r.departments,
    createdAt: r.created_at,
    lastSuccessAt: r.last_success_at,
    lastError: r.last_error,
    consecutiveFailures: r.consecutive_failures,
  };
}

export async function listSubscriptions(userId: number): Promise<Subscription[]> {
  const sql = await db();
  const rows = await sql`
    select s.id, s.company_id, s.name, s.source_url, s.departments, s.created_at,
           c.ats, c.board_token, c.last_success_at, c.last_error, c.consecutive_failures
    from subscriptions s join companies c on c.id = s.company_id
    where s.user_id = ${userId}
    order by lower(s.name)`;
  return rows.map(toSubscription);
}
