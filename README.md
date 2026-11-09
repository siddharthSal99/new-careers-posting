# Job Tracker

Tracks the careers pages of companies you care about and emails you once a day when **new** jobs appear, so you can focus on postings that are less likely to be stale.

- Paste a careers page URL (e.g. `https://openai.com/careers/search/`). The app finds the company's Greenhouse or Ashby job board behind it and saves every current job as already seen.
- Once a day it fetches each board, compares it with what's saved, and emails you the jobs that are new **and** match your filters. If nothing is new, no email is sent.
- Filters: departments (per company), title keywords, and locations (with an option for remote).
- Optional AI matching: with an Anthropic API key, each new matching job is scored 0-10 against your resume by Claude Haiku, with a one-line reason and any hard blockers (clearance, visa, years of experience). Poor fits go in a collapsed section of the email rather than being dropped.
- Also tracks removed jobs, flags likely reposts (same title and location as an earlier job), and warns you in the email if a board keeps failing to load.

Supported job boards: **Greenhouse** and **Ashby**.

## How it finds the board

1. The URL is a board URL itself (`jobs.ashbyhq.com/openai`, `job-boards.greenhouse.io/anthropic`).
2. Otherwise it loads the careers page and looks for links to a Greenhouse or Ashby board (this is how `anthropic.com/careers/jobs` is found).
3. If the page blocks automated requests (openai.com does), it guesses the board name from the domain (`openai`) and checks whether that board exists and has jobs. Guessed matches are labelled so you can check the name and job count before saving.

Daily checks call only the boards' public JSON APIs, never the company's own website.

## Deploying (free tiers)

1. **Database:** create a free Postgres database on [Neon](https://neon.tech) and copy the **pooled** connection string. Tables are created automatically the first time the app connects.
2. **Email:** create a [Resend](https://resend.com) account and an API key. With Resend's shared sender (`onboarding@resend.dev`) you can only send to the email address you signed up with, which is fine for a personal app. To send from your own address, verify a domain in Resend and set `RESEND_FROM`.
3. **AI matching (optional):** create an API key at [platform.claude.com](https://platform.claude.com). At a few dozen new jobs a day this costs well under $1/month.
4. **Vercel:** import this repository into [Vercel](https://vercel.com) and set the environment variables from `.env.example`:

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | Neon pooled connection string |
   | `APP_PASSWORD` | yes | Password for the web UI |
   | `CRON_SECRET` | yes | Any long random string; Vercel sends it to the cron route |
   | `RESEND_API_KEY` | for email | Without it the digest is only written to the logs |
   | `RESEND_FROM` | no | Defaults to `Job Tracker <onboarding@resend.dev>` |
   | `ANTHROPIC_API_KEY` | no | Turns on AI resume matching |
   | `APP_URL` | no | Your deployment URL, for the link in emails |

5. Open the app, log in, fill in **Settings** (email, locations, resume), and add companies.

The daily check is scheduled in `vercel.json` (`0 14 * * *`, i.e. 14:00 UTC). On Vercel's Hobby plan, cron jobs run at most once a day and may fire at any point within the scheduled hour. The cron route and the home page set `maxDuration = 300`; if your plan rejects that, lower it in `app/api/cron/daily/route.ts` and `app/page.tsx`.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and APP_PASSWORD at least
npm run dev                  # http://localhost:3000
npm run daily -- --dry-run   # run the daily check from the command line without sending email
```

## Jobs page

- **Filters:** company, keywords, and date posted (past 24 hours, week, or month). "Show non-matching too" includes jobs outside your Settings filters.
- **Keywords** search the title, company, department, location, AI reason and the full job description. Every term must match as a whole word (`go` doesn't match "good"); use `"quotes"` for phrases and a trailing `*` for word beginnings (`infra*`).
- **Sort** by most recently posted or by fit score. Unscored jobs sort last.
- **Fit scores:** new jobs are scored automatically. To score jobs that were already open when you added a company, filter to the jobs you care about and click **Score unscored jobs in this view**; each click scores for about 3 minutes, so click again to continue. The daily run also scores a batch of unscored jobs with its leftover time. If you edit your resume, existing scores are shown faded and get rescored.

## How the daily check works

For each company:

1. Fetch the whole board (filters are applied on our side; neither API filters on theirs).
2. If the fetch fails, or returns zero jobs when there were open jobs before, record a failure and change nothing. This stops an outage from marking every job as removed and then re-announcing them all as new.
3. Jobs with an ID we haven't seen are **new**. New jobs are checked against your filters; ones that fail are recorded but never emailed. A new job with the same title and location as an earlier one is flagged as a likely repost.
4. Jobs that disappeared are marked removed. If one comes back, it's reopened without counting as new.

Then the new matching jobs are scored (if AI matching is on) and sent in one email. Any time left over is used to score older open jobs. Jobs are marked as emailed only after the email is sent, so a failed send is retried the next day.

Changing filters affects future new jobs and the Jobs page; it never re-announces jobs you've already seen.

## Project layout

- `lib/ats/`: Greenhouse and Ashby adapters, plus board detection
- `lib/companies.ts`: adding a company (baseline) and diffing a fresh fetch against stored jobs
- `lib/filters.ts`: department, title and location filters
- `lib/scoring.ts`: resume matching with Claude Haiku (structured JSON output); `lib/score-jobs.ts`: time-limited batch scoring
- `lib/search.ts`: whole-word keyword search over open jobs
- `lib/run.ts`: the daily pipeline; `lib/email.ts`: the digest email
- `lib/schema.ts`: database schema
- `app/`: Next.js pages (Companies, Jobs, Settings, login) and `app/api/cron/daily`
