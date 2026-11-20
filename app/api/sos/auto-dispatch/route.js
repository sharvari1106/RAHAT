import { CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { many } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num } from '@/lib/validate';

// POST /api/sos/auto-dispatch { incidentId, max }
// fn_auto_dispatch walks the queue by priority with FOR UPDATE SKIP LOCKED, so two coordinators
// pressing the button together split the work instead of blocking or double-assigning.
export const POST = handler(async (request) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const b = await readJson(request);
  const rows = await many('SELECT * FROM fn_auto_dispatch($1, $2, $3)', [
    id(b.incidentId, 'Incident'),
    s.uid,
    num(b.max ?? 5, 'Max', { min: 1, max: 50, integer: true }),
  ]);
  logActivity({ userId: s.uid, role: s.role, action: 'sos.auto_dispatch', meta: { assigned: rows.length } });
  return { assigned: rows };
});
