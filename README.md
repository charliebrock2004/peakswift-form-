# PeakSwift client onboarding

Private questionnaire a PeakSwift client fills in from their phone, plus the Studio inbox where those briefs are read.

Clients do not need an account. They get a link, move through short sections, review their answers, and submit. PeakSwift opens Studio with an access code and reads the brief there, including any photos.

## What the client does

- Welcome, eleven sections, review, then a reference number
- Business name is required
- Email or phone is required — one of them is enough
- Everything else can be left blank
- Services start as three rows, with “+ Add another service”
- Optional JPG, PNG, WEBP and SVG uploads can be removed before sending
- Answers stay in the browser until they send. Photos stay only until they submit or close the page

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

Neither variable is exposed to the browser. Do not commit `.env`.

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
5. Deploy, open `/studio`, enter that setup key, and choose the access code.

The repository should stay private. It is the source for an app that stores client business details.

Uploaded files are not world-readable. Do not add a public storage bucket.
