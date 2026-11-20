import { CONTROL_ROLES, handler, readJson, requireUser, resolveIncident } from '@/lib/api';
import { many, one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf, str } from '@/lib/validate';

// GET /api/camps?incident=1 - camps with occupancy and days of supply (view v_camp_status)
export const GET = handler(async (request) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'camp_manager']);
  if (s.role === 'camp_manager') {
    return { camps: await many('SELECT * FROM v_camp_status WHERE camp_id = $1', [s.campId]) };
  }
  const inc = await resolveIncident(request, one);
  return { incidentId: inc, camps: await many('SELECT * FROM v_camp_status WHERE incident_id = $1 ORDER BY status, name', [inc]) };
});

// POST /api/camps - open a new relief camp (its supply store is created by trigger trg_camp_depot)
export const POST = handler(async (request) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const b = await readJson(request);
  const camp = await one(
    `INSERT INTO camps (incident_id, name, kind, address, lat, lng, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      id(b.incidentId, 'Incident'),
      str(b.name, 'Name', { min: 3, max: 120 }),
      oneOf(b.kind, 'Kind', ['school', 'community_hall', 'temple', 'tent_city', 'stadium', 'other']),
      str(b.address, 'Address', { max: 200, optional: true }),
      num(b.lat, 'Latitude', { min: 6, max: 37.5 }),
      num(b.lng, 'Longitude', { min: 68, max: 97.5 }),
      num(b.capacity, 'Capacity', { min: 1, max: 20000, integer: true }),
    ]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'camp.create', entity: 'camp', entityId: camp.camp_id });
  return { camp };
});
