import { CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id } from '@/lib/validate';

// POST /api/sos/:id/merge { originalId } - confirm this request is a duplicate of another one
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const sosId = id((await params).id);
  const originalId = id((await readJson(request)).originalId, 'Original SOS');
  await query('CALL sp_merge_duplicate($1, $2, $3)', [sosId, originalId, s.uid]);
  logActivity({ userId: s.uid, role: s.role, action: 'sos.merge', entity: 'sos', entityId: sosId, meta: { originalId } });
  return { ok: true };
});
