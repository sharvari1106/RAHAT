import { CONTROL_ROLES, handler, HttpError, readJson, requireUser } from '@/lib/api';
import { withTransaction } from '@/lib/db';
import { logActivity } from '@/lib/mongo';
import { id, oneOf, str } from '@/lib/validate';

// POST /api/sos/:id/status { action: triage | cancel | not_duplicate, note? }
// The state machine trigger rejects anything not listed in sos_transitions.
export const POST = handler(async (request, { params }) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const sosId = id((await params).id);
  const b = await readJson(request);
  const action = oneOf(b.action, 'Action', ['triage', 'cancel', 'not_duplicate']);
  const note = str(b.note, 'Note', { max: 200, optional: true });
  if (action === 'cancel' && !note) throw new HttpError(400, 'Give a reason for cancelling (e.g. "family self-evacuated").');

  await withTransaction(async (c) => {
    // who and why, read by the history trigger
    await c.query("SELECT fn_set_actor($1), set_config('rahat.note', $2, TRUE)", [s.uid, note || '']);
    if (action === 'triage') {
      const r = await c.query("UPDATE sos_requests SET status = 'triaged' WHERE sos_id = $1 AND status = 'new'", [sosId]);
      if (!r.rowCount) throw new HttpError(409, 'Only a new request can be marked as triaged.');
    } else if (action === 'cancel') {
      await c.query("UPDATE sos_requests SET status = 'cancelled' WHERE sos_id = $1", [sosId]);
    } else {
      await c.query(
        "UPDATE sos_requests SET suspected_dup_of = NULL, status = CASE WHEN status = 'new' THEN 'triaged'::sos_status ELSE status END WHERE sos_id = $1",
        [sosId]
      );
    }
  });
  logActivity({ userId: s.uid, role: s.role, action: `sos.${action}`, entity: 'sos', entityId: sosId });
  return { ok: true };
});
