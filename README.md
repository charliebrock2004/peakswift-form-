# PeakSwift client onboarding

Short website enquiry form any business can fill in from their phone, plus the private Studio inbox where those briefs are read. Each completed brief is also emailed to PeakSwiftstudio@gmail.com.

Clients do not need an account. They move through five short sections, review their answers, and submit. PeakSwift gets an email, then opens Studio with an access code to see the brief and any photos.

## What the client does

1. Business & contact — business name*, your name*, email*, phone, town or area
2. About the business — what it does*, main services (add more), what makes it different, opening hours
3. Website design — style, colours, two example sites, features needed
4. Existing materials — logo, photos, existing website, social links, domain / Google Business Profile (can be skipped)
5. Final details — timescale, budget, anything else
6. Review — edit any section, tick to confirm, Submit, then a reference number

- Only the four fields marked * are required
- Optional JPG, PNG, WEBP and SVG uploads can be removed before sending
- Answers stay in the browser until they send. Photos stay only until they submit or close the page

## Email notifications

After a brief is saved and finalised, the server emails PeakSwiftstudio@gmail.com with every answer, what was left blank, the uploaded file names and an “Open in Studio” link. Files are never attached or linked publicly; Studio still needs the access code.

- The database is the source of truth. An email failure never fails or loses a submission.
- Each brief has a `notification_status`: `pending`, `sending`, `sent`, `failed` or `skipped` (briefs from before this feature).
- Sending is claimed atomically, so a retried or duplicated request cannot send twice.
- Failed or pending emails are retried by a daily Vercel Cron (`/api/notify-retry`, declared in `vite.config.ts` because Nitro writes the Vercel output config; needs `CRON_SECRET` of 16+ characters), up to 5 automatic attempts, and from Studio with “Send email notification”.
- Studio shows the email status on each brief and “Email failed” in the inbox list.

## Studio

Open `/studio`.

1. First visit: enter the setup key, then choose an access code of at least 8 characters.
2. Later visits: enter that access code.
3. “Reset access code” asks for the setup key again and signs every other session out.

Locally, if `STUDIO_SETUP_KEY` is not set, the setup key is `PEAKSWIFT`.

On Vercel that fallback is turned off. Set `STUDIO_SETUP_KEY` in the project environment or Studio cannot be set up.

## Storage

Briefs and files live in Postgres.

- Text is in `briefs`
- Files are stored as private `bytea` rows in `brief_files`, not on a public URL
- A file can be opened only with a Studio session cookie
- Drafts that are never finished are deleted after two hours
- There is no public bucket

Without `DATABASE_URL`, local preview uses an in-memory database. That is only for trying the form. Real submissions need Postgres.

## Environment

See [.env.example](./.env.example).

| Name | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Server | Postgres connection string. Required in production. |
| `STUDIO_SETUP_KEY` | Server | First-run and reset key for Studio. Required on Vercel. |
| `SMTP_USER` | Server | Gmail address that sends the notification (PeakSwiftstudio@gmail.com). |
| `SMTP_PASSWORD` | Server | Google App Password for that account (not the normal password). |
| `CRON_SECRET` | Server | Protects the daily email retry job. |
| `SMTP_HOST`, `SMTP_PORT`, `NOTIFY_FROM`, `NOTIFY_TO`, `APP_BASE_URL` | Server | Optional overrides. |

None of these are exposed to the browser. Do not commit `.env`.

## Checking production

Open `/api/health` on the live site. It reports states only, never values:

- `database`: `connected`, `not-configured` (no `DATABASE_URL` in this Vercel environment) or `error` with a code in `databaseError` (for example `ECONNREFUSED`, `28P01` wrong password, `3D000` unknown database)
- `schema`: `ready` once the tables exist. The server applies missing migrations itself on first connection, so this fixes itself once the database is reachable
- `email` / `cron`: whether `SMTP_USER` + `SMTP_PASSWORD` and a 16+ character `CRON_SECRET` are set
- `emailProblem`: when email is off, the exact reason, naming the variable (never its value)
- `emailVariables`: which email variable names this deployment can see (`set`, `blank` or `missing`). `SMTP_USERNAME`/`GMAIL_USER` and `SMTP_PASS`/`GMAIL_APP_PASSWORD` are accepted as alternatives
- `commit`: the deployed Git commit

On Vercel the app never falls back to the local embedded database. Without `DATABASE_URL` the form returns a clear "temporarily unavailable" message, and the function log says exactly which variable is missing.

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run dev` serves the app on port 8080.

`npm run build` also applies `migrations/` when `DATABASE_URL` is set.

## Deploy on Vercel

1. Import this repository.
2. Framework preset can stay on the Vite / TanStack build (`npm run build`).
3. Add a Postgres database (Neon works) and set `DATABASE_URL`.
4. Set `STUDIO_SETUP_KEY` to a private value of at least 8 characters.
5. Set `SMTP_USER`, `SMTP_PASSWORD` and `CRON_SECRET` for email notifications.
6. Deploy, open `/studio`, enter that setup key, and choose the access code.

The repository should stay private. It is the source for an app that stores client business details.

Uploaded files are not world-readable. Do not add a public storage bucket.
