import { handler, HttpError, readJson } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { createSos, parseSos } from '@/lib/sos';

// very small in-memory rate limit for the public form (per phone number)
const recent = globalThis.__rahatSosRate || (globalThis.__rahatSosRate = new Map());

// POST /api/public/sos - a citizen reports an emergency (no login)
export const POST = handler(async (request) => {
  const s = parseSos(await readJson(request));
  const last = recent.get(s.phone) || [];
  const now = Date.now();
  const lastTen = last.filter((t) => now - t < 10 * 60_000);
  if (lastTen.length >= 5) throw new HttpError(429, 'Too many requests from this number. Please call the helpline 1070.');
  recent.set(s.phone, [...lastTen, now]);

  const r = await createSos(s, { channel: 'web' });
  const queue = await one(
    `SELECT queue_rank, priority FROM v_sos_queue WHERE sos_id = $1`,
    [r.sos_id]
  );
  logActivity({ action: 'sos.public_create', entity: 'sos', entityId: r.sos_id, meta: { duplicate: !!r.suspected_dup_of } });
  return {
    ticket: r.ticket,
    // a citizen only learns that a similar request exists, never whose it is
    similarExists: !!r.suspected_dup_of,
    queuePosition: queue?.queue_rank ?? null,
  };
});
