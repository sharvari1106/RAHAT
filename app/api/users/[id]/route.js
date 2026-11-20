import { handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id } from '@/lib/validate';

// PATCH /api/users/:id (admin) { active } - deactivate / reactivate an account
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, ['admin']);
  const userId = id((await params).id);
  if (userId === Number(s.uid)) throw new HttpError(400, 'You cannot deactivate your own account.');
  const b = await readJson(request);
  const user = await one('UPDATE users SET active = $2 WHERE user_id = $1 RETURNING user_id, active', [userId, !!b.active]);
  if (!user) throw new HttpError(404, 'User not found.');
  logActivity({ userId: s.uid, role: s.role, action: 'user.active', entity: 'user', entityId: userId, meta: { active: !!b.active } });
  return { user };
});
