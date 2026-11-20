import { CONTROL_ROLES, handler, HttpError, readJson, requireUser, resolveIncident } from '@/lib/api';
import { one } from '@/lib/db';
import { FIELD_REPORT_TYPES, getMongo, logActivity } from '@/lib/mongo';
import { num, oneOf, str } from '@/lib/validate';

// Field situation reports live in MongoDB: every type carries different fields
// (water level readings, blocked roads, damage counts...), which suits a document store.

// GET /api/field-reports?incident=1&near=lat,lng - latest reports (or those within 5 km of a point)
export const GET = handler(async (request) => {
  await requireUser(request, [...CONTROL_ROLES, 'responder']);
  const db = await getMongo();
  if (!db) return { available: false, reports: [], types: FIELD_REPORT_TYPES };
  const inc = await resolveIncident(request, one);
  const near = new URL(request.url).searchParams.get('near');
  const filter = { incidentId: inc };
  if (near && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(near)) {
    const [lat, lng] = near.split(',').map(Number);
    // $near uses the 2dsphere index; results come back nearest first
    filter.location = { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: 5000 } };
  }
  const cursor = db.collection('field_reports').find(filter);
  const reports = await (near ? cursor.limit(30) : cursor.sort({ reportedAt: -1 }).limit(30)).toArray();
  return {
    available: true,
    types: FIELD_REPORT_TYPES,
    reports: reports.map(({ _id, ...r }) => ({ id: String(_id), ...r })),
  };
});

// POST /api/field-reports { type, lat, lng, note, details: {...} }
export const POST = handler(async (request) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'responder']);
  const db = await getMongo();
  if (!db) throw new HttpError(503, 'MongoDB is not configured (MONGODB_URI), so field reports are switched off.');
  const inc = await resolveIncident(request, one);
  const b = await readJson(request);
  const type = oneOf(b.type, 'Type', Object.keys(FIELD_REPORT_TYPES));
  // keep only the fields this type defines, with the declared types
  const details = {};
  for (const [key, kind] of Object.entries(FIELD_REPORT_TYPES[type].fields)) {
    const v = b.details?.[key];
    if (v === undefined || v === null || v === '') continue;
    if (kind === 'number') details[key] = num(v, key, { min: 0, max: 100000 });
    else if (kind === 'boolean') details[key] = v === true || v === 'true';
    else details[key] = str(v, key, { max: 120 });
  }
  const doc = {
    incidentId: inc,
    type,
    location: { type: 'Point', coordinates: [num(b.lng, 'Longitude', { min: 68, max: 97.5 }), num(b.lat, 'Latitude', { min: 6, max: 37.5 })] },
    note: str(b.note, 'Note', { max: 500, optional: true }),
    details,
    reportedBy: { userId: s.uid, name: s.name, role: s.role, unit: s.unit || null },
    reportedAt: new Date(),
  };
  const r = await db.collection('field_reports').insertOne(doc);
  logActivity({ userId: s.uid, role: s.role, action: 'field_report.create', entity: 'field_report', entityId: String(r.insertedId) });
  return { id: String(r.insertedId) };
});
