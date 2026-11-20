import { handler, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';

// GET /api/my-task - the responder's team, its live job (with caller details) and recent jobs
export const GET = handler(async (request) => {
  const s = await requireUser(request, ['responder']);
  const [team, job, recent] = await Promise.all([
    one('SELECT team_id, name, kind, members, capacity, status, cur_lat, cur_lng FROM teams WHERE team_id = $1', [s.teamId]),
    one(
      `SELECT d.dispatch_id, d.status, d.assigned_at, d.eta_minutes, d.distance_km, d.notes,
              s.sos_id, s.ticket, s.reporter_name, s.reporter_phone, s.lat, s.lng, s.landmark, s.description,
              s.people_count, s.children, s.elderly, s.injured, s.needs, s.created_at
         FROM dispatches d JOIN sos_requests s USING (sos_id)
        WHERE d.team_id = $1 AND d.status IN ('assigned', 'en_route', 'on_scene')`,
      [s.teamId]
    ),
    many(
      `SELECT d.dispatch_id, d.status, d.finished_at, d.people_rescued, s.ticket, s.landmark
         FROM dispatches d JOIN sos_requests s USING (sos_id)
        WHERE d.team_id = $1 AND d.status IN ('completed', 'aborted')
        ORDER BY d.finished_at DESC LIMIT 10`,
      [s.teamId]
    ),
  ]);
  return { team, job, recent };
});
