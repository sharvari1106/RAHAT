import { CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id } from '@/lib/validate';

// POST /api/sos/:id/dispatch { teamId }
// fn_dispatch_team locks the SOS and the team rows: if two coordinators send the same team at the
// same moment, the second one waits for the lock and then gets "TEAM_BUSY".
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const sosId = id((await params).id);
  const b = await readJson(request);
  const teamId = id(b.teamId, 'Team');
  const { dispatch_id: dispatchId } = await one('SELECT fn_dispatch_team($1, $2, $3) AS dispatch_id', [sosId, teamId, s.uid]);
  logActivity({ userId: s.uid, role: s.role, action: 'sos.dispatch', entity: 'sos', entityId: sosId, meta: { teamId, dispatchId } });
  return { dispatchId };
});
