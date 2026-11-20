import { CONTROL_ROLES, handler, requireUser, resolveIncident } from '@/lib/api';
import { many, one } from '@/lib/db';

// GET /api/missing?incident=1&status=open - reports with their best candidate (LATERAL call per report)
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const inc = await resolveIncident(request, one);
  const status = new URL(request.url).searchParams.get('status') || 'open';
  const rows = await many(
    `SELECT m.report_id, m.ticket, m.full_name, m.age, m.gender, m.home_village, m.last_seen_place, m.last_seen_at,
            m.description, m.status, m.reporter_name, m.reporter_phone, m.created_at,
            b.full_name AS best_name, b.camp_name AS best_camp, b.score AS best_score,
            p.full_name AS matched_name, c.name AS matched_camp
       FROM missing_reports m
       LEFT JOIN LATERAL fn_match_missing(m.report_id, 1) b ON m.status = 'open'
       LEFT JOIN people p ON p.person_id = m.matched_person_id
       LEFT JOIN camp_stays cs ON cs.person_id = p.person_id AND cs.checked_out_at IS NULL
       LEFT JOIN camps c ON c.camp_id = cs.camp_id
      WHERE m.incident_id = $1 AND ($2 = 'all' OR m.status::TEXT = $2)
      ORDER BY b.score DESC NULLS LAST, m.created_at DESC`,
    [inc, status]
  );
  return { incidentId: inc, rows };
});
