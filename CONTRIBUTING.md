# Contributing

Thanks for considering a contribution! This project is a simple Node/TypeScript web app that uses Playwright and SQLite.

## Dev setup

- Node 18+
- Install deps and Chromium:
  - `npm install`
  - `npx playwright install chromium`
- Copy `.env.example` to `.env` and adjust as needed
- Run dev server: `npm run dev`

## Code layout

- `src/` TypeScript sources
  - `server.ts` Express server + API + cron
  - `cathay.ts` Playwright client and parser
  - `db.ts` SQLite access via better-sqlite3
  - `mailer.ts` Nodemailer wrapper
  - `types.ts` shared types
  - `config.ts` dotenv loader
- `public/` Static UI served at `/`
- `dist/` build output (gitignored)

## Style

- Prefer clear names and early returns
- Add types for public functions
- Avoid committing commented-out code and unused imports

## Testing changes

- For login/session changes, set `PW_HEADFUL=1` and use “Open Cathay login window” in the UI
- For search flow changes, use “Test search” in the UI before relying on cron

## Submitting PRs

- Open an issue describing the change first if it’s substantial
- Keep PRs focused and include a brief description of the change and any user-facing impact
- Avoid committing secrets (.env) or browser profile (`pw-data/`)