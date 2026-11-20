import { CONTROL_ROLES, handler, requireUser } from '@/lib/api';
import { many } from '@/lib/db';

// GET /api/supplies - depots, resources, stock matrix and recent transfers
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const [depots, resources, stock, transfers] = await Promise.all([
    many(
      `SELECT d.depot_id, d.name, d.kind, d.camp_id, c.occupancy, c.status AS camp_status
         FROM depots d LEFT JOIN camps c USING (camp_id)
        WHERE c.status IS DISTINCT FROM 'closed'
        ORDER BY d.kind DESC, d.name`
    ),
    many('SELECT resource_id, name, unit, category, per_person_per_day, critical FROM resources ORDER BY category, name'),
    many('SELECT depot_id, resource_id, quantity, days_of_supply FROM v_depot_stock'),
    many(
      `SELECT t.transfer_id, t.code, t.status, t.vehicle, t.created_at, t.closed_at, f.name AS from_depot, d.name AS to_depot,
              u.name AS created_by,
              json_agg(json_build_object('resource', r.name, 'unit', r.unit, 'quantity', ti.quantity) ORDER BY r.name) AS items
         FROM transfers t
         JOIN depots f ON f.depot_id = t.from_depot
         JOIN depots d ON d.depot_id = t.to_depot
         JOIN transfer_items ti USING (transfer_id)
         JOIN resources r USING (resource_id)
         LEFT JOIN users u ON u.user_id = t.created_by
        GROUP BY t.transfer_id, f.name, d.name, u.name
        ORDER BY (t.status = 'in_transit') DESC, t.created_at DESC
        LIMIT 30`
    ),
  ]);
  return { depots, resources, stock, transfers };
});
