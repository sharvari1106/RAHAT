import { assertCampAccess, CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one, query } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, oneOf } from '@/lib/validate';

// POST /api/stays/:id/checkout { reason }
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'camp_manager']);
  const stayId = id((await params).id);
  const stay = await one('SELECT camp_id FROM camp_stays WHERE stay_id = $1', [stayId]);
  if (!stay) throw new HttpError(404, 'Stay not found.');
  assertCampAccess(s, stay.camp_id);
  const reason = oneOf((await readJson(request)).reason, 'Reason', ['returned_home', 'moved_camp', 'hospital', 'with_family', 'deceased']);
  await query('CALL sp_check_out($1, $2)', [stayId, reason]);
  logActivity({ userId: s.uid, role: s.role, action: 'camp.checkout', entity: 'stay', entityId: stayId, meta: { reason } });
  return { ok: true };
});
