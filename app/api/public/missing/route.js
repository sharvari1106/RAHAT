import { handler, readJson } from '@/lib/api';
import { one } from '@/lib/db';
import { embedOne, personText, toPgVector } from '@/lib/embeddings';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf, phone, str } from '@/lib/validate';

// POST /api/public/missing - a family reports a missing person (no login)
export const POST = handler(async (request) => {
  const b = await readJson(request);
  const r = {
    incidentId: id(b.incidentId, 'Incident'),
    reporterName: str(b.reporterName, 'Your name', { min: 2, max: 80 }),
    reporterPhone: phone(b.reporterPhone, 'Your phone'),
    fullName: str(b.fullName, 'Missing person name', { min: 2, max: 100 }),
    age: num(b.age, 'Age', { min: 0, max: 120, integer: true, optional: true }),
    gender: oneOf(b.gender || 'unknown', 'Gender', ['male', 'female', 'other', 'unknown']),
    village: str(b.village, 'Village', { max: 80, optional: true }),
    lastSeenPlace: str(b.lastSeenPlace, 'Last seen place', { max: 160, optional: true }),
    lastSeenAt: b.lastSeenAt ? new Date(b.lastSeenAt) : null,
    description: str(b.description, 'Description', { min: 5, max: 500 }),
  };
  if (r.lastSeenAt && Number.isNaN(r.lastSeenAt.getTime())) r.lastSeenAt = null;

  const vec = await embedOne(
    personText({ full_name: r.fullName, age: r.age, gender: r.gender, home_village: r.village, description: r.description, last_seen_place: r.lastSeenPlace })
  );
  const row = await one(
    `INSERT INTO missing_reports (incident_id, reporter_name, reporter_phone, full_name, age, gender, home_village,
                                  last_seen_place, last_seen_at, description, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
     RETURNING report_id, ticket`,
    [r.incidentId, r.reporterName, r.reporterPhone, r.fullName, r.age, r.gender, r.village, r.lastSeenPlace, r.lastSeenAt,
     r.description, toPgVector(vec)]
  );
  // check right away whether someone matching is already registered in a camp
  const best = await one(`SELECT full_name, score FROM fn_match_missing($1, 1)`, [row.report_id]);
  logActivity({ action: 'missing.public_create', entity: 'missing_report', entityId: row.report_id });
  return { ticket: row.ticket, possibleMatch: !!best && Number(best.score) >= 0.6 };
});
