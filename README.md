# Job Tracker

Tracks the careers pages of companies you care about and emails you once a day when **new** jobs appear, so you can focus on postings that are less likely to be stale.

Multiple people can use one deployment. Each user has their own account, companies, filters, resume, digest email and Anthropic API key; job boards that several people track are fetched once.

- Paste a careers page URL (e.g. `https://openai.com/careers/search/`). The app finds the company's Greenhouse or Ashby job board behind it and saves every current job as already seen.
- Once a day it fetches each board, compares it with what's saved, and emails you the jobs that are new **and** match your filters. If nothing is new, no email is sent.
- The email stays short however many companies you track: it lists your best matches (15 by default) and counts the rest per company, with links to them in the app. With AI matching on, only jobs scoring at or above your minimum (7/10 by default) are listed, and if none qualify no email is sent. Both limits are in Settings.
- Filters: departments (per company), title keywords, and locations (with an option for remote).
- Optional AI matching: each user can save their own Anthropic API key in Settings. New matching jobs are then scored 0-10 against their resume by Claude Haiku, with a one-line reason and any hard blockers (clearance, visa, years of experience). Poor fits go in a collapsed section of the email rather than being dropped.
- Also tracks removed jobs, flags likely reposts (same title and location as an earlier job), and warns you in the email if a board keeps failing to load.

Supported job boards: **Greenhouse** and **Ashby**.

## How it finds the board

1. The URL is a board URL itself (`jobs.ashbyhq.com/openai`, `job-boards.greenhouse.io/anthropic`).
2. Otherwise it loads the careers page and looks for links to a Greenhouse or Ashby board (this is how `anthropic.com/careers/jobs` is found).
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
- Deleting an account removes its companies, scores, sessions and saved key.

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

- `lib/ats/`: Greenhouse and Ashby adapters, plus board detection
- `lib/companies.ts`: adding a company (baseline) and diffing a fresh fetch against stored jobs
- `lib/filters.ts`: department, title and location filters
- `lib/scoring.ts`: resume matching with Claude Haiku (structured JSON output); `lib/score-jobs.ts`: time-limited batch scoring
- `lib/search.ts`: whole-word keyword search over open jobs
- `lib/run.ts`: the daily pipeline; `lib/email.ts`: the digest email
- `lib/auth.ts`: accounts and sessions; `lib/crypto.ts`: password hashing and API-key encryption
- `lib/schema.ts`: database schema
- `app/`: Next.js pages (Companies, Jobs, Settings, login) and `app/api/cron/daily`
