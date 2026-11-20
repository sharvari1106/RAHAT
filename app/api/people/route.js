import { CONTROL_ROLES, handler, requireUser } from '@/lib/api';
import { many } from '@/lib/db';
import { embedOne, toPgVector } from '@/lib/embeddings';

// GET /api/people?q=... - search the whole evacuee registry by name (trigram) or description (vector)
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return { rows: [] };
  const vec = q.split(/\s+/).length >= 3 ? await embedOne(q) : null; // descriptions are several words
  const rows = await many(
    `WITH byname AS (
         SELECT person_id, ROW_NUMBER() OVER (ORDER BY full_name <-> $1) AS r
           FROM (SELECT person_id, full_name FROM people ORDER BY full_name <-> $1 LIMIT 20) x
     ), bymeaning AS (
         SELECT person_id, ROW_NUMBER() OVER (ORDER BY d) AS r
           FROM (SELECT person_id, embedding <=> $2::vector AS d FROM people
                  WHERE $2::vector IS NOT NULL AND embedding IS NOT NULL
                  ORDER BY embedding <=> $2::vector LIMIT 20) y
     ), fused AS (
         SELECT person_id, SUM(1.0 / (60 + r)) AS score FROM (SELECT * FROM byname UNION ALL SELECT * FROM bymeaning) u GROUP BY person_id
     )
     SELECT p.person_id, p.full_name, p.age, p.gender, p.home_village, p.marks, c.name AS camp, c.camp_id,
            ROUND(similarity(p.full_name, $1)::NUMERIC, 2) AS name_sim
       FROM fused f JOIN people p USING (person_id)
       LEFT JOIN camp_stays cs ON cs.person_id = p.person_id AND cs.checked_out_at IS NULL
       LEFT JOIN camps c ON c.camp_id = cs.camp_id
      ORDER BY f.score DESC LIMIT 20`,
    [q, toPgVector(vec)]
  );
  return { rows, semantic: !!vec };
});
