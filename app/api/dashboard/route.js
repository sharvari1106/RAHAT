import { CONTROL_ROLES, handler, requireUser, resolveIncident } from '@/lib/api';
import { many, one } from '@/lib/db';

// GET /api/dashboard?incident=1 - everything the situation room shows, in parallel queries
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const inc = await resolveIncident(request, one);
  const [summary, sos, teams, camps, alerts, sitrep, needs] = await Promise.all([
    one('SELECT * FROM v_incident_summary WHERE incident_id = $1', [inc]),
    many(
      `SELECT sos_id, ticket, status, priority, queue_rank, lat, lng, people_count, needs, waiting_min, landmark, assigned_team
         FROM v_sos_queue WHERE incident_id = $1 ORDER BY queue_rank`,
      [inc]
    ),
    many('SELECT team_id, name, kind, status, cur_lat, cur_lng, ticket, minutes_on_job FROM v_team_board ORDER BY name'),
    many(
      `SELECT camp_id, name, lat, lng, capacity, occupancy, occupancy_pct, status, days_of_supply, shortest_resource
         FROM v_camp_status WHERE incident_id = $1 ORDER BY name`,
      [inc]
    ),
    many(
      `SELECT alert_id, kind, severity, message, link, created_at FROM alerts
        WHERE incident_id = $1 AND resolved_at IS NULL
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC`,
      [inc]
    ),
    many('SELECT * FROM mv_daily_sitrep WHERE incident_id = $1 ORDER BY day', [inc]),
    many(
      `SELECT need, COUNT(*) FILTER (WHERE status IN ('new', 'triaged')) AS waiting,
              COUNT(*) FILTER (WHERE status IN ('assigned', 'in_progress')) AS active
         FROM sos_requests, unnest(needs) AS need
        WHERE incident_id = $1 GROUP BY need ORDER BY need`,
      [inc]
    ),
  ]);
  return { incidentId: inc, summary, sos, teams, camps, alerts, sitrep, needs };
});
