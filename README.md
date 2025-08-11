# Cathay Redemption Tracker

Track Cathay Pacific award availability for selected routes and dates. The app checks on a schedule and emails you when seats appear. A simple web UI lets you add watches, test a one‑day search, and open a login window to persist your elite session (Diamond benefits).

## Features

- Simple web UI at `/` to create and manage watches
- One‑click “Test search” preview with filters (non‑stop, minimum cabin)
- Hourly cron (configurable) to scan and notify via email
- Authenticated browsing via Playwright with a persistent Chrome profile (`pw-data`)
- Caching layer to reduce load and avoid rate limits
- REST API for automation

## How it works (high-level)

Cathay’s redemption site uses an entry flow (`IBEFacade`) and a subsequent availability endpoint. This app:
- Navigates to the official entry URL with your parameters (similar to the userscript flow)
- Waits for the site’s availability request to complete
- Parses the returned JSON (per segment, per cabin availability)
- Supports logged-in sessions via a persistent Chromium profile so your Diamond entitlements apply

## Requirements

- Node.js 18+ (tested with Node 22)
- Chromium (installed automatically by Playwright)

## Setup

1) Install dependencies

```
npm install
npx playwright install chromium
```

2) Configure environment

```
cp .env.example .env
# edit .env
```

Env keys:
- PORT: server port (default 8080)
- BASE_URL: base URL for links in emails
- CRON_SCHEDULE: cron pattern (default hourly: `0 * * * *`)
- SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM: SMTP settings for email
- PW_HEADFUL: 1 to run the browser with UI; 0 for headless checks
- PW_CHROMIUM_CHANNEL: optional channel name (e.g., `chrome`)

3) Run in dev

```
npm run dev
```

or build and run

```
npm run build
npm start
```

Open `http://localhost:8080`

## First-time login (persist cookies)

- Click “Open Cathay login window” in the UI.
- A Chromium window opens using the persistent profile directory `pw-data/`.
- Sign in to your Cathay account. Close the window when done.
- All subsequent background searches reuse this session and benefit from your status.

Tip: If a search returns “bot check” or no JSON, try logging in again or temporarily set `PW_HEADFUL=1` in `.env` and re-run.

## Using the UI

- Fill From/To (IATA codes), date range, passengers, email, filters.
- Click “Add watch” to save. Watches run hourly by default.
- Click “Test search” to preview one day using the Start date and current filters.
- Delete watches from the table.

## API

- POST `/api/watch`
```
{
  "from":"HKG","to":"LHR",
  "startDate":"2025-09-01","endDate":"2025-09-10",
  "numAdults":1,"numChildren":0,
  "email":"you@example.com",
  "nonstopOnly":true,
  "minCabin":"C"   // optional: Y|W|C|F
}
```

- GET `/api/watch` — list watches
- DELETE `/api/watch/:id`
- POST `/api/open-login` — open a browser window for you to sign in
- GET `/api/search?from=HKG&to=LHR&date=2025-09-01&adults=1&children=0` — on‑demand single‑day search (uses cache)

## Cron, cache, storage

- Cron schedule: `CRON_SCHEDULE` (default hourly). Uses `node-cron`.
- Results cache: 30–55 minutes to reduce server load and avoid rate limits.
- Persistent browser profile: `pw-data/` (checked in .gitignore).
- SQLite database: `data.sqlite` (created at runtime; ignored by git).

## Troubleshooting

- Can’t reach localhost: ensure the app is listening on `0.0.0.0:${PORT}` (already configured) and your environment forwards the port.
- Bot checks / no JSON: open the login window and authenticate, then retry. You can also set `PW_HEADFUL=1` briefly.
- Email not sending: verify SMTP credentials and port (`465` sets secure mode automatically).
- No flights in preview but exist on site: try clearing the cache by waiting 30–55 minutes or adjusting dates; availability is time‑sensitive.

## Security notes

- Keep your `.env` private. Never commit secrets.
- The persistent browser profile (cookies) lives in `pw-data/`. Treat it as sensitive.

## Development

- Code: TypeScript in `src/`, compiled to `dist/` via `tsc`.
- UI: static `public/index.html` using fetch to the REST API.
- Linting/formatting intentionally minimal for brevity; add your preferred tools.

---

Inspired by community efforts to interface with Cathay’s redemption flow; this implementation uses a headless browser to stick closely to the official website behavior.