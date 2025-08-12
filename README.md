# Cathay Redemption Tracker

Track Cathay Pacific award availability for selected routes and dates. The app checks on a schedule and emails you when seats appear. A simple web UI lets you add watches, test a one‑day search, and open a login window to persist your elite session (Diamond benefits). Optional per‑user credential storage enables automatic re‑login if Cathay expires your session.

## Features

- Network‑first polling using the site’s real availability endpoint (fast; no UI scraping)
- Persistent Playwright profile (`pw-data`) plus HTTP‑first template reuse for speed
- Automatic re‑login with stored credentials when the session is invalid
- Simple web UI at `/` to create watches and test searches
- Status endpoint `/api/status` to observe session state, last error/check, and template readiness
- Hourly cron (configurable) to scan and notify via email
- Result caching (30–55 min) to reduce load and avoid rate limits

## How it works

1) Seeding the session/template
- The app opens Cathay’s entry URL (IBEFacade) once in a real browser context, then captures the availability POST (URL + form body).
- Cookies live in `pw-data` so Cathay sees a persistent browser; OTP/device checks should be rare after the first login.

2) HTTP‑first polling
- For subsequent dates/routes, the app reuses cookies and mutates the captured POST parameters (date/from/to) to poll availability directly without page loads.
- If the template expires or returns 404/Access Denied, we refresh by running a single page flow again.

3) Automatic re‑login
- If HTTP‑first fails with 401/403 or bot‑block patterns and stored credentials exist, the app attempts a headful membership‑number login, verifies via `getProfile`, then retries the search.
- If credentials are not stored, the UI offers “Open Cathay login window” so you can sign in manually.

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

Important envs:
- PORT: server port (default 8080)
- BASE_URL: base URL for links in emails
- CRON_SCHEDULE: cron pattern (default `0 * * * *` hourly)
- SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM: SMTP settings for email
- PW_HEADFUL: 1 to run the browser with UI; 0 for headless checks
- SECRET_KEY: required for encrypting per‑user credentials (set a strong 32+ char secret)
- Optional webhook notifiers (placeholders): `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `PUSHOVER_USER_KEY`, `PUSHOVER_API_TOKEN` (implementations TBD)

3) Run
```
npm run dev
# or
npm run build && npm start
```
Open `http://localhost:8080`

## First‑time login and credentials

Two ways to maintain a logged‑in state (you can use either or both):

- Persistent cookies (recommended baseline): In the UI, click “Open Cathay login window,” sign in once; cookies persist in `pw-data/` for future checks. OTP prompts should be rare with this approach.

- Automatic re‑login (optional): Store your Cathay membership number + password so the app can re‑authenticate if the session expires.
  - POST `/api/user` with JSON `{ email, cathayMember, cathayPassword }`
  - The password is encrypted at rest using AES‑256‑GCM with `SECRET_KEY`.
  - The scheduler attempts auto re‑login only when the session is invalid.

Note: You can use both: sign in once to seed cookies; if the site later logs out the session, auto re‑login will kick in.

## Using the UI

- Fill From/To (IATA codes), date range, passengers, email, filters.
- Click “Add watch” to save. Watches run hourly by default.
- Click “Test search” to preview one day using the Start date and current filters.
- “Open Cathay login window” prompts a headful login to refresh cookies when needed.

## API

- POST `/api/user`
```
{
  "email":"you@example.com",
  "cathayMember":"xxxxxx",
  "cathayPassword":"your-password"
}
```
Response: `{ userId }`

- GET `/api/user/:id` — shows which fields are set (does not return raw secrets)

- POST `/api/watch`
```
{
  "userId": 1,                      // optional; inferred from email if omitted
  "from":"HKG","to":"LHR",
  "startDate":"2025-09-01","endDate":"2025-09-10",
  "numAdults":1,"numChildren":0,
  "email":"you@example.com",
  "nonstopOnly":true,
  "minCabin":"C"                 // optional: Y|W|C|F
}
```
Response: `{ id, userId }`

- GET `/api/watch?userId=1` — list watches (optionally for a specific user)
- DELETE `/api/watch/:id`
- POST `/api/open-login` — opens a headful window to sign in
- GET `/api/search?from=HKG&to=LHR&date=2025-09-01&adults=1&children=0` — single‑day search (uses cache; HTTP‑first when possible)
- GET `/api/status` — status flags `{ needsLogin, lastError, lastCheckAt, httpTemplateReady }`

## Cron, cache, storage

- Cron schedule: `CRON_SCHEDULE` (default hourly). Uses `node-cron`.
- Results cache: 30–55 minutes to reduce server load and avoid rate limits.
- Persistent browser profile: `pw-data/` (gitignored).
- SQLite: `data.sqlite` (created at runtime; gitignored).

## Reliability strategy

- HTTP‑first polling with real cookies for speed and resilience
- Auto re‑login when invalid session is detected (only if credentials are stored)
- Template refresh via a single browser navigation if the availability POST template expires
- Exponential backoff and cache to lower bot‑detection surface

## Security notes

- Never commit secrets; keep `.env` private. Set a strong `SECRET_KEY`.
- Encrypted credentials are stored per user (AES‑256‑GCM). We do not log raw passwords.
- Cookie profile (`pw-data/`) contains login cookies; treat it as sensitive.
- Use at your own risk; automating a third‑party site may be against their TOS.

## Development

- Code: TypeScript in `src/`, compiled to `dist/` via `tsc`.
- UI: static `public/index.html` using fetch to the REST API.
- Preferred flow: run headful (`PW_HEADFUL=1`) while testing login, then switch to headless.

---

Roadmap
- Add notifier adapters (Discord/Slack/Pushover)
- Enhance status panel in UI to show backoff timers and last template refresh
- Queue-based scheduler (BullMQ) for multi‑tenant scale