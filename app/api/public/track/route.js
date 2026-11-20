import { handler, HttpError } from '@/lib/api';
import { many, one } from '@/lib/db';

// GET /api/public/track?ticket=SOS-000012&phone=3210
// Needs the ticket AND the last 4 digits of the phone used, so tickets cannot be enumerated.
export const GET = handler(async (request) => {
  const sp = new URL(request.url).searchParams;
  const ticket = (sp.get('ticket') || '').trim().toUpperCase();
  const last4 = (sp.get('phone') || '').trim();
  if (!/^(SOS|MP)-\d{6}$/.test(ticket) || !/^\d{4}$/.test(last4)) {
    throw new HttpError(400, 'Enter the ticket (e.g. SOS-000012) and the last 4 digits of your phone number.');
  }

  if (ticket.startsWith('MP-')) {
    const r = await one(
      `SELECT m.ticket, m.full_name, m.status, m.created_at, c.name AS camp_name
         FROM missing_reports m
         LEFT JOIN camp_stays cs ON cs.person_id = m.matched_person_id AND cs.checked_out_at IS NULL
         LEFT JOIN camps c ON c.camp_id = cs.camp_id
        WHERE m.ticket = $1 AND right(m.reporter_phone, 4) = $2`,
      [ticket, last4]
    );
    if (!r) throw new HttpError(404, 'No report found with that ticket and phone number.');
    return { kind: 'missing', ...r };
  }

  const s = await one(
    `SELECT s.ticket, s.status, s.created_at, s.updated_at, s.people_count, s.needs, s.duplicate_of,
            v.queue_rank, v.priority, t.name AS team, t.kind AS team_kind, d.status AS dispatch_status, d.eta_minutes, d.assigned_at
       FROM sos_requests s
       LEFT JOIN v_sos_queue v ON v.sos_id = s.sos_id
       LEFT JOIN dispatches d ON d.sos_id = s.sos_id AND d.status IN ('assigned', 'en_route', 'on_scene')
       LEFT JOIN teams t ON t.team_id = d.team_id
      WHERE s.ticket = $1 AND right(s.reporter_phone, 4) = $2`,
    [ticket, last4]
  );
  if (!s) throw new HttpError(404, 'No request found with that ticket and phone number.');
  const history = await many(
    `SELECT h.to_status, h.changed_at FROM sos_status_history h JOIN sos_requests s USING (sos_id)
      WHERE s.ticket = $1 ORDER BY h.history_id`,
    [ticket]
  );
  return { kind: 'sos', ...s, history };
});
