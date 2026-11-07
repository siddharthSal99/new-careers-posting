// Applied automatically on first database use; every statement is idempotent.
export const SCHEMA = `
create table if not exists companies (
  id serial primary key,
  name text not null,
  source_url text not null,
  ats text not null,
  board_token text not null,
  -- departments to keep; empty means all
  departments text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  unique (ats, board_token)
);

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
  -- true for jobs that already existed when the company was added
  is_baseline boolean not null default false,
  -- an earlier job at the same company with the same title and location
  repost_of int references jobs(id) on delete set null,
  -- description is kept only for new jobs that still need scoring
  description text,
  score int,
  verdict text,
  reason text,
  blockers text[],
  -- set once a job has been emailed, or right away if it failed the filters
  notified_at timestamptz,
  unique (company_id, external_id)
);
create index if not exists jobs_pending_idx on jobs (notified_at) where notified_at is null;

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  email text,
  resume text not null default '',
  title_include text[] not null default '{engineer,developer,software,swe,programmer}',
  title_exclude text[] not null default '{sales,account executive,account manager,recruit,marketing,legal,counsel,accountant,finance}',
  locations text[] not null default '{}',
  remote_ok boolean not null default true
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists runs (
  id serial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb
);
`;
