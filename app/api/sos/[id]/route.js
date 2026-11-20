import { CONTROL_ROLES, handler, HttpError, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { id } from '@/lib/validate';

// GET /api/sos/:id - full detail: report, history, dispatches, team suggestions, possible duplicates
export const GET = handler(async (request, { params }) => {
  await requireUser(request, CONTROL_ROLES);
  const sosId = id((await params).id);
  const sos = await one(
    `SELECT s.sos_id, s.ticket, s.incident_id, s.status, s.reporter_name, s.reporter_phone, s.lat, s.lng, s.landmark,
            s.description, s.people_count, s.children, s.elderly, s.injured, s.needs, s.channel, s.created_at, s.updated_at,
            s.suspected_dup_of, sd.ticket AS suspected_dup_ticket, s.duplicate_of, od.ticket AS duplicate_of_ticket,
            fn_sos_priority(s.people_count, s.children, s.elderly, s.injured, s.needs, s.created_at) AS priority,
            v.queue_rank, (s.embedding IS NOT NULL) AS has_embedding
       FROM sos_requests s
       LEFT JOIN sos_requests sd ON sd.sos_id = s.suspected_dup_of
       LEFT JOIN sos_requests od ON od.sos_id = s.duplicate_of
       LEFT JOIN v_sos_queue v ON v.sos_id = s.sos_id
      WHERE s.sos_id = $1`,
    [sosId]
  );
  if (!sos) throw new HttpError(404, 'SOS not found.');

  const open = ['new', 'triaged'].includes(sos.status);
  const [history, dispatches, suggestions, duplicates] = await Promise.all([
    many(
      `SELECT h.from_status, h.to_status, h.changed_at, h.note, u.name AS by_name
         FROM sos_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
        WHERE h.sos_id = $1 ORDER BY h.history_id`,
      [sosId]
    ),
    many(
      `SELECT d.dispatch_id, d.status, d.distance_km, d.eta_minutes, d.assigned_at, d.on_scene_at, d.finished_at,
              d.people_rescued, d.notes, t.name AS team, t.kind, u.name AS assigned_by
         FROM dispatches d JOIN teams t USING (team_id) LEFT JOIN users u ON u.user_id = d.assigned_by
        WHERE d.sos_id = $1 ORDER BY d.dispatch_id`,
      [sosId]
    ),
    open ? many('SELECT * FROM fn_suggest_teams($1, 6)', [sosId]) : [],
    open
      ? many(
          `SELECT d.* FROM sos_requests s,
                  LATERAL fn_find_duplicate_sos(s.incident_id, s.lat, s.lng, s.reporter_phone, s.embedding, s.sos_id) d
            WHERE s.sos_id = $1 AND d.sos_id < s.sos_id`,
          [sosId]
        )
      : [],
  ]);
  return { sos, history, dispatches, suggestions, duplicates };
});
