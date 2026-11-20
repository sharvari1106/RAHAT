import { handler, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf } from '@/lib/validate';

// PATCH /api/incidents/:id (admin) { status?, severity? }
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, ['admin']);
  const incidentId = id((await params).id);
  const b = await readJson(request);
  const status = b.status ? oneOf(b.status, 'Status', ['monitoring', 'active', 'recovery', 'closed']) : null;
  const severity = b.severity != null ? num(b.severity, 'Severity', { min: 1, max: 5, integer: true }) : null;
  const row = await one(
    `UPDATE incidents
        SET status = COALESCE($2::incident_status, status),
            severity = COALESCE($3, severity),
            ended_at = CASE WHEN $2 = 'closed' THEN now() WHEN $2 IS NOT NULL THEN NULL ELSE ended_at END
      WHERE incident_id = $1 RETURNING *`,
    [incidentId, status, severity]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'incident.update', entity: 'incident', entityId: incidentId, meta: b });
  return { incident: row };
});
