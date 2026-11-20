-- =====================================================================
-- RAHAT : 03_views.sql  -  views and a materialized view for the dashboards
-- =====================================================================

-- ---------- triage queue: open SOS ranked by priority, with the nearest free team ----------
CREATE OR REPLACE VIEW v_sos_queue AS
SELECT s.sos_id, s.ticket, s.incident_id, s.status, s.reporter_name, s.reporter_phone, s.lat, s.lng, s.landmark,
       s.description, s.people_count, s.children, s.elderly, s.injured, s.needs, s.channel, s.created_at,
       s.suspected_dup_of, dup.ticket AS suspected_dup_ticket,
       ROUND(EXTRACT(EPOCH FROM now() - s.created_at) / 60)::INT AS waiting_min,
       fn_sos_priority(s.people_count, s.children, s.elderly, s.injured, s.needs, s.created_at) AS priority,
       RANK() OVER (PARTITION BY s.incident_id
                    ORDER BY fn_sos_priority(s.people_count, s.children, s.elderly, s.injured, s.needs, s.created_at) DESC,
                             s.created_at) AS queue_rank,
       nt.name AS nearest_team, nt.km AS nearest_team_km,
       d.dispatch_id, d.status AS dispatch_status, tm.name AS assigned_team
  FROM sos_requests s
  LEFT JOIN sos_requests dup ON dup.sos_id = s.suspected_dup_of
  LEFT JOIN dispatches d ON d.sos_id = s.sos_id AND d.status IN ('assigned', 'en_route', 'on_scene')
  LEFT JOIN teams tm ON tm.team_id = d.team_id
  -- correlated LATERAL subquery: nearest available team that can handle these needs
  LEFT JOIN LATERAL (
        SELECT t.name, fn_distance_km(t.cur_lat, t.cur_lng, s.lat, s.lng) AS km
          FROM teams t
         WHERE t.status = 'available' AND fn_team_fits(t.kind, s.needs)
         ORDER BY km LIMIT 1
  ) nt ON s.status IN ('new', 'triaged')
 WHERE s.status IN ('new', 'triaged', 'assigned', 'in_progress');

-- ---------- team board ----------
CREATE OR REPLACE VIEW v_team_board AS
SELECT t.team_id, t.name, t.kind, t.members, t.capacity, t.status, t.cur_lat, t.cur_lng, t.last_seen_at,
       d.dispatch_id, d.status AS dispatch_status, d.assigned_at, d.eta_minutes, d.distance_km,
       s.ticket, s.sos_id, s.landmark, s.people_count,
       ROUND(EXTRACT(EPOCH FROM now() - d.assigned_at) / 60)::INT AS minutes_on_job,
       (SELECT COUNT(*) FROM dispatches x WHERE x.team_id = t.team_id AND x.status = 'completed') AS jobs_done,
       (SELECT COALESCE(SUM(x.people_rescued), 0) FROM dispatches x WHERE x.team_id = t.team_id) AS people_rescued
  FROM teams t
  LEFT JOIN dispatches d ON d.team_id = t.team_id AND d.status IN ('assigned', 'en_route', 'on_scene')
  LEFT JOIN sos_requests s ON s.sos_id = d.sos_id;

-- ---------- stock per depot with days of supply (camps only have a population) ----------
CREATE OR REPLACE VIEW v_depot_stock AS
SELECT d.depot_id, d.name AS depot, d.kind, d.camp_id, r.resource_id, r.name AS resource, r.unit, r.category, r.critical,
       COALESCE(st.quantity, 0) AS quantity,
       c.occupancy,
       CASE WHEN c.occupancy > 0 AND r.per_person_per_day > 0
            THEN ROUND(COALESCE(st.quantity, 0) / (c.occupancy * r.per_person_per_day), 1) END AS days_of_supply
  FROM depots d
  CROSS JOIN resources r
  LEFT JOIN stock st ON st.depot_id = d.depot_id AND st.resource_id = r.resource_id
  LEFT JOIN camps c ON c.camp_id = d.camp_id;

-- ---------- camp status: occupancy and the resource that runs out first ----------
CREATE OR REPLACE VIEW v_camp_status AS
WITH supply AS (
    SELECT camp_id, MIN(days_of_supply) AS min_days,
           (ARRAY_AGG(resource ORDER BY days_of_supply NULLS LAST))[1] AS shortest_resource
      FROM v_depot_stock
     WHERE kind = 'camp' AND critical AND days_of_supply IS NOT NULL
     GROUP BY camp_id
), residents AS (
    SELECT cs.camp_id,
           COUNT(*) FILTER (WHERE p.age < 12)  AS children,
           COUNT(*) FILTER (WHERE p.age >= 60) AS elderly,
           COUNT(*) FILTER (WHERE p.needs_medical) AS medical
      FROM camp_stays cs JOIN people p USING (person_id)
     WHERE cs.checked_out_at IS NULL
     GROUP BY cs.camp_id
)
SELECT c.camp_id, c.incident_id, c.name, c.kind, c.lat, c.lng, c.capacity, c.occupancy, c.status,
       ROUND(100.0 * c.occupancy / c.capacity, 1) AS occupancy_pct,
       COALESCE(r.children, 0) AS children, COALESCE(r.elderly, 0) AS elderly, COALESCE(r.medical, 0) AS needs_medical,
       s.min_days AS days_of_supply, s.shortest_resource,
       d.depot_id
  FROM camps c
  LEFT JOIN supply s ON s.camp_id = c.camp_id
  LEFT JOIN residents r ON r.camp_id = c.camp_id
  LEFT JOIN depots d ON d.camp_id = c.camp_id;

-- ---------- response times per finished dispatch ----------
CREATE OR REPLACE VIEW v_response_times AS
SELECT d.dispatch_id, s.incident_id, s.ticket, t.name AS team, t.kind,
       ROUND(EXTRACT(EPOCH FROM d.assigned_at - s.created_at) / 60, 1) AS minutes_to_assign,
       ROUND(EXTRACT(EPOCH FROM d.on_scene_at - s.created_at) / 60, 1) AS minutes_to_scene,
       ROUND(EXTRACT(EPOCH FROM d.finished_at - s.created_at) / 60, 1) AS minutes_to_close,
       d.eta_minutes,
       ROUND(EXTRACT(EPOCH FROM d.on_scene_at - d.assigned_at) / 60, 1) - d.eta_minutes AS eta_error_min,
       d.people_rescued, d.status
  FROM dispatches d
  JOIN sos_requests s USING (sos_id)
  JOIN teams t USING (team_id)
 WHERE d.status IN ('completed', 'aborted');

-- ---------- one-line summary per incident (aggregate FILTER clauses) ----------
CREATE OR REPLACE VIEW v_incident_summary AS
SELECT i.incident_id, i.code, i.name, i.disaster_type, i.status, i.severity, i.center_lat, i.center_lng, i.radius_km, i.started_at,
       (SELECT COUNT(*) FROM sos_requests s WHERE s.incident_id = i.incident_id) AS sos_total,
       (SELECT COUNT(*) FROM sos_requests s WHERE s.incident_id = i.incident_id AND s.status IN ('new', 'triaged')) AS sos_waiting,
       (SELECT COUNT(*) FROM sos_requests s WHERE s.incident_id = i.incident_id AND s.status IN ('assigned', 'in_progress')) AS sos_active,
       (SELECT COUNT(*) FROM sos_requests s WHERE s.incident_id = i.incident_id AND s.status = 'resolved') AS sos_resolved,
       (SELECT COALESCE(SUM(d.people_rescued), 0) FROM dispatches d JOIN sos_requests s USING (sos_id)
         WHERE s.incident_id = i.incident_id) AS people_rescued,
       (SELECT COALESCE(SUM(c.occupancy), 0) FROM camps c WHERE c.incident_id = i.incident_id) AS people_in_camps,
       (SELECT COUNT(*) FROM camps c WHERE c.incident_id = i.incident_id AND c.status <> 'closed') AS camps_open,
       (SELECT COUNT(*) FROM missing_reports m WHERE m.incident_id = i.incident_id AND m.status = 'open') AS missing_open,
       (SELECT COUNT(*) FROM alerts a WHERE a.incident_id = i.incident_id AND a.resolved_at IS NULL) AS open_alerts
  FROM incidents i;

-- ---------- materialized daily situation report (refreshed by sp_refresh_dashboard) ----------
CREATE MATERIALIZED VIEW mv_daily_sitrep AS
WITH days AS (
    SELECT i.incident_id, generate_series(date_trunc('day', i.started_at AT TIME ZONE 'Asia/Kolkata'),
                                          date_trunc('day', COALESCE(i.ended_at, now()) AT TIME ZONE 'Asia/Kolkata'),
                                          INTERVAL '1 day')::DATE AS day
      FROM incidents i
), sos AS (
    SELECT incident_id, (created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day, COUNT(*) AS received,
           SUM(people_count) AS people_reported
      FROM sos_requests WHERE status <> 'duplicate' GROUP BY 1, 2
), done AS (
    SELECT s.incident_id, (d.finished_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day,
           COUNT(*) AS resolved, SUM(d.people_rescued) AS rescued,
           ROUND(AVG(EXTRACT(EPOCH FROM d.on_scene_at - s.created_at) / 60)::NUMERIC, 1) AS avg_response_min,
           ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d.on_scene_at - s.created_at) / 60))::NUMERIC, 1) AS median_response_min,
           ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM d.on_scene_at - s.created_at) / 60))::NUMERIC, 1) AS p90_response_min
      FROM dispatches d JOIN sos_requests s USING (sos_id)
     WHERE d.status = 'completed' GROUP BY 1, 2
), checkins AS (
    SELECT c.incident_id, (cs.checked_in_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day, COUNT(*) AS checked_in
      FROM camp_stays cs JOIN camps c USING (camp_id) GROUP BY 1, 2
), relief AS (
    SELECT (m.created_at AT TIME ZONE 'Asia/Kolkata')::DATE AS day, c.incident_id, SUM(m.people_served) AS people_served
      FROM stock_movements m JOIN depots d USING (depot_id) JOIN camps c ON c.camp_id = d.camp_id
     WHERE m.reason = 'distributed' GROUP BY 1, 2
)
SELECT d.incident_id, d.day,
       COALESCE(s.received, 0) AS sos_received,
       COALESCE(s.people_reported, 0) AS people_reported,
       COALESCE(x.resolved, 0) AS sos_resolved,
       COALESCE(x.rescued, 0) AS people_rescued,
       x.avg_response_min, x.median_response_min, x.p90_response_min,
       COALESCE(ci.checked_in, 0) AS camp_checkins,
       SUM(COALESCE(ci.checked_in, 0)) OVER (PARTITION BY d.incident_id ORDER BY d.day) AS cumulative_checkins,
       COALESCE(r.people_served, 0) AS relief_servings
  FROM days d
  LEFT JOIN sos s      ON s.incident_id = d.incident_id AND s.day = d.day
  LEFT JOIN done x     ON x.incident_id = d.incident_id AND x.day = d.day
  LEFT JOIN checkins ci ON ci.incident_id = d.incident_id AND ci.day = d.day
  LEFT JOIN relief r   ON r.incident_id = d.incident_id AND r.day = d.day;

-- unique index: required for REFRESH MATERIALIZED VIEW CONCURRENTLY (readers are not blocked)
CREATE UNIQUE INDEX uq_mv_daily_sitrep ON mv_daily_sitrep (incident_id, day);
