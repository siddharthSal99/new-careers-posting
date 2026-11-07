import postgres from "postgres";
import { SCHEMA } from "./schema";
import type { Company, Settings } from "./types";

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

export async function getSettings(): Promise<Settings> {
  const sql = await db();
  const [r] = await sql`select * from settings where id = 1`;
  return {
    email: r.email,
    resume: r.resume,
    titleInclude: r.title_include,
    titleExclude: r.title_exclude,
    locations: r.locations,
    remoteOk: r.remote_ok,
  };
}

export async function saveSettings(s: Settings) {
  const sql = await db();
  await sql`
    update settings set
      email = ${s.email}, resume = ${s.resume},
      title_include = ${s.titleInclude}, title_exclude = ${s.titleExclude},
      locations = ${s.locations}, remote_ok = ${s.remoteOk}
    where id = 1`;
}

export function toCompany(r: Record<string, any>): Company {
  return {
    id: r.id,
    name: r.name,
    sourceUrl: r.source_url,
    ats: r.ats,
    boardToken: r.board_token,
    departments: r.departments,
    lastSuccessAt: r.last_success_at,
    lastError: r.last_error,
    consecutiveFailures: r.consecutive_failures,
  };
}

export async function listCompanies(): Promise<Company[]> {
  const sql = await db();
  const rows = await sql`select * from companies order by lower(name)`;
  return rows.map(toCompany);
}
