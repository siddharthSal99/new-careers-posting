# Job Tracker

Tracks the careers pages of companies you care about and emails you once a day when **new** jobs appear, so you can focus on postings that are less likely to be stale.

Multiple people can use one deployment. Each user has their own account, companies, filters, resume, digest email and Anthropic API key; job boards that several people track are fetched once.

- Paste a careers page URL (e.g. `https://openai.com/careers/search/`). The app finds the company's Greenhouse, Ashby or Lever job board behind it and saves every current job as already seen.
- Once a day it fetches each board, compares it with what's saved, and emails you the jobs that are new **and** match your filters. If nothing is new, no email is sent.
- The email stays short however many companies you track: it lists your best matches (15 by default) and counts the rest per company, with links to them in the app. With AI matching on, only jobs scoring at or above your minimum (7/10 by default) are listed, and if none qualify no email is sent. Both limits are in Settings.
- Filters: departments (per company), title keywords, and locations (with an option for remote).
- Optional AI matching: each user can save their own Anthropic API key in Settings. New matching jobs are then scored 0-10 against their resume by Claude Haiku, with a one-line reason and any hard blockers (clearance, visa, years of experience). Poor fits go in a collapsed section of the email rather than being dropped.
- Also tracks removed jobs, flags likely reposts (same title and location as an earlier job), and warns you in the email if a board keeps failing to load.
- Only jobs posted in the last 3 months are kept (see [Data retention](#data-retention)).

Supported job boards: **Greenhouse**, **Ashby** and **Lever**.

## How it finds the board

1. The URL is a board URL itself (`jobs.ashbyhq.com/openai`, `job-boards.greenhouse.io/anthropic`, `jobs.lever.co/palantir`).
2. Otherwise it loads the careers page and looks for links to a Greenhouse, Ashby or Lever board (this is how `anthropic.com/careers/jobs` is found).
3. If the page blocks automated requests (openai.com does), it guesses the board name from the domain (`openai`) and checks whether that board exists and has jobs. Guessed matches are labelled so you can check the name and job count before saving.

Daily checks call only the boards' public JSON APIs, never the company's own website.

## Deploying (free tiers)

1. **Database:** create a free Postgres database on [Neon](https://neon.tech) and copy the **pooled** connection string. Tables are created automatically the first time the app connects.
2. **Email:** create a [Resend](https://resend.com) account and an API key. Resend's shared sender (`onboarding@resend.dev`) can only email the address you signed up to Resend with. To send digests to other users, [verify a domain](https://resend.com/domains) and set `RESEND_FROM` to an address on it.
3. **Vercel:** import this repository into [Vercel](https://vercel.com) and set the environment variables from `.env.example`:

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | Neon pooled connection string |
   | `ENCRYPTION_KEY` | for AI matching | Any random string of 32+ characters, e.g. `openssl rand -hex 32`. Encrypts users' API keys. Don't change it once users have saved keys. |
   | `CRON_SECRET` | yes | Any long random string; Vercel sends it to the cron route |
   | `SIGNUP_CODE` | no | If set, sign-up requires this invite code |
   | `RESEND_API_KEY` | for email | Without it the digest is only written to the logs |
   | `RESEND_FROM` | no | Defaults to `Job Tracker <onboarding@resend.dev>` |
   | `APP_URL` | no | Your deployment URL, for the link in emails |

4. Open the app, **sign up**, fill in **Settings** (preferences, resume, and optionally an Anthropic API key), and add companies.

The daily check is scheduled in `vercel.json` (`0 14 * * *`, i.e. 14:00 UTC). On Vercel's Hobby plan, cron jobs run at most once a day and may fire at any point within the scheduled hour. The cron route and the home and Jobs pages set `maxDuration = 300`; if your plan rejects that, lower it in `app/api/cron/daily/route.ts`, `app/page.tsx` and `app/jobs/page.tsx`. One run handles everyone, so with many users each person gets a smaller share of the scoring time; unscored jobs carry over to the next day.

### Upgrading from the single-user version

`APP_PASSWORD` and `ANTHROPIC_API_KEY` are no longer used; remove them from Vercel. The **first account created** takes over the existing companies, settings, scores and emailed-job history, so set `SIGNUP_CODE` before deploying (you can remove it afterwards) and sign up straight away. Then paste your Anthropic API key in Settings.

## Accounts and security

- Passwords are hashed with scrypt (N=32768, r=8, p=1) and a random 16-byte salt per user. There's no password reset; a forgotten password needs a manual database fix.
- Sessions are random 256-bit tokens in an HttpOnly cookie; only their SHA-256 hash is stored. Sessions last 30 days, and changing your password signs out other devices.
- After 10 wrong passwords an account is locked for 15 minutes. Login responses don't reveal whether an email has an account.
- Anthropic API keys are checked with Anthropic when saved, then encrypted with AES-256-GCM using `ENCRYPTION_KEY`. The user's ID is bound into the encryption, so a key copied onto another user's row won't decrypt. Keys are never sent back to the browser (Settings shows only `sk-ant-…` and the last 4 characters). Someone with both the database and `ENCRYPTION_KEY` (in practice, whoever runs the deployment) can decrypt them, which is unavoidable because the daily job has to use them while users are away. Users should use a dedicated key with a spend limit.
- Deleting an account removes its companies, scores, essays, sessions and saved key.
- Job pages, essays and draft generation only work for jobs on boards the signed-in user tracks. After logging in from an email link you're returned to that job (only paths inside the app are allowed as return destinations).

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and ENCRYPTION_KEY at least
npm run dev                  # http://localhost:3000
npm run daily -- --dry-run   # run the daily check from the command line without sending email
```

## Jobs page

- **Filters:** keywords, a company dropdown (with job counts), date posted (past 24 hours, week, or month), and "New today" / "New this week" for jobs that appeared after you started tracking the company (the email's links open this view). "Show non-matching too" includes jobs outside your Settings filters.
- **Keywords** search the title, company, department, location, AI reason and the full job description. Every term must match as a whole word (`go` doesn't match "good"); use `"quotes"` for phrases and a trailing `*` for word beginnings (`infra*`).
- **Sort** by most recently posted or by fit score. Unscored jobs sort last.
- **Fit scores:** new jobs are scored automatically. To score jobs that were already open when you added a company, filter to the jobs you care about and click **Score unscored jobs in this view**; each click scores for about 3 minutes, so click again to continue. The daily run also scores a batch of unscored jobs with its leftover time. If you edit your resume, existing scores are shown faded and get rescored.

## Job pages and essays

Clicking a job (in the app or in the daily email) opens its page in the app: salary if posted, location, posting age, fit score, an **Apply on the company's site** button, and the job description.

- **Application questions** are loaded the first time anyone opens the job and cached for a week. Greenhouse provides them (and pay ranges) through its official job board API. For Ashby they come from the GraphQL endpoint Ashby's own job pages use, which isn't an official API and could change; if it fails, the page says so and the Apply button still works.
- **Explain this score** compares your resume with the posting in four areas (skills & technologies, experience & seniority, domain & role type, requirements & logistics), listing matches and gaps for each, which posting keywords appear in your resume (checked exactly, not by the model), what drove the score, and things your resume may not be showing. You can add context your resume doesn't show. It uses Claude Opus with your API key (about 3-5¢), is saved per job, and is marked out of date when your resume changes. Its score is a second opinion; **Use this score** replaces the daily (Claude Haiku) score for that job.
- **Essay questions** (free-text answers; not available for Lever jobs, whose public API doesn't include the application form) each get an editor with a word count (showing the question's target length, e.g. 200-400 words), **Save** and **Copy**. The app can't submit applications; copy your answers into the company's form.
- **Generate draft / Revise draft** writes an answer with Claude Opus 5.5 using your own API key (roughly 2-3 cents a draft), streamed into the editor. It uses your resume, the job description, optional guidance, and your most relevant past answers, which are listed so you can remove or add others. Drafts are told to use only facts from your materials and to leave [bracketed notes] where something's missing.
- **Some companies have rules about AI-written answers.** When a form has a question about the company's AI policy (Anthropic's does), the job page shows it, with its links, above the essays. Read it before using a draft, and treat drafts as a starting point to rewrite in your own words.
- **Essays page:** every saved answer, with search, editing and delete. Saved essays keep their own copy of the question, company and job title, so they stay available (and keep informing new drafts) after the job is gone.

## Discover

The tracker monitors companies you've chosen; **Discover** helps you find new ones. Upload (or paste) up to 5 screenshots of a list of companies, such as a LinkedIn post of startups that are hiring:

1. **Read** (Claude Haiku, under 1¢): the company names, and careers URLs if shown, are pulled out of the images.
2. **Pick:** you get a checklist. Companies you already track are unticked, and you can edit names, untick or add companies. Nothing else runs until you click **Check**.
3. **Find boards (free):** each company's Greenhouse, Ashby or Lever board is found from its URL or by trying likely board names built from its name. Matching roles are counted against your Settings filters (title keywords and locations). A board found only by guessing is flagged if its job descriptions don't mention the company, since it may belong to a different company with the same name.
4. **Search the web (optional, about 2-4¢ each):** for companies not found, one Claude Sonnet web search finds the careers page; the result is then checked like a pasted URL. Addresses on private or internal networks are ignored.
5. **Rate fit (one Claude Haiku call per batch, about 1-3¢):** a strong / possible / weak rating with a one-line note, based on your resume, each company's matching roles and a short description excerpt.
6. **Track** adds a company to the tracker with the usual engineering departments pre-selected.

All AI steps use your own API key. Results are saved, so you can leave and come back; discoveries are deleted after 90 days.

## Data retention

To keep the database small, and because older postings are more likely to be stale:

- Jobs posted more than 90 days ago (by the date on the company's job board) are never stored, even if they're still open. Adding a company shows how many open jobs that skips.
- Each daily run first deletes stored jobs that have passed 90 days since posting, together with every user's scores for them, plus closed jobs removed more than 90 days ago, run logs and Discover results older than 90 days, and expired login sessions.
- A job with no posting date is kept while it's open, since deleting it would make it look new the next time the board is fetched. It's deleted 90 days after it closes.

The window is `RETENTION_DAYS` in `lib/retention.ts`.

## How the daily check works

For each company:

1. Fetch the whole board (filters are applied on our side; neither API filters on theirs).
2. If the fetch fails, or returns zero jobs when there were open jobs before, record a failure and change nothing. This stops an outage from marking every job as removed and then re-announcing them all as new.
3. Jobs with an ID we haven't seen are **new**. New jobs are checked against your filters; ones that fail are recorded but never emailed. A new job with the same title and location as an earlier one is flagged as a likely repost.
4. Jobs that disappeared are marked removed. If one comes back, it's reopened without counting as new.

Then, for each user:

1. Jobs that appeared after they started tracking the company and pass their filters are scored with their API key. New jobs always get scoring time before any older backlog.
2. A new job that couldn't be scored in time (or because scoring failed) is held for the next run, so the email stays ranked. After 2 days it's sent anyway, marked "not scored", with a note if scoring is failing (e.g. a revoked key or no credits).
3. The email lists the best jobs at or above the user's minimum score, up to their per-email limit, and counts the rest per company with links to the app. Jobs left out of the email are still on the Jobs page.

Any time left over is used to score older open jobs. Jobs are marked as emailed only after the email is sent, so a failed send is retried the next day.

Changing filters affects future new jobs and the Jobs page; it never re-announces jobs you've already seen.

## Project layout

- `lib/ats/`: Greenhouse, Ashby and Lever adapters, plus board detection
- `lib/companies.ts`: adding a company (baseline) and diffing a fresh fetch against stored jobs
- `lib/filters.ts`: department, title and location filters
- `lib/scoring.ts`: resume matching with Claude Haiku (structured JSON output); `lib/score-jobs.ts`: time-limited batch scoring
- `lib/search.ts`: whole-word keyword search over open jobs
- `lib/retention.ts`: the 90-day retention window and daily purge
- `lib/ats/details.ts`: application questions and pay ranges; `lib/job-details.ts`: the job page loader
- `lib/explain.ts`: the Explain this score analysis
- `lib/essays.ts`: saved essays and finding related ones; `lib/drafts.ts` and `app/api/essays/generate`: draft generation
- `lib/discover.ts`, `app/discover/` and `app/api/discover/extract`: Discover
- `lib/run.ts`: the daily pipeline; `lib/email.ts`: the digest email
- `lib/auth.ts`: accounts and sessions; `lib/crypto.ts`: password hashing and API-key encryption
- `lib/schema.ts`: database schema
- `app/`: Next.js pages (Companies, Jobs, Settings, login) and `app/api/cron/daily`
