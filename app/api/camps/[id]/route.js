import { assertCampAccess, CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf } from '@/lib/validate';

// GET /api/camps/:id?q=name - camp status, residents (fuzzy name search), stock, incoming trucks
export const GET = handler(async (request, { params }) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'camp_manager']);
  const campId = id((await params).id);
  assertCampAccess(s, campId);
  const q = (new URL(request.url).searchParams.get('q') || '').trim();

  const camp = await one('SELECT * FROM v_camp_status WHERE camp_id = $1', [campId]);
  if (!camp) throw new HttpError(404, 'Camp not found.');

  const [residents, stock, incoming, movements, resources] = await Promise.all([
    q
      ? many(
          // trigram KNN (GiST index): "Rames" finds Ramesh, Ramesha, Rameshwar
          `SELECT p.person_id, p.full_name, p.age, p.gender, p.phone, p.home_village, p.needs_medical, cs.stay_id, cs.checked_in_at,
                  ROUND(similarity(p.full_name, $2)::NUMERIC, 2) AS sim
             FROM camp_stays cs JOIN people p USING (person_id)
            WHERE cs.camp_id = $1 AND cs.checked_out_at IS NULL
            ORDER BY p.full_name <-> $2 LIMIT 30`,
          [campId, q]
        )
      : many(
          `SELECT p.person_id, p.full_name, p.age, p.gender, p.phone, p.home_village, p.needs_medical, cs.stay_id, cs.checked_in_at
             FROM camp_stays cs JOIN people p USING (person_id)
            WHERE cs.camp_id = $1 AND cs.checked_out_at IS NULL
            ORDER BY cs.checked_in_at DESC LIMIT 50`,
          [campId]
        ),
    many(
      `SELECT resource_id, resource, unit, category, critical, quantity, days_of_supply
         FROM v_depot_stock WHERE camp_id = $1 ORDER BY critical DESC, category, resource`,
      [campId]
    ),
    many(
      `SELECT t.transfer_id, t.code, t.created_at, t.vehicle, f.name AS from_depot,
              json_agg(json_build_object('resource', r.name, 'unit', r.unit, 'quantity', ti.quantity) ORDER BY r.name) AS items
         FROM transfers t
         JOIN depots d ON d.depot_id = t.to_depot
         JOIN depots f ON f.depot_id = t.from_depot
         JOIN transfer_items ti USING (transfer_id)
         JOIN resources r USING (resource_id)
        WHERE d.camp_id = $1 AND t.status = 'in_transit'
        GROUP BY t.transfer_id, f.name ORDER BY t.created_at`,
      [campId]
    ),
    many(
      `SELECT m.created_at, m.reason, m.qty_change, m.people_served, m.note, r.name AS resource, r.unit, u.name AS by_name
         FROM stock_movements m JOIN depots d USING (depot_id) JOIN resources r USING (resource_id)
         LEFT JOIN users u ON u.user_id = m.created_by
        WHERE d.camp_id = $1 ORDER BY m.movement_id DESC LIMIT 25`,
      [campId]
    ),
    many('SELECT resource_id, name, unit FROM resources ORDER BY name'),
  ]);
  return { camp, residents, stock, incoming, movements, resources };
});

// PATCH /api/camps/:id { capacity?, status?: open|closed } (control room)
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const campId = id((await params).id);
  const b = await readJson(request);
  const capacity = b.capacity != null ? num(b.capacity, 'Capacity', { min: 1, max: 20000, integer: true }) : null;
  const status = b.status ? oneOf(b.status, 'Status', ['open', 'closed']) : null;
  if (status === 'closed') {
    const c = await one('SELECT occupancy FROM camps WHERE camp_id = $1', [campId]);
    if (c?.occupancy > 0) throw new HttpError(409, `Move or check out all ${c.occupancy} residents before closing the camp.`);
  }
  // CHECK chk_camp_occupancy stops capacity going below the current occupancy
  const camp = await one(
    `UPDATE camps
        SET capacity = COALESCE($2, capacity),
            status = CASE WHEN $3 = 'closed' THEN 'closed'::camp_status
                          WHEN $3 = 'open' OR status <> 'closed' THEN
                               CASE WHEN occupancy >= COALESCE($2, capacity) THEN 'full'::camp_status ELSE 'open'::camp_status END
                          ELSE status END,
            closed_at = CASE WHEN $3 = 'closed' THEN now() WHEN $3 = 'open' THEN NULL ELSE closed_at END
      WHERE camp_id = $1 RETURNING *`,
    [campId, capacity, status]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'camp.update', entity: 'camp', entityId: campId, meta: b });
  return { camp };
});
