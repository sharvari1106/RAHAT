import { CONTROL_ROLES, handler, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { num, oneOf, str } from '@/lib/validate';

// GET /api/teams - team board (view v_team_board)
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  return { teams: await many('SELECT * FROM v_team_board ORDER BY kind, name') };
});

// POST /api/teams (admin) - register a team
export const POST = handler(async (request) => {
  await requireUser(request, ['admin']);
  const b = await readJson(request);
  const lat = num(b.lat, 'Base latitude', { min: 6, max: 37.5 });
  const lng = num(b.lng, 'Base longitude', { min: 68, max: 97.5 });
  const team = await one(
    `INSERT INTO teams (name, kind, members, capacity, base_lat, base_lng, cur_lat, cur_lng)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6) RETURNING *`,
    [
      str(b.name, 'Name', { min: 3, max: 80 }),
      oneOf(b.kind, 'Kind', ['boat', 'search_rescue', 'medical', 'supply']),
      num(b.members, 'Members', { min: 1, max: 50, integer: true }),
      num(b.capacity, 'Capacity', { min: 1, max: 100, integer: true }),
      lat,
      lng,
    ]
  );
  return { team };
});
