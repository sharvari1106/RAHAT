import { CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one, query } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, oneOf } from '@/lib/validate';

// PATCH /api/transfers/:id { action: receive | cancel }
// The camp manager at the destination confirms arrival; only the control room can cancel.
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'camp_manager']);
  const transferId = id((await params).id);
  const action = oneOf((await readJson(request)).action, 'Action', ['receive', 'cancel']);
  const t = await one(
    'SELECT t.transfer_id, d.camp_id FROM transfers t JOIN depots d ON d.depot_id = t.to_depot WHERE t.transfer_id = $1',
    [transferId]
  );
  if (!t) throw new HttpError(404, 'Transfer not found.');
  if (s.role === 'camp_manager' && (action !== 'receive' || Number(s.campId) !== t.camp_id)) {
    throw new HttpError(403, 'You can only receive trucks sent to your own camp.');
  }
  await query('SELECT fn_close_transfer($1, $2, $3)', [transferId, s.uid, action === 'receive']);
  logActivity({ userId: s.uid, role: s.role, action: `transfer.${action}`, entity: 'transfer', entityId: transferId });
  return { ok: true };
});
