# CX Award Monitor

Track Cathay Pacific award availability for selected routes and dates. The service checks every hour and emails you when seats appear.

Important: Cathay uses bot checks and ephemeral TAB_ID sessions. This project opens the official web flow in a headless browser (Playwright), loads the IBEFacade URL (same as the userscript), and intercepts the availability POST to parse JSON results. You may need to sign in once in the Playwright browser to avoid blocks.

## Quick start

1. Install deps

```
npm install
npx playwright install chromium
```

2. Copy env and configure SMTP and schedule

```
cp .env.example .env
# edit .env
```

3. Run in dev

```
npm run dev
```

or build and run

```
npm run build
npm start
```

Open http://localhost:8080

## API

- POST `/api/watch`

```
{
  "from":"HKG","to":"LHR",
  "startDate":"2025-09-01","endDate":"2025-09-10",
  "numAdults":1,"numChildren":0,
  "email":"you@example.com",
  "nonstopOnly":true,
  "minCabin":"C"
}
```

- GET `/api/watch` — list watches
- DELETE `/api/watch/:id`
- GET `/api/search?from=HKG&to=LHR&date=2025-09-01&adults=1&children=0`

## Bot checks and login

- The first request may be blocked with a bot interstitial. Sign in manually once in the Playwright context:
  - Set `PW_HEADFUL=1` in `.env`
  - Start server and hit `/api/search` once
  - A Chromium window opens; sign in to Cathay if prompted. Subsequent runs reuse the saved state `.pw-state.json`.

## Notes

- SQLite database file: `data.sqlite`
- Cache: 30–55 minutes to reduce load and avoid rate limiting
- Cron: by default runs hourly (top of hour). Configure via `CRON_SCHEDULE`.