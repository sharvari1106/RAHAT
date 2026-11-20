// JWT session helpers. Uses only `jose`, so it is safe to import from middleware (Edge runtime).
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'rahat_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // one duty shift

function secretKey() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long.');
  }
  return new TextEncoder().encode(s);
}

/** payload: { uid, role, name, teamId, campId } */
export async function createSessionToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true, // JavaScript in the browser cannot read it (XSS protection)
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};

/** Home page for each role */
export function roleHome(session) {
  switch (session?.role) {
    case 'admin':
    case 'coordinator':
      return '/dashboard';
    case 'responder':
      return '/my-task';
    case 'camp_manager':
      return `/camps/${session.campId}`;
    default:
      return '/login';
  }
}

const CONTROL = ['admin', 'coordinator'];

/** Which roles may open which pages (checked in middleware). Pages not listed are public. */
export const PAGE_ROLES = [
  { prefix: '/admin', roles: ['admin'] },
  { prefix: '/dashboard', roles: CONTROL },
  { prefix: '/sos', roles: CONTROL },
  { prefix: '/teams', roles: CONTROL },
  { prefix: '/supplies', roles: CONTROL },
  { prefix: '/missing', roles: CONTROL },
  { prefix: '/reports', roles: CONTROL },
  { prefix: '/camps', roles: [...CONTROL, 'camp_manager'] }, // camp managers: own camp only (checked in the API)
  { prefix: '/my-task', roles: ['responder'] },
];

/** Pages anyone can open without logging in */
export const PUBLIC_PAGES = ['/login', '/help', '/track'];
