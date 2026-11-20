import bcrypt from 'bcryptjs';
import { handler, readJson, requireUser } from '@/lib/api';
import { many, one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, oneOf, phone, str } from '@/lib/validate';

// GET /api/users (admin) - users plus the teams and camps they can be attached to
export const GET = handler(async (request) => {
  await requireUser(request, ['admin']);
  const [users, teams, camps] = await Promise.all([
    many(
      `SELECT u.user_id, u.name, u.phone, u.role, u.active, u.created_at, t.name AS team, c.name AS camp
         FROM users u LEFT JOIN teams t USING (team_id) LEFT JOIN camps c ON c.camp_id = u.camp_id
        ORDER BY u.role, u.name`
    ),
    many('SELECT team_id, name FROM teams ORDER BY name'),
    many("SELECT camp_id, name FROM camps WHERE status <> 'closed' ORDER BY name"),
  ]);
  return { users, teams, camps };
});

// POST /api/users (admin) { name, phone, password, role, teamId?, campId? }
// CHECK chk_user_assignment makes sure responders have a team and camp managers a camp.
export const POST = handler(async (request) => {
  const s = await requireUser(request, ['admin']);
  const b = await readJson(request);
  const role = oneOf(b.role, 'Role', ['admin', 'coordinator', 'responder', 'camp_manager']);
  const hash = await bcrypt.hash(str(b.password, 'Password', { min: 8, max: 100 }), 10);
  const user = await one(
    `INSERT INTO users (name, phone, password_hash, role, team_id, camp_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id, name, phone, role`,
    [
      str(b.name, 'Name', { min: 2, max: 80 }),
      phone(b.phone),
      hash,
      role,
      role === 'responder' ? id(b.teamId, 'Team') : null,
      role === 'camp_manager' ? id(b.campId, 'Camp') : null,
    ]
  );
  logActivity({ userId: s.uid, role: s.role, action: 'user.create', entity: 'user', entityId: user.user_id });
  return { user };
});
