import express from 'express';
import { z } from 'zod';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { addWatch, deleteWatch, listWatches, getCached, upsertCache } from './db.js';
import { CathayClient, toCathayYmd } from './cathay.js';
import { sendEmail } from './mailer.js';
import { FlightOption } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const client = new CathayClient();

const watchSchema = z.object({
  from: z.string().regex(/^[A-Z]{3}$/),
  to: z.string().regex(/^[A-Z]{3}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  numAdults: z.number().int().min(1).max(4).default(1),
  numChildren: z.number().int().min(0).max(4).default(0),
  email: z.string().email(),
  nonstopOnly: z.boolean().default(false),
  minCabin: z.enum(['Y','W','C','F']).optional(),
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/api/watch', (_req, res) => {
  res.json(listWatches());
});

app.post('/api/open-login', async (_req, res) => {
  try {
    await client.openLoginWindow();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed to open login window' });
  }
});

app.post('/api/watch', (req, res) => {
  const parsed = watchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;
  const id = addWatch({
    ...body,
    nonstopOnly: body.nonstopOnly ? 1 : 0,
  } as any);
  res.json({ id });
});

app.delete('/api/watch/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  deleteWatch(id);
  res.json({ ok: true });
});

app.get('/api/search', async (req, res) => {
  try {
    const from = String(req.query.from || '').toUpperCase();
    const to = String(req.query.to || '').toUpperCase();
    const date = String(req.query.date || ''); // YYYY-MM-DD
    const adults = Number(req.query.adults || 1);
    const children = Number(req.query.children || 0);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'invalid params' });
    }
    const ymd = toCathayYmd(date);

    const cached = getCached(ymd, from, to, 30 * 60 * 1000);
    if (cached) return res.json(JSON.parse(cached));

    const result = await client.searchSingleDay({ from, to, dateYmd: ymd, adults, children });
    upsertCache(ymd, from, to, JSON.stringify(result));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'search failed' });
  }
});

function cabinRank(cabin: 'Y'|'W'|'C'|'F') {
  return { Y: 0, W: 1, C: 2, F: 3 }[cabin];
}

function flightHasCabin(avail: FlightOption['availability'], min: 'Y'|'W'|'C'|'F') {
  const ranks = [
    { c: 'Y' as const, n: avail.economy },
    { c: 'W' as const, n: avail.premium },
    { c: 'C' as const, n: avail.business },
    { c: 'F' as const, n: avail.first },
  ];
  const threshold = cabinRank(min);
  return ranks.some((r) => cabinRank(r.c) >= threshold && r.n > 0);
}

async function runJobOnce() {
  const items = listWatches();
  if (items.length === 0) return;
  await client.warmup();

  for (const w of items) {
    const start = new Date(w.startDate + 'T00:00:00');
    const end = new Date(w.endDate + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ymd = toCathayYmd(d.toISOString().slice(0,10));
      const cached = getCached(ymd, w.from, w.to, 55 * 60 * 1000);
      let result;
      if (cached) {
        result = JSON.parse(cached);
      } else {
        result = await client.searchSingleDay({ from: w.from, to: w.to, dateYmd: ymd, adults: w.numAdults, children: w.numChildren });
        upsertCache(ymd, w.from, w.to, JSON.stringify(result));
      }
      if (result?.flights?.length) {
        const filtered = result.flights.filter((f: FlightOption) =>
          (!w.nonstopOnly || f.direct) && (!w.minCabin || flightHasCabin(f.availability, w.minCabin))
        );
        if (filtered.length) {
          const html = `<p>Awards available ${w.from} → ${w.to} on ${result.date}</p>` +
            '<ul>' + filtered.map((f: FlightOption) =>
              `<li>${f.flightNumbers.join(' + ')} (${f.origin}→${f.destination}${f.stopCity ? ' via ' + f.stopCity : ''})
               - F:${f.availability.first} C:${f.availability.business} W:${f.availability.premium} Y:${f.availability.economy}</li>`
            ).join('') + '</ul>';
          await sendEmail(w.email, `CX award availability ${w.from}-${w.to} ${result.date}`, html);
        }
      }
    }
  }
}

cron.schedule(config.cron, () => {
  runJobOnce().catch((e) => console.error('job error', e));
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`CX Award Monitor listening on http://0.0.0.0:${config.port}`);
});