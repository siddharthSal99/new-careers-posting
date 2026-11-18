// Applied automatically on first database use; every statement is idempotent.
export const SCHEMA = `
-- A job board (Greenhouse, Ashby or Lever). Shared by every user who tracks it, so each board is fetched once a day.
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
-- added later: job page details
alter table jobs add column if not exists salary text;
alter table jobs add column if not exists apply_url text;
-- application questions etc., fetched when someone first opens the job page (see lib/job-details.ts)
alter table jobs add column if not exists details jsonb;
alter table jobs add column if not exists details_fetched_at timestamptz;
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
-- added later: the on-demand "Explain score" analysis (see lib/explain.ts)
alter table user_jobs add column if not exists explanation jsonb;

-- A user's saved answer to an application question. Keeps its own copy of the question, company and job title,
-- so it stays useful (e.g. as a reference for new drafts) after the job itself is deleted.
create table if not exists essays (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  job_id int references jobs(id) on delete set null,
  -- the question's id on the application form (see lib/ats/details.ts)
  question_key text,
  question text not null,
  question_description text not null default '',
  company text not null default '',
  job_title text not null default '',
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists essays_job_question_idx on essays (user_id, job_id, question_key) where job_id is not null;
create index if not exists essays_user_idx on essays (user_id, updated_at desc);

-- Discover: a batch of companies (e.g. read from a screenshot) checked for job boards and matching roles.
create table if not exists discovery_runs (
  id serial primary key,
  user_id int not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists discovery_rows (
  id serial primary key,
  run_id int not null references discovery_runs(id) on delete cascade,
  user_id int not null references users(id) on delete cascade,
  position int not null default 0,
  name text not null,
  -- careers URL shown in the screenshot, if any
  url_hint text,
  -- pending | found | not_found | unsupported | error
  status text not null default 'pending',
  ats text,
  board_token text,
  careers_url text,
  -- how the board was found: url | page | guess | search
  how text,
  -- false when a guessed board may belong to a different company with the same name
  verified boolean,
  open_jobs int,
  matching int,
  top_titles text[],
  top_locations text[],
  fit text,
  fit_note text,
  -- the start of one job description, sent with the fit rating so the model knows what the company does
  excerpt text,
  error text,
  searched boolean not null default false,
  tracked boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists discovery_rows_run_idx on discovery_rows (run_id, position);

create table if not exists runs (
  id serial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);
`;
