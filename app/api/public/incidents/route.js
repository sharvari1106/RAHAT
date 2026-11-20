import { handler } from '@/lib/api';
import { many } from '@/lib/db';

// GET /api/public/incidents - active incidents, so a citizen can say which emergency they are in
export const GET = handler(async () => {
  const incidents = await many(
    `SELECT incident_id, name, disaster_type, center_lat, center_lng, radius_km
       FROM incidents WHERE status IN ('active', 'monitoring') ORDER BY started_at DESC`
  );
  const camps = await many(
    `SELECT c.name, c.address, c.lat, c.lng, c.status, c.capacity - c.occupancy AS free_places, c.incident_id
       FROM camps c JOIN incidents i USING (incident_id)
      WHERE c.status <> 'closed' AND i.status IN ('active', 'monitoring')
      ORDER BY c.name`
  );
  return { incidents, camps };
});
