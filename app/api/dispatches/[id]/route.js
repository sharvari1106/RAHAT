import { CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { one, query } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, num, oneOf, str } from '@/lib/validate';

// PATCH /api/dispatches/:id { status, peopleRescued?, note?, lat?, lng? }
// Team leads update their own job; coordinators can update any job (e.g. after a radio call).
export const PATCH = handler(async (request, { params }) => {
  const s = await requireUser(request, [...CONTROL_ROLES, 'responder']);
  const dispatchId = id((await params).id);
  const d = await one('SELECT team_id FROM dispatches WHERE dispatch_id = $1', [dispatchId]);
  if (!d) throw new HttpError(404, 'Job not found.');
  if (s.role === 'responder' && Number(s.teamId) !== d.team_id) throw new HttpError(403, 'This job belongs to another team.');

  const b = await readJson(request);
  const status = oneOf(b.status, 'Status', ['en_route', 'on_scene', 'completed', 'aborted']);
  const people = b.peopleRescued === '' || b.peopleRescued == null ? null : num(b.peopleRescued, 'People rescued', { min: 0, max: 500, integer: true });
  const note = str(b.note, 'Note', { max: 300, optional: true });
  if (status === 'aborted' && !note) throw new HttpError(400, 'Say why the job was aborted, so the next team knows.');
  const lat = b.lat == null ? null : num(b.lat, 'Latitude', { min: 6, max: 37.5 });
  const lng = b.lng == null ? null : num(b.lng, 'Longitude', { min: 68, max: 97.5 });

  await query('SELECT fn_update_dispatch($1, $2, $3, $4, $5, $6, $7)', [dispatchId, status, s.uid, people, note, lat, lng]);
  logActivity({ userId: s.uid, role: s.role, action: `dispatch.${status}`, entity: 'dispatch', entityId: dispatchId, meta: { people } });
  return { ok: true };
});
