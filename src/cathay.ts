import { chromium, BrowserContext, Response } from 'playwright';
import { config } from './config.js';
import { FlightOption, SearchResult } from './types.js';

const USER_DATA_DIR = './pw-data';
const ENTRY_LANG = 'en';
const ENTRY_COUNTRY = 'HK';

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function msToDurationMinutes(ms: number): number {
  return Math.round(ms / 60000);
}

function toIsoUtc(ts: number): string {
  return new Date(ts).toISOString();
}

function buildIbefacadeUrl(route: { from: string; to: string; date: string }, pax: { adult: number; child: number }, cabin: 'Y'|'W'|'C'|'F' = 'Y') {
  const url = new URL('https://api.cathaypacific.com/redibe/IBEFacade');
  const params = new URLSearchParams();
  params.set('ACTION', 'RED_AWARD_SEARCH');
  params.set('ENTRYPOINT', `https://www.cathaypacific.com/cx/${ENTRY_LANG}_${ENTRY_COUNTRY}/book-a-trip/redeem-flights/redeem-flight-awards.html`);
  params.set('ENTRYLANGUAGE', ENTRY_LANG);
  params.set('ENTRYCOUNTRY', ENTRY_COUNTRY);
  params.set('RETURNURL', `https://www.cathaypacific.com/cx/${ENTRY_LANG}_${ENTRY_COUNTRY}/book-a-trip/redeem-flights/redeem-flight-awards.html?recent_search=ow`);
  params.set('ERRORURL', `https://www.cathaypacific.com/cx/${ENTRY_LANG}_${ENTRY_COUNTRY}/book-a-trip/redeem-flights/redeem-flight-awards.html?recent_search=ow`);
  params.set('CABINCLASS', cabin);
  params.set('BRAND', 'CX');
  params.set('ADULT', String(pax.adult || 1));
  params.set('CHILD', String(pax.child || 0));
  params.set('FLEXIBLEDATE', 'false');
  params.set('ORIGIN[1]', route.from);
  params.set('DESTINATION[1]', route.to);
  params.set('DEPARTUREDATE[1]', route.date);
  params.set('LOGINURL', `https://www.cathaypacific.com/cx/${ENTRY_LANG}_${ENTRY_COUNTRY}/sign-in/campaigns/miles-flight.html`);
  url.search = params.toString();
  return url.toString();
}

function parseFlights(payload: any): FlightOption[] {
  const root = payload?.modelObject ?? (payload?.pageBom ? JSON.parse(payload.pageBom) : null);
  const bound = root?.availabilities?.upsell?.bounds?.[0];
  const flights: FlightOption[] = [];
  if (!bound?.flights) return flights;

  for (const f of bound.flights) {
    const segs = f.segments || [];
    if (segs.length === 0) continue;

    const seg1 = segs[0];
    const leg1Air = seg1.flightIdentifier.marketingAirline;
    const leg1Num = seg1.flightIdentifier.flightNumber;
    const origin = seg1.originLocation.slice(-3);
    const destEnd = (segs.length === 1 ? seg1.destinationLocation : segs[1].destinationLocation).slice(-3);
    const departTs = seg1.flightIdentifier.originDate as number;
    const arriveTs = segs.length === 1 ? (seg1.destinationDate as number) : (segs[1].destinationDate as number);

    const leg1F = Number(seg1.cabins?.F?.status || 0);
    const leg1J = Number(seg1.cabins?.B?.status || 0);
    const leg1P = Number(seg1.cabins?.N?.status || 0);
    const leg1Y = Number(seg1.cabins?.E?.status || 0) + Number(seg1.cabins?.R?.status || 0);

    let direct = true;
    let stopCity: string | undefined;
    let marketingAirline = leg1Air;
    const flightNumbers: string[] = [leg1Air + leg1Num];

    let fAvail = leg1F, jAvail = leg1J, pAvail = leg1P, yAvail = leg1Y;

    if (segs.length > 1) {
      direct = false;
      const seg2 = segs[1];
      const leg2F = Number(seg2.cabins?.F?.status || 0);
      const leg2J = Number(seg2.cabins?.B?.status || 0);
      const leg2P = Number(seg2.cabins?.N?.status || 0);
      const leg2Y = Number(seg2.cabins?.E?.status || 0) + Number(seg2.cabins?.R?.status || 0);
      // For connections, availability is min of segments per cabin
      fAvail = Math.min(fAvail, leg2F);
      jAvail = Math.min(jAvail, leg2J);
      pAvail = Math.min(pAvail, leg2P);
      yAvail = Math.min(yAvail, leg2Y);
      marketingAirline = `${leg1Air}/${seg2.flightIdentifier.marketingAirline}`;
      flightNumbers.push(seg2.flightIdentifier.marketingAirline + seg2.flightIdentifier.flightNumber);
      const match = /^[A-Z]{3}:([A-Z:]{3,7}):[A-Z]{3}_/.exec(f.flightIdString);
      if (match?.[1]) stopCity = match[1].replace(':', ' / ');
    }

    flights.push({
      direct,
      marketingAirline,
      flightNumbers,
      origin,
      destination: destEnd,
      stopCity,
      departureUtc: toIsoUtc(departTs),
      arrivalUtc: toIsoUtc(arriveTs),
      durationMinutes: msToDurationMinutes(f.duration),
      availability: {
        first: fAvail || 0,
        business: jAvail || 0,
        premium: pAvail || 0,
        economy: yAvail || 0,
      },
    });
  }
  return flights;
}

export class CathayClient {
  private context: BrowserContext | null = null;

  async ensureContext(forceHeadful?: boolean) {
    if (this.context) return this.context;
    const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: forceHeadful ? false : !config.playwright.headful,
      channel: config.playwright.channel,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    });
    this.context = browser;
    return this.context;
  }

  async warmup(): Promise<void> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    await page.goto(`https://www.cathaypacific.com/cx/${ENTRY_LANG}_${ENTRY_COUNTRY}/book-a-trip/redeem-flights/redeem-flight-awards.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.close();
  }

  async openLoginWindow(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    const ctx = await this.ensureContext(true);
    const page = await ctx.newPage();
    const loginUrl = `https://www.cathaypacific.com/content/cx/${ENTRY_LANG}_${ENTRY_COUNTRY}/sign-in.html`;
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    // Keep window open for user to authenticate; cookies persist in USER_DATA_DIR
  }

  async searchSingleDay(params: { from: string; to: string; dateYmd: string; adults: number; children: number; cabin?: 'Y'|'W'|'C'|'F' }): Promise<SearchResult> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();

    const url = buildIbefacadeUrl({ from: params.from, to: params.to, date: params.dateYmd }, { adult: params.adults, child: params.children }, params.cabin || 'Y');

    const waitAvailability = page.waitForResponse((resp: Response) => {
      return resp.request().method() === 'POST' && resp.url().includes('/CathayPacificAwardV3/dyn/air/booking/availability');
    }, { timeout: 45000 }).catch(() => null);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const resp = await waitAvailability;

    let result: SearchResult = { date: params.dateYmd, from: params.from, to: params.to, flights: [] };

    if (!resp) {
      result.error = 'No availability response (possible bot check or session required)';
      await page.close();
      return result;
    }

    let json: any;
    try {
      json = await resp.json();
    } catch (e) {
      result.error = 'Invalid JSON from availability endpoint';
      await page.close();
      return result;
    }

    result.flights = parseFlights(json);

    await page.close();
    return result;
  }
}

export function toCathayYmd(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return ymd(d);
}