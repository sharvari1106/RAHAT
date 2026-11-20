import { CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, str } from '@/lib/validate';

// POST /api/supplies/donations { depotId, resourceId, quantity, note } - goods received at a depot
export const POST = handler(async (request) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const b = await readJson(request);
  const row = await one(
    `INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, note, created_by)
     VALUES ($1, $2, $3, 'donation_in', $4, $5) RETURNING movement_id`,
    [id(b.depotId, 'Depot'), id(b.resourceId, 'Resource'), num(b.quantity, 'Quantity', { min: 0.01, max: 10_000_000 }),
     str(b.note, 'Source / note', { max: 200, optional: true }), s.uid]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'stock.donation', meta: b });
  return row;
});
