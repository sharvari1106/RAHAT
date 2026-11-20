import { CONTROL_ROLES, handler, readJson, requireUser, resolveIncident } from '@/lib/api';
import { many, one } from '@/lib/db';
import { embedOne, toPgVector } from '@/lib/embeddings';
import { logActivity } from '@/lib/mongo';
import { createSos, parseSos } from '@/lib/sos';

// GET /api/sos?incident=1&view=open|closed&q=...
//  open   -> triage queue (view v_sos_queue), ranked by priority
//  closed -> resolved / duplicate / cancelled requests
//  q      -> hybrid search: ticket/phone exact + full-text + semantic (any language), fused with RRF
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const inc = await resolveIncident(request, one);
  const sp = new URL(request.url).searchParams;
  const q = (sp.get('q') || '').trim();

  if (q) {
    const vec = q.length >= 3 ? await embedOne(q) : null;
    const rows = await many(
      `WITH exact AS (
           SELECT sos_id, 1 AS r, 'ticket/phone' AS how FROM sos_requests
            WHERE incident_id = $1 AND (ticket = upper($2) OR reporter_phone = $2)
       ), fts AS (
           SELECT sos_id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_tsv, plainto_tsquery('simple', $2)) DESC) AS r, 'words' AS how
             FROM sos_requests
            WHERE incident_id = $1 AND search_tsv @@ plainto_tsquery('simple', $2)
            LIMIT 30
       ), sem AS (
           SELECT sos_id, ROW_NUMBER() OVER (ORDER BY dist) AS r, 'meaning' AS how
             FROM (SELECT sos_id, embedding <=> $3::vector AS dist FROM sos_requests
                    WHERE incident_id = $1 AND embedding IS NOT NULL AND $3::vector IS NOT NULL
                    ORDER BY embedding <=> $3::vector LIMIT 30) x
            WHERE dist < 0.6
       ), fused AS (
           SELECT sos_id, SUM(1.0 / (60 + r)) AS score, string_agg(DISTINCT how, ' + ') AS matched_by
             FROM (SELECT * FROM exact UNION ALL SELECT * FROM fts UNION ALL SELECT * FROM sem) u
            GROUP BY sos_id
       )
       SELECT s.sos_id, s.ticket, s.status, s.description, s.landmark, s.people_count, s.needs, s.created_at,
              s.reporter_name, f.matched_by, ROUND(f.score::NUMERIC, 4) AS score
         FROM fused f JOIN sos_requests s USING (sos_id)
        ORDER BY f.score DESC, s.created_at DESC
        LIMIT 30`,
      [inc, q, toPgVector(vec)]
    );
    return { incidentId: inc, mode: 'search', semantic: !!vec, rows };
  }

  if (sp.get('view') === 'closed') {
    const rows = await many(
      `SELECT s.sos_id, s.ticket, s.status, s.description, s.landmark, s.people_count, s.needs, s.created_at, s.updated_at,
              o.ticket AS duplicate_of_ticket,
              (SELECT d.people_rescued FROM dispatches d WHERE d.sos_id = s.sos_id AND d.status = 'completed' LIMIT 1) AS people_rescued
         FROM sos_requests s LEFT JOIN sos_requests o ON o.sos_id = s.duplicate_of
        WHERE s.incident_id = $1 AND s.status IN ('resolved', 'duplicate', 'cancelled')
        ORDER BY s.updated_at DESC LIMIT 100`,
      [inc]
    );
    return { incidentId: inc, mode: 'closed', rows };
  }

  const rows = await many('SELECT * FROM v_sos_queue WHERE incident_id = $1 ORDER BY queue_rank', [inc]);
  return { incidentId: inc, mode: 'open', rows };
});

// POST /api/sos - coordinator logs a helpline call
export const POST = handler(async (request) => {
  const s = await requireUser(request, CONTROL_ROLES);
  const body = await readJson(request);
  const r = await createSos(parseSos(body), { channel: body.channel === 'field' ? 'field' : 'helpline', userId: s.uid });
  logActivity({ userId: s.uid, role: s.role, action: 'sos.create', entity: 'sos', entityId: r.sos_id });
  return r;
});
