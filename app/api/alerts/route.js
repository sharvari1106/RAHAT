import { CONTROL_ROLES, handler, requireUser, resolveIncident } from '@/lib/api';
import { many, one } from '@/lib/db';

// GET /api/alerts?incident=1 - open alerts, most severe first
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const inc = await resolveIncident(request, one);
  return {
    alerts: await many(
      `SELECT alert_id, kind, severity, message, link, created_at FROM alerts
        WHERE incident_id = $1 AND resolved_at IS NULL
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC`,
      [inc]
    ),
  };
});
