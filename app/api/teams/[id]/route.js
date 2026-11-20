import { CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, oneOf } from '@/lib/validate';

// PATCH /api/teams/:id { status: available | off_duty } - shift change. A team on a job cannot go off duty.
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const teamId = id((await params).id);
  const status = oneOf((await readJson(request)).status, 'Status', ['available', 'off_duty']);
  const row = await one(
    `UPDATE teams SET status = $2, last_seen_at = now()
      WHERE team_id = $1 AND status IN ('available', 'off_duty') RETURNING team_id, status`,
    [teamId, status]
  );
  if (!row) throw new HttpError(409, 'This team is on a job. Finish or abort the job first.');
  logActivity({ userId: s.uid, role: s.role, action: 'team.status', entity: 'team', entityId: teamId, meta: { status } });
  return { team: row };
});
