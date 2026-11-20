// Shared helpers for API route handlers: auth guard + uniform error handling.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './session.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const CONTROL_ROLES = ['admin', 'coordinator'];

/** Reads the session cookie and checks the role. Returns the session payload. */
export async function requireUser(request, roles) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) throw new HttpError(401, 'Please log in again.');
  if (roles && !roles.includes(session.role)) {
    throw new HttpError(403, `This action is not allowed for the ${session.role.replace('_', ' ')} role.`);
  }
  return session;
}

/** Camp managers may only touch their own camp; control-room roles may touch any. */
export function assertCampAccess(session, campId) {
  if (session.role === 'camp_manager' && Number(session.campId) !== Number(campId)) {
    throw new HttpError(403, 'You can only manage your own camp.');
  }
}

// Human-friendly messages for named constraints (database-level validation)
const CONSTRAINT_MESSAGES = {
  chk_sos_groups: 'Children, elderly and injured cannot be more than the number of people.',
  chk_sos_duplicate: 'A duplicate must point to the original request.',
  chk_camp_occupancy: 'Camp occupancy cannot exceed its capacity.',
  chk_camp_closed: 'A closed camp needs a closing time.',
  chk_user_assignment: 'Responders need a team, camp managers need a camp, admins/coordinators need neither.',
  chk_transfer_depots: 'Choose two different depots.',
  chk_movement_sign: 'Quantity has the wrong sign for this kind of stock movement.',
  chk_stay_checkout: 'Choose a reason for the check-out.',
  chk_missing_match: 'A matched report must point to a person.',
  chk_missing_seen: '"Last seen" cannot be in the future.',
  chk_incident_dates: 'The end date must be after the start date.',
  chk_closed_has_end: 'A closed incident needs an end time.',
  chk_stock_nonnegative: 'Not enough stock.',
  uq_one_open_stay: 'This person is already checked into a camp. Check them out first.',
  uq_dispatch_active_team: 'This team is already on a job.',
  uq_dispatch_active_sos: 'This SOS already has a team on the way.',
  uq_camp_name_per_incident: 'A camp with this name already exists for this incident.',
  users_phone_key: 'This phone number is already registered.',
  teams_name_key: 'A team with this name already exists.',
  incidents_code_key: 'An incident with this code already exists.',
  depots_name_key: 'A depot with this name already exists.',
};

/** Translate a PostgreSQL error into an HTTP status + message the UI can show. */
function fromPgError(err) {
  switch (err.code) {
    case 'P0001': {
      // RAISE EXCEPTION 'CODE: message' from our triggers / functions
      const [code, ...rest] = err.message.split(':');
      return { status: code === 'NOT_FOUND' ? 404 : 409, message: rest.join(':').trim() || err.message, code };
    }
    case '23514': // check_violation
    case '23502': // not_null_violation
      return {
        status: 400,
        message: CONSTRAINT_MESSAGES[err.constraint] || `Invalid value (${err.constraint || err.column || 'constraint'}).`,
        code: 'VALIDATION',
      };
    case '23505': // unique_violation
      return { status: 409, message: CONSTRAINT_MESSAGES[err.constraint] || 'This record already exists.', code: 'DUPLICATE' };
    case '23503': // foreign_key_violation
      return { status: 409, message: 'This record is linked to other data and cannot be changed or removed.', code: 'IN_USE' };
    case '22P02': // invalid_text_representation (bad enum value etc.)
    case '22003': // numeric out of range
      return { status: 400, message: 'One of the values has the wrong format.', code: 'VALIDATION' };
    case '40P01':
    case '40001':
      return { status: 409, message: 'Someone else was updating the same record. Please try again.', code: 'CONFLICT' };
    default:
      return null;
  }
}

/** Wrap a route handler: (request, ctx) => data | NextResponse */
export function handler(fn) {
  return async (request, ctx) => {
    try {
      const result = await fn(request, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
      }
      const pgErr = fromPgError(err);
      if (pgErr) {
        return NextResponse.json({ error: pgErr.message, code: pgErr.code }, { status: pgErr.status });
      }
      console.error(err);
      return NextResponse.json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
}

/** ?incident=ID, or the most recently started active incident */
export async function resolveIncident(request, one) {
  const raw = new URL(request.url).searchParams.get('incident');
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  const row = await one(
    `SELECT incident_id FROM incidents WHERE status <> 'closed' ORDER BY started_at DESC LIMIT 1`
  );
  if (!row) throw new HttpError(404, 'There is no active incident. An admin can create one on the Admin page.');
  return row.incident_id;
}
