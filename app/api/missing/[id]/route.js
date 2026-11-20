import { CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { many, one, query } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, oneOf } from '@/lib/validate';

// GET /api/missing/:id - the report and ranked candidates (trigram + vector, re-scored in SQL)
export const GET = handler(async (request, { params }) => {
  await requireUser(request, CONTROL_ROLES);
  const reportId = id((await params).id);
  const report = await one(
    `SELECT m.report_id, m.ticket, m.status, m.full_name, m.age, m.gender, m.home_village, m.last_seen_place, m.last_seen_at,
            m.description, m.reporter_name, m.reporter_phone, m.created_at, m.matched_at, (m.embedding IS NOT NULL) AS has_embedding,
            p.full_name AS matched_name, c.name AS matched_camp, u.name AS matched_by_name
       FROM missing_reports m
       LEFT JOIN people p ON p.person_id = m.matched_person_id
       LEFT JOIN camp_stays cs ON cs.person_id = p.person_id AND cs.checked_out_at IS NULL
       LEFT JOIN camps c ON c.camp_id = cs.camp_id
       LEFT JOIN users u ON u.user_id = m.matched_by
      WHERE m.report_id = $1`,
    [reportId]
  );
  if (!report) throw new HttpError(404, 'Report not found.');
  const candidates = await many(
    `SELECT f.*, p.marks, p.phone, p.registered_at FROM fn_match_missing($1, 8) f JOIN people p USING (person_id) ORDER BY f.score DESC`,
    [reportId]
  );
  return { report, candidates };
});

// POST /api/missing/:id { action: confirm (personId) | reunited | close }
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const reportId = id((await params).id);
  const b = await readJson(request);
  const action = oneOf(b.action, 'Action', ['confirm', 'reunited', 'close']);
  if (action === 'confirm') {
    await query('CALL sp_confirm_match($1, $2, $3)', [reportId, id(b.personId, 'Person'), s.uid]);
  } else {
    const r = await query(
      `UPDATE missing_reports SET status = $2::missing_status
        WHERE report_id = $1 AND status = CASE WHEN $2 = 'reunited' THEN 'matched'::missing_status ELSE status END
          AND status NOT IN ('reunited', 'closed')`,
      [reportId, action === 'reunited' ? 'reunited' : 'closed']
    );
    if (!r.rowCount) throw new HttpError(409, action === 'reunited' ? 'Confirm a match first.' : 'This report is already closed.');
  }
  logActivity({ userId: s.uid, role: s.role, action: `missing.${action}`, entity: 'missing_report', entityId: reportId });
  return { ok: true };
});
