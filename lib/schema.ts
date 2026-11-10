// Applied automatically on first database use; every statement is idempotent.
export const SCHEMA = `
-- A job board (Greenhouse or Ashby). Shared by every user who tracks it, so each board is fetched once a day.
create table if not exists companies (
  id serial primary key,
  name text not null,
  source_url text not null,
  ats text not null,
  board_token text not null,
  -- legacy (single-user version): per-user departments now live on subscriptions
  departments text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  unique (ats, board_token)
);

-- Jobs on a board. Shared between users; per-user state is in user_jobs.
create table if not exists jobs (
  id serial primary key,
  company_id int not null references companies(id) on delete cascade,
  external_id text not null,
  title text not null,
  department text,
  location text not null default '',
  is_remote boolean not null default false,
  url text not null,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  -- an earlier job on the same board with the same title and location
  repost_of int references jobs(id) on delete set null,
  -- plain-text description of open jobs (cleared when a job closes), for search and scoring
  description text,
  -- legacy (single-user version); copied into user_jobs for the first account
  is_baseline boolean not null default false,
  score int,
  verdict text,
  reason text,
  blockers text[],
  notified_at timestamptz,
  unique (company_id, external_id)
);
alter table jobs add column if not exists scored_resume_hash text;
create index if not exists jobs_company_idx on jobs (company_id);

-- legacy (single-user version): copied into the first account, then unused
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  email text,
  resume text not null default '',
  title_include text[] not null default '{engineer,developer,software,swe,programmer}',
  title_exclude text[] not null default '{sales,account executive,account manager,recruit,marketing,legal,counsel,accountant,finance}',
  locations text[] not null default '{}',
  remote_ok boolean not null default true
);

create table if not exists users (
  id serial primary key,
  email text not null unique,
  -- scrypt with a random per-user salt; see lib/crypto.ts
  password_hash text not null,
  created_at timestamptz not null default now(),
  failed_logins int not null default 0,
  locked_until timestamptz,
  -- where the daily digest goes (defaults to the login email)
  digest_email text,
  resume text not null default '',
  title_include text[] not null default '{engineer,developer,software,swe,programmer}',
  title_exclude text[] not null default '{sales,account executive,account manager,recruit,marketing,legal,counsel,accountant,finance}',
  locations text[] not null default '{}',
  remote_ok boolean not null default true,
  -- the user's Anthropic API key, AES-256-GCM encrypted with ENCRYPTION_KEY; never sent back to the browser
  anthropic_key_enc text,
  -- e.g. "sk-ant-…a1b2", shown in Settings
  anthropic_key_hint text
);

-- added later: digest size limits
alter table users add column if not exists digest_max_jobs int not null default 15;
alter table users add column if not exists min_score int not null default 7;

create table if not exists sessions (
  -- sha256 of the cookie token, so a database leak doesn't expose live sessions
  token_hash text primary key,
  user_id int not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions (user_id);

-- A user tracking a board, with their own name and department choices.
-- Jobs first seen after created_at are "new" for this user; earlier ones are their baseline.
create table if not exists subscriptions (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  company_id int not null references companies(id) on delete cascade,
  name text not null,
  source_url text not null,
  -- departments to keep; empty means all
  departments text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);
create index if not exists subscriptions_company_idx on subscriptions (company_id);

-- Per-user state for a job: whether it was emailed (or skipped by filters) and its fit score for this user's resume.
create table if not exists user_jobs (
  user_id int not null references users(id) on delete cascade,
  job_id int not null references jobs(id) on delete cascade,
  notified_at timestamptz,
  score int,
  verdict text,
  reason text,
  blockers text[],
  scored_resume_hash text,
  primary key (user_id, job_id)
);

create table if not exists runs (
  id serial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);
`;
