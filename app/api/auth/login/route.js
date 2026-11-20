import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { handler, HttpError, readJson } from '@/lib/api';
import { one } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { createSessionToken, roleHome, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import { phone, str } from '@/lib/validate';

export const POST = handler(async (request) => {
  const body = await readJson(request);
  const ph = phone(body.phone);
  const password = str(body.password, 'Password', { min: 6, max: 100 });

  const user = await one(
    `SELECT u.user_id, u.name, u.role, u.team_id, u.camp_id, u.password_hash, u.active,
            t.name AS team_name, c.name AS camp_name
       FROM users u
       LEFT JOIN teams t ON t.team_id = u.team_id
       LEFT JOIN camps c ON c.camp_id = u.camp_id
      WHERE u.phone = $1`,
    [ph]
  );
  // same message for "no such user" and "wrong password" so nobody can probe which numbers exist
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Wrong phone number or password.');
  }
  if (!user.active) throw new HttpError(403, 'This account has been deactivated by the control room.');

  const session = {
    uid: user.user_id,
    role: user.role,
    name: user.name,
    teamId: user.team_id,
    campId: user.camp_id,
    unit: user.team_name || user.camp_name || null,
  };
  const token = await createSessionToken(session);
  logActivity({ userId: user.user_id, role: user.role, action: 'auth.login' });

  const res = NextResponse.json({ ok: true, role: user.role, home: roleHome(session) });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
});
