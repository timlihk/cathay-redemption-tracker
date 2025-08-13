import express from 'express';
import { z } from 'zod';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { addWatch, deleteWatch, listWatches, getCached, upsertCache, upsertUser, getUserById, listWatchesWithCreds } from './db.js';
import { CathayClient, toCathayYmd } from './cathay.js';
import { sendEmail } from './mailer.js';
import { FlightOption } from './types.js';
import { encryptString, decryptString } from './crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Per-user clients are instantiated inside the scheduler loop

const watchSchema = z.object({
  userId: z.number().int().optional(),
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

const userSchema = z.object({
  email: z.string().email(),
  cathayMember: z.string().min(3),
  cathayPassword: z.string().min(3),
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.post('/api/user', (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, cathayMember, cathayPassword } = parsed.data;
  const enc = encryptString(cathayPassword);
  const userId = upsertUser(email, cathayMember, enc);
  res.json({ userId });
});

app.get('/api/user/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ id: user.id, email: user.email, cathayMember: user.cathay_member ? 'set' : null, cathayPassword: user.cathay_pass_enc ? 'set' : null });
});

app.get('/api/watch', (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  res.json(listWatches(userId));
});

app.post('/api/open-login', async (req, res) => {
  try {
    const userId = Number(req.body?.userId || req.query?.userId);
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const profileDir = `./pw-data/user-${userId}`;
    const client = new CathayClient(profileDir);
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
  const userId = body.userId || upsertUser(body.email);
  const id = addWatch(userId, {
    from: body.from,
    to: body.to,
    startDate: body.startDate,
    endDate: body.endDate,
    numAdults: body.numAdults,
    numChildren: body.numChildren,
    email: body.email,
    nonstopOnly: body.nonstopOnly ? 1 : 0,
    minCabin: body.minCabin,
  } as any);
  res.json({ id, userId });
});

app.delete('/api/watch/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  deleteWatch(id);
  res.json({ ok: true });
});

app.get('/api/search', async (req, res) => {
  try {
    const userId = Number(req.query.userId || 0);
    if (!userId) return res.status(400).json({ error: 'userId required' });
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

    const client = new CathayClient(`./pw-data/user-${userId}`);
    await client.warmup();
    const result = await client.searchSingleDaySmart({ from, to, dateYmd: ymd, adults, children });
    upsertCache(ymd, from, to, JSON.stringify(result));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'search failed' });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ message: 'status is per-user; use scheduler logs and UI actions for now' });
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
  const items = listWatchesWithCreds();
  if (items.length === 0) return;

  // Group watches by userId and create a per-user client with a unique profile dir
  const userIdToClient = new Map<number, CathayClient>();

  for (const w of items) {
    if (!userIdToClient.has((w as any).userId)) {
      const profileDir = `./pw-data/user-${(w as any).userId}`;
      userIdToClient.set((w as any).userId, new CathayClient(profileDir));
    }
    const client = userIdToClient.get((w as any).userId)!;

    await client.warmup();

    const start = new Date(w.startDate + 'T00:00:00');
    const end = new Date(w.endDate + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ymd = toCathayYmd(d.toISOString().slice(0,10));
      const cached = getCached(ymd, w.from, w.to, 55 * 60 * 1000);
      let result;
      if (cached) {
        result = JSON.parse(cached);
      } else {
        result = await client.searchSingleDaySmart({ from: w.from, to: w.to, dateYmd: ymd, adults: w.numAdults, children: w.numChildren });
        if ((!result.flights?.length && client.needsLogin) || client.lastError) {
          if ((w as any).cathayMember && (w as any).cathayPassEnc) {
            try {
              const pass = decryptString((w as any).cathayPassEnc);
              const ok = await client.reloginWithCredentials((w as any).cathayMember, pass);
              if (ok) {
                result = await client.searchSingleDaySmart({ from: w.from, to: w.to, dateYmd: ymd, adults: w.numAdults, children: w.numChildren });
              }
            } catch {}
          }
        }
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