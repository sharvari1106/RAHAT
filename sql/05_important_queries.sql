-- =====================================================================
-- RAHAT : 05_important_queries.sql
-- The queries the app relies on, grouped by syllabus topic, run against
-- the seeded data.   npm run db:queries
-- =====================================================================

\echo 'Q1. JOIN + ORDER BY: the triage queue (view v_sos_queue) - what the control room sees first'
SELECT queue_rank, ticket, status, priority, waiting_min, people_count, injured, needs, nearest_team, nearest_team_km
  FROM v_sos_queue
 WHERE incident_id = 1 AND status IN ('new', 'triaged')
 ORDER BY queue_rank
 LIMIT 10;

\echo 'Q2. GROUP BY + HAVING: villages with more than 5 SOS requests and their average group size'
SELECT split_part(landmark, ' ', 2) AS area, COUNT(*) AS requests, ROUND(AVG(people_count), 1) AS avg_people,
       SUM(injured) AS injured
  FROM sos_requests
 WHERE status <> 'duplicate'
 GROUP BY 1
HAVING COUNT(*) > 5
 ORDER BY requests DESC;

\echo 'Q3. Aggregate FILTER: SOS by need and by status in one pass'
SELECT need,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status IN ('new', 'triaged')) AS waiting,
       COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
  FROM sos_requests, unnest(needs) AS need
 GROUP BY need
 ORDER BY total DESC;

\echo 'Q4. Correlated subquery: teams that have rescued more people than the average team'
SELECT t.name, t.kind,
       (SELECT COALESCE(SUM(d.people_rescued), 0) FROM dispatches d WHERE d.team_id = t.team_id) AS rescued
  FROM teams t
 WHERE (SELECT COALESCE(SUM(d.people_rescued), 0) FROM dispatches d WHERE d.team_id = t.team_id)
     > (SELECT AVG(x.s) FROM (SELECT COALESCE(SUM(people_rescued), 0) AS s FROM dispatches GROUP BY team_id) x)
 ORDER BY rescued DESC;

\echo 'Q5. Window functions: each team''s jobs in order, time since its previous job (LAG) and running total (SUM OVER)'
SELECT t.name, s.ticket, d.assigned_at::TIMESTAMP(0) AS assigned_at, d.people_rescued,
       ROUND(EXTRACT(EPOCH FROM d.assigned_at - LAG(d.finished_at) OVER w) / 60) AS rest_min_before_job,
       SUM(d.people_rescued) OVER (w ROWS UNBOUNDED PRECEDING) AS running_rescued
  FROM dispatches d JOIN teams t USING (team_id) JOIN sos_requests s USING (sos_id)
 WHERE d.status = 'completed' AND t.kind = 'boat'
WINDOW w AS (PARTITION BY d.team_id ORDER BY d.assigned_at)
 ORDER BY t.name, d.assigned_at
 LIMIT 15;

\echo 'Q6. Percentiles: response time (report -> team on scene) per team kind'
SELECT kind,
       COUNT(*) AS jobs,
       ROUND(AVG(minutes_to_scene), 1) AS avg_min,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes_to_scene))::NUMERIC, 1) AS median_min,
       ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY minutes_to_scene))::NUMERIC, 1) AS p90_min
  FROM v_response_times
 WHERE status = 'completed'
 GROUP BY kind
 ORDER BY median_min;

\echo 'Q7. CTE + LATERAL: for every waiting SOS, the 2 nearest free teams that can help'
WITH waiting AS (
    SELECT sos_id, ticket, lat, lng, needs FROM sos_requests WHERE status IN ('new', 'triaged') LIMIT 5
)
SELECT w.ticket, w.needs, t.name, t.kind, t.km
  FROM waiting w
  CROSS JOIN LATERAL (
        SELECT name, kind, fn_distance_km(cur_lat, cur_lng, w.lat, w.lng) AS km
          FROM teams
         WHERE status = 'available' AND fn_team_fits(kind, w.needs)
         ORDER BY km LIMIT 2) t
 ORDER BY w.ticket, t.km;

\echo 'Q8. Camp status (view with CTEs): occupancy and the resource that runs out first'
SELECT name, occupancy, capacity, occupancy_pct, children, elderly, needs_medical, days_of_supply, shortest_resource
  FROM v_camp_status ORDER BY days_of_supply NULLS LAST;

\echo 'Q9. Subquery with NOT EXISTS: open camps that have received no supplies in the last 24 hours'
SELECT c.name, c.occupancy
  FROM camps c JOIN depots d ON d.camp_id = c.camp_id
 WHERE c.status <> 'closed'
   AND NOT EXISTS (SELECT 1 FROM stock_movements m
                    WHERE m.depot_id = d.depot_id AND m.qty_change > 0 AND m.created_at > now() - INTERVAL '24 hours');

\echo 'Q10. Stock ledger reconciliation: stock table = sum of all movements (must return 0 rows)'
SELECT s.depot_id, s.resource_id, s.quantity, SUM(m.qty_change) AS ledger_total
  FROM stock s JOIN stock_movements m USING (depot_id, resource_id)
 GROUP BY s.depot_id, s.resource_id, s.quantity
HAVING s.quantity <> SUM(m.qty_change);

\echo 'Q11. Occupancy check: camps.occupancy = number of open stays (must return 0 rows)'
SELECT c.name, c.occupancy, COUNT(cs.stay_id) AS open_stays
  FROM camps c LEFT JOIN camp_stays cs ON cs.camp_id = c.camp_id AND cs.checked_out_at IS NULL
 GROUP BY c.camp_id
HAVING c.occupancy <> COUNT(cs.stay_id);

\echo 'Q12. Full-text search over SOS descriptions (GIN index on the generated tsvector)'
SELECT ticket, status, ts_rank(search_tsv, q) AS rank, left(description, 70) AS description
  FROM sos_requests, plainto_tsquery('simple', 'stuck water') q
 WHERE search_tsv @@ q
 ORDER BY rank DESC LIMIT 5;

\echo 'Q13. Fuzzy name search (pg_trgm KNN on the GiST index): who in the camps is called something like "Ganapati"?'
SELECT p.full_name, p.age, c.name AS camp, ROUND(similarity(p.full_name, 'Ganapati')::NUMERIC, 2) AS sim
  FROM people p
  LEFT JOIN camp_stays cs ON cs.person_id = p.person_id AND cs.checked_out_at IS NULL
  LEFT JOIN camps c ON c.camp_id = cs.camp_id
 ORDER BY p.full_name <-> 'Ganapati'
 LIMIT 5;

\echo 'Q14. Vector similarity: SOS that mean the same as SOS-000002 in any language (needs npm run db:embed)'
SELECT b.ticket, ROUND((1 - (a.embedding <=> b.embedding))::NUMERIC, 3) AS cosine_similarity, left(b.description, 60) AS description
  FROM sos_requests a, sos_requests b
 WHERE a.ticket = 'SOS-000002' AND b.sos_id <> a.sos_id AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
 ORDER BY a.embedding <=> b.embedding
 LIMIT 5;

\echo 'Q15. Missing-person matching: candidates for MP-000001 (trigram + vector, re-scored)'
SELECT * FROM fn_match_missing((SELECT report_id FROM missing_reports WHERE ticket = 'MP-000001'));

\echo 'Q16. Materialized view: daily situation report'
SELECT day, sos_received, sos_resolved, people_rescued, median_response_min, p90_response_min, camp_checkins,
       cumulative_checkins, relief_servings
  FROM mv_daily_sitrep WHERE incident_id = 1 ORDER BY day;

\echo 'Q17. Audit trail: full status history of one SOS (append-only table)'
SELECT h.changed_at::TIMESTAMP(0) AS at, h.from_status, h.to_status, u.name AS changed_by, h.note
  FROM sos_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
 WHERE h.sos_id = (SELECT sos_id FROM dispatches WHERE status = 'completed' ORDER BY dispatch_id LIMIT 1)
 ORDER BY h.history_id;

\echo 'Q18. EXPLAIN: the triage queue uses the partial index on open SOS'
EXPLAIN SELECT sos_id FROM sos_requests WHERE incident_id = 1 AND status IN ('new', 'triaged', 'assigned', 'in_progress')
 ORDER BY created_at;
