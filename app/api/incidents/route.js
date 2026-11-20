import { CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { num, oneOf, str } from '@/lib/validate';

// GET /api/incidents - every incident with live counts (view v_incident_summary)
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  return { incidents: await many('SELECT * FROM v_incident_summary ORDER BY (status = \'closed\'), started_at DESC') };
});

// POST /api/incidents (admin) - declare a new incident
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['admin']);
  const b = await readJson(request);
  const row = await one(
    `INSERT INTO incidents (code, name, disaster_type, severity, center_lat, center_lng, radius_km, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active') RETURNING *`,
    [
      str(b.code, 'Code', { min: 12, max: 12 }).toUpperCase(),
      str(b.name, 'Name', { min: 3, max: 120 }),
      oneOf(b.disasterType, 'Disaster type', ['flood', 'cyclone', 'earthquake', 'landslide', 'fire', 'drought', 'other']),
      num(b.severity, 'Severity', { min: 1, max: 5, integer: true }),
      num(b.lat, 'Latitude', { min: 6, max: 37.5 }),
      num(b.lng, 'Longitude', { min: 68, max: 97.5 }),
      num(b.radiusKm, 'Radius (km)', { min: 1, max: 500 }),
    ]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'incident.create', entity: 'incident', entityId: row.incident_id });
  return { incident: row };
});
