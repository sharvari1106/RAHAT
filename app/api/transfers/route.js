import { CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, str } from '@/lib/validate';

// POST /api/transfers { fromDepot, toDepot, vehicle, items: [{ resourceId, quantity }] }
// fn_create_transfer: one transaction, stock rows locked in resource order, stock leaves the source now.
export const POST = handler(async (request) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const b = await readJson(request);
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'Add at least one item.');
  const items = b.items.map((it) => ({
    resource_id: id(it.resourceId, 'Resource'),
    quantity: num(it.quantity, 'Quantity', { min: 0.01, max: 10_000_000 }),
  }));
  const row = await one('SELECT fn_create_transfer($1, $2, $3::jsonb, $4, $5) AS transfer_id', [
    id(b.fromDepot, 'From depot'),
    id(b.toDepot, 'To depot'),
    JSON.stringify(items),
    s.uid,
    str(b.vehicle, 'Vehicle', { max: 40, optional: true }),
  ]);
  logActivity({ userId: s.uid, role: s.role, action: 'transfer.create', entity: 'transfer', entityId: row.transfer_id });
  return row;
});
