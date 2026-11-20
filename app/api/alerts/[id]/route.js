import { CONTROL_ROLES, handler, requireUser } from '@/lib/api';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id } from '@/lib/validate';

// POST /api/alerts/:id - acknowledge (resolve) an alert by hand.
// If the problem still exists, the next trigger or refresh raises it again.
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const alertId = id((await params).id);
  await query('UPDATE alerts SET resolved_at = now() WHERE alert_id = $1 AND resolved_at IS NULL', [alertId]);
  logActivity({ userId: s.uid, role: s.role, action: 'alert.ack', entity: 'alert', entityId: alertId });
  return { ok: true };
});
