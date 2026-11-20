import { assertCampAccess, CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf, str } from '@/lib/validate';

// POST /api/camps/:id/distribute { resourceId, quantity, peopleServed, reason: distributed|damaged, note }
// Writes one ledger row; trigger trg_movement_stock refuses it if the camp store does not have enough.
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'camp_manager']);
  const campId = id((await params).id);
  assertCampAccess(s, campId);
  const b = await readJson(request);
  const reason = oneOf(b.reason || 'distributed', 'Reason', ['distributed', 'damaged']);
  const qty = num(b.quantity, 'Quantity', { min: 0.01, max: 1_000_000 });
  const served = reason === 'distributed' ? num(b.peopleServed, 'People served', { min: 1, max: 100000, integer: true }) : null;
  const row = await one(
    `INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, people_served, note, created_by)
     SELECT depot_id, $2, -$3::NUMERIC, $4::movement_reason, $5, $6, $7 FROM depots WHERE camp_id = $1
     RETURNING movement_id`,
    [campId, id(b.resourceId, 'Resource'), qty, reason, served, str(b.note, 'Note', { max: 200, optional: true }), s.uid]
  );
  logActivity({ userId: s.uid, role: s.role, action: `stock.${reason}`, entity: 'camp', entityId: campId, meta: { qty } });
  return row;
});
