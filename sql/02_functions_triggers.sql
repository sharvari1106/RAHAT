-- =====================================================================
-- RAHAT : 02_functions_triggers.sql
-- Business rules enforced inside PostgreSQL:
--   * SOS state machine + append-only history            (triggers)
--   * duplicate-SOS detection (distance + vector)         (function)
--   * nearest-team suggestion, atomic dispatch,
--     auto-dispatch with FOR UPDATE SKIP LOCKED           (functions, transactions, row locks)
--   * camp capacity with row lock + occupancy counter     (triggers)
--   * stock ledger, transfers, low-supply alerts          (triggers, functions)
--   * missing-person matching (trigram + vector)          (functions)
-- Errors are raised as 'CODE: message' so the API can show the message.
-- =====================================================================

-- ---------- reference data: allowed SOS status changes ----------
INSERT INTO sos_transitions (from_status, to_status) VALUES
  ('new', 'triaged'), ('new', 'assigned'), ('new', 'duplicate'), ('new', 'cancelled'),
  ('triaged', 'assigned'), ('triaged', 'duplicate'), ('triaged', 'cancelled'),
  ('assigned', 'in_progress'), ('assigned', 'triaged'),       -- triaged again = dispatch aborted, back in queue
  ('in_progress', 'resolved'), ('in_progress', 'triaged');

-- =====================================================================
-- Helpers
-- =====================================================================

-- who is acting in this transaction (read by audit triggers)
CREATE OR REPLACE FUNCTION fn_set_actor(p_user_id INT) RETURNS VOID LANGUAGE sql AS $$
    SELECT set_config('rahat.actor', COALESCE(p_user_id::TEXT, ''), TRUE);
$$;

CREATE OR REPLACE FUNCTION fn_actor() RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('rahat.actor', TRUE), '')::INT;
$$;

-- great-circle distance in km (haversine). IMMUTABLE so it can be used in indexes/views.
CREATE OR REPLACE FUNCTION fn_distance_km(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT ROUND((2 * 6371 * asin(sqrt(
              power(sin(radians((lat2 - lat1)::FLOAT8) / 2), 2) +
              cos(radians(lat1::FLOAT8)) * cos(radians(lat2::FLOAT8)) *
              power(sin(radians((lng2 - lng1)::FLOAT8) / 2), 2))))::NUMERIC, 3);
$$;

-- triage score 0-100: injured, vulnerable people, group size, life-threatening needs,
-- and waiting time (so old requests rise and are never starved)
CREATE OR REPLACE FUNCTION fn_sos_priority(
    p_people INT, p_children INT, p_elderly INT, p_injured INT, p_needs need_type[], p_created TIMESTAMPTZ
) RETURNS INT LANGUAGE sql STABLE AS $$
    SELECT LEAST(100, ROUND(
          LEAST(30, p_injured * 10)
        + LEAST(20, (p_children + p_elderly) * 4)
        + LEAST(15, p_people * 1.5)
        + CASE WHEN 'rescue'  = ANY (p_needs) THEN 15 ELSE 0 END
        + CASE WHEN 'medical' = ANY (p_needs) THEN 10 ELSE 0 END
        + LEAST(20, EXTRACT(EPOCH FROM (now() - p_created)) / 360.0)     -- +1 point per 6 minutes waited
    ))::INT;
$$;

-- which kinds of team can serve which needs
CREATE OR REPLACE FUNCTION fn_team_fits(p_kind team_kind, p_needs need_type[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_kind
        WHEN 'boat'          THEN 'rescue' = ANY (p_needs)
        WHEN 'search_rescue' THEN 'rescue' = ANY (p_needs) OR 'medical' = ANY (p_needs)
        WHEN 'medical'       THEN 'medical' = ANY (p_needs)
        WHEN 'supply'        THEN p_needs && ARRAY['food', 'water', 'shelter']::need_type[]
    END;
$$;

CREATE OR REPLACE FUNCTION fn_team_speed_kmh(p_kind team_kind) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_kind WHEN 'boat' THEN 12 WHEN 'search_rescue' THEN 25 ELSE 30 END;
$$;

-- raise or refresh an alert once (deduplicated by the partial unique index uq_alert_open)
CREATE OR REPLACE FUNCTION fn_raise_alert(p_incident INT, p_kind TEXT, p_severity alert_severity,
                                          p_message TEXT, p_key TEXT, p_link TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO alerts (incident_id, kind, severity, message, dedupe_key, link)
    VALUES (p_incident, p_kind, p_severity, p_message, p_key, p_link)
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL
    DO UPDATE SET kind = EXCLUDED.kind, message = EXCLUDED.message, severity = EXCLUDED.severity;
END $$;

CREATE OR REPLACE FUNCTION fn_resolve_alert(p_key TEXT) RETURNS VOID LANGUAGE sql AS $$
    UPDATE alerts SET resolved_at = now() WHERE dedupe_key = p_key AND resolved_at IS NULL;
$$;

-- =====================================================================
-- Append-only tables: history and ledgers can never be edited or deleted
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'APPEND_ONLY: % rows cannot be changed or deleted; record a correcting entry instead', TG_TABLE_NAME
        USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER trg_history_append_only BEFORE UPDATE OR DELETE ON sos_status_history
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER trg_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();

-- =====================================================================
-- SOS state machine
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_sos_before_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT EXISTS (SELECT 1 FROM sos_transitions WHERE from_status = OLD.status AND to_status = NEW.status) THEN
            RAISE EXCEPTION 'BAD_TRANSITION: an SOS cannot go from % to %', OLD.status, NEW.status
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    -- what the citizen reported is evidence: it cannot be rewritten after the fact
    IF (NEW.description, NEW.lat, NEW.lng, NEW.reporter_phone, NEW.created_at)
       IS DISTINCT FROM (OLD.description, OLD.lat, OLD.lng, OLD.reporter_phone, OLD.created_at) THEN
        RAISE EXCEPTION 'IMMUTABLE_REPORT: the original SOS report cannot be edited' USING ERRCODE = 'P0001';
    END IF;
    -- embeddings are filled in later by a background job; that is not a change of the request
    IF (NEW.status, NEW.suspected_dup_of, NEW.duplicate_of) IS DISTINCT FROM (OLD.status, OLD.suspected_dup_of, OLD.duplicate_of) THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_sos_validate BEFORE UPDATE ON sos_requests
    FOR EACH ROW EXECUTE FUNCTION trg_sos_before_update();

CREATE OR REPLACE FUNCTION trg_sos_log_status() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO sos_status_history (sos_id, from_status, to_status, changed_by, note)
        VALUES (NEW.sos_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, fn_actor(),
                NULLIF(current_setting('rahat.note', TRUE), ''));
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('new', 'triaged') THEN
        PERFORM fn_resolve_alert('sos_unassigned:' || NEW.sos_id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER trg_sos_history AFTER INSERT OR UPDATE OF status ON sos_requests
    FOR EACH ROW EXECUTE FUNCTION trg_sos_log_status();

-- =====================================================================
-- Duplicate detection + SOS creation
-- =====================================================================
-- Same flood, same roof, three family members calling: find open SOS within 1 km in the
-- last 12 h that come from the same phone, describe the same situation (cosine similarity
-- of multilingual embeddings) or are practically at the same spot.
CREATE OR REPLACE FUNCTION fn_find_duplicate_sos(
    p_incident INT, p_lat NUMERIC, p_lng NUMERIC, p_phone TEXT, p_embedding vector, p_exclude INT DEFAULT NULL
) RETURNS TABLE (sos_id INT, ticket VARCHAR, distance_m INT, similarity NUMERIC, reason TEXT)
LANGUAGE sql STABLE AS $$
    WITH near AS (
        SELECT s.sos_id, s.ticket, s.reporter_phone,
               fn_distance_km(p_lat, p_lng, s.lat, s.lng) AS km,
               CASE WHEN p_embedding IS NOT NULL AND s.embedding IS NOT NULL
                    THEN ROUND((1 - (s.embedding <=> p_embedding))::NUMERIC, 3) END AS sim
          FROM sos_requests s
         WHERE s.incident_id = p_incident
           AND s.status IN ('new', 'triaged', 'assigned', 'in_progress')
           AND s.created_at > now() - INTERVAL '12 hours'
           AND s.lat BETWEEN p_lat - 0.01 AND p_lat + 0.01          -- ~1.1 km box, uses idx_sos_latlng
           AND s.lng BETWEEN p_lng - 0.01 AND p_lng + 0.01
           AND s.sos_id IS DISTINCT FROM p_exclude
    )
    SELECT n.sos_id, n.ticket, (n.km * 1000)::INT, n.sim,
           CASE WHEN n.reporter_phone = p_phone THEN 'same phone number'
                WHEN n.sim >= 0.80 THEN 'very similar description'
                ELSE 'same location' END
      FROM near n
     WHERE n.km <= 1.0
       AND (n.reporter_phone = p_phone OR n.sim >= 0.80 OR n.km <= 0.15)
     ORDER BY (n.reporter_phone = p_phone) DESC, n.sim DESC NULLS LAST, n.km
     LIMIT 5;
$$;

CREATE OR REPLACE FUNCTION fn_create_sos(
    p_incident INT, p_name TEXT, p_phone TEXT, p_lat NUMERIC, p_lng NUMERIC, p_landmark TEXT,
    p_description TEXT, p_people INT, p_children INT, p_elderly INT, p_injured INT,
    p_needs need_type[], p_channel TEXT, p_embedding vector, p_user INT DEFAULT NULL
) RETURNS TABLE (sos_id INT, ticket VARCHAR, suspected_dup_of INT, dup_ticket VARCHAR, dup_reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_inc incidents%ROWTYPE;
    d RECORD;
BEGIN
    SELECT * INTO v_inc FROM incidents WHERE incident_id = p_incident;
    IF NOT FOUND OR v_inc.status = 'closed' THEN
        RAISE EXCEPTION 'INCIDENT_CLOSED: this incident is not accepting requests' USING ERRCODE = 'P0001';
    END IF;
    IF fn_distance_km(v_inc.center_lat, v_inc.center_lng, p_lat, p_lng) > v_inc.radius_km * 1.5 THEN
        RAISE EXCEPTION 'OUTSIDE_AREA: this location is % km from the % area. Please check the pin.',
            ROUND(fn_distance_km(v_inc.center_lat, v_inc.center_lng, p_lat, p_lng)), v_inc.name USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO d FROM fn_find_duplicate_sos(p_incident, p_lat, p_lng, p_phone, p_embedding) LIMIT 1;

    PERFORM fn_set_actor(p_user);
    INSERT INTO sos_requests AS s (incident_id, reporter_name, reporter_phone, lat, lng, landmark, description,
                              people_count, children, elderly, injured, needs, channel, embedding, suspected_dup_of)
    VALUES (p_incident, p_name, p_phone, p_lat, p_lng, NULLIF(trim(p_landmark), ''), p_description,
            p_people, COALESCE(p_children, 0), COALESCE(p_elderly, 0), COALESCE(p_injured, 0),
            p_needs, COALESCE(p_channel, 'web'), p_embedding, d.sos_id)
    RETURNING s.sos_id, s.ticket INTO sos_id, ticket;

    suspected_dup_of := d.sos_id;
    dup_ticket := d.ticket;
    dup_reason := d.reason;
    RETURN NEXT;
END $$;

-- coordinator confirms a suspected duplicate: it leaves the queue, the original keeps the work
CREATE OR REPLACE PROCEDURE sp_merge_duplicate(p_dup INT, p_original INT, p_user INT) LANGUAGE plpgsql AS $$
DECLARE o sos_requests%ROWTYPE;
BEGIN
    IF p_dup = p_original THEN
        RAISE EXCEPTION 'BAD_MERGE: an SOS cannot be a duplicate of itself' USING ERRCODE = 'P0001';
    END IF;
    -- lock both rows in id order so two coordinators merging at once cannot deadlock
    PERFORM 1 FROM sos_requests WHERE sos_requests.sos_id IN (p_dup, p_original) ORDER BY sos_requests.sos_id FOR UPDATE;
    SELECT * INTO o FROM sos_requests WHERE sos_requests.sos_id = p_original;
    IF o.status IN ('duplicate', 'cancelled') THEN
        RAISE EXCEPTION 'BAD_MERGE: the original request % is itself %', o.ticket, o.status USING ERRCODE = 'P0001';
    END IF;
    PERFORM fn_set_actor(p_user);
    PERFORM set_config('rahat.note', 'duplicate of ' || o.ticket, TRUE);
    UPDATE sos_requests SET status = 'duplicate', duplicate_of = p_original, suspected_dup_of = NULL
     WHERE sos_requests.sos_id = p_dup;
    PERFORM set_config('rahat.note', '', TRUE);
END $$;

-- =====================================================================
-- Team suggestion and dispatch
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_suggest_teams(p_sos INT, p_limit INT DEFAULT 5)
RETURNS TABLE (team_id INT, name VARCHAR, kind team_kind, members SMALLINT, capacity SMALLINT,
               distance_km NUMERIC, eta_minutes INT, fits BOOLEAN)
LANGUAGE sql STABLE AS $$
    SELECT t.team_id, t.name, t.kind, t.members, t.capacity,
           fn_distance_km(t.cur_lat, t.cur_lng, s.lat, s.lng) AS km,
           CEIL(fn_distance_km(t.cur_lat, t.cur_lng, s.lat, s.lng) / fn_team_speed_kmh(t.kind) * 60)::INT,
           fn_team_fits(t.kind, s.needs)
      FROM sos_requests s
      JOIN teams t ON t.status = 'available'
     WHERE s.sos_id = p_sos
     ORDER BY fn_team_fits(t.kind, s.needs) DESC,
              (t.capacity >= s.people_count) DESC,
              fn_distance_km(t.cur_lat, t.cur_lng, s.lat, s.lng)
     LIMIT p_limit;
$$;

-- ONE transaction: lock SOS, lock team, check both are free, create the dispatch, update both.
-- Two coordinators clicking "Send" for the same team at the same moment: the second waits for
-- the row lock, then sees status 'dispatched' and gets TEAM_BUSY. Lock order is always SOS -> team.
CREATE OR REPLACE FUNCTION fn_dispatch_team(p_sos INT, p_team INT, p_user INT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    s sos_requests%ROWTYPE;
    t teams%ROWTYPE;
    v_km NUMERIC;
    v_id INT;
BEGIN
    SELECT * INTO s FROM sos_requests WHERE sos_id = p_sos FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: SOS % does not exist', p_sos USING ERRCODE = 'P0001'; END IF;
    IF s.status NOT IN ('new', 'triaged') THEN
        RAISE EXCEPTION 'SOS_NOT_OPEN: % is already %', s.ticket, s.status USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO t FROM teams WHERE team_id = p_team FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: team % does not exist', p_team USING ERRCODE = 'P0001'; END IF;
    IF t.status <> 'available' THEN
        RAISE EXCEPTION 'TEAM_BUSY: % is % - pick another team', t.name, t.status USING ERRCODE = 'P0001';
    END IF;
    IF NOT fn_team_fits(t.kind, s.needs) THEN
        RAISE EXCEPTION 'TEAM_MISMATCH: a % team cannot handle needs %', t.kind, s.needs USING ERRCODE = 'P0001';
    END IF;

    v_km := fn_distance_km(t.cur_lat, t.cur_lng, s.lat, s.lng);
    INSERT INTO dispatches (sos_id, team_id, assigned_by, distance_km, eta_minutes)
    VALUES (p_sos, p_team, p_user, v_km, CEIL(v_km / fn_team_speed_kmh(t.kind) * 60))
    RETURNING dispatch_id INTO v_id;

    UPDATE teams SET status = 'dispatched', incident_id = s.incident_id WHERE team_id = p_team;
    PERFORM fn_set_actor(p_user);
    PERFORM set_config('rahat.note', 'team ' || t.name, TRUE);
    UPDATE sos_requests SET status = 'assigned' WHERE sos_id = p_sos;
    PERFORM set_config('rahat.note', '', TRUE);
    RETURN v_id;
END $$;

-- Auto-dispatch: highest-priority open SOS first, each to the nearest free team that fits.
-- FOR UPDATE SKIP LOCKED lets several coordinators (or a scheduled job) run this in parallel:
-- rows another session is already handling are skipped instead of waited for, so nobody blocks
-- and no team or SOS is ever assigned twice.
CREATE OR REPLACE FUNCTION fn_auto_dispatch(p_incident INT, p_user INT, p_max INT DEFAULT 10)
RETURNS TABLE (ticket VARCHAR, team_name VARCHAR, distance_km NUMERIC, priority INT)
LANGUAGE plpgsql AS $$
DECLARE
    s RECORD;
    t RECORD;
    n INT := 0;
BEGIN
    FOR s IN
        SELECT q.sos_id, q.ticket, q.lat, q.lng, q.needs, q.people_count,
               fn_sos_priority(q.people_count, q.children, q.elderly, q.injured, q.needs, q.created_at) AS prio
          FROM sos_requests q
         WHERE q.incident_id = p_incident AND q.status IN ('new', 'triaged')
         ORDER BY prio DESC, q.created_at
         FOR UPDATE SKIP LOCKED
    LOOP
        EXIT WHEN n >= p_max;
        SELECT tm.team_id, tm.name, fn_distance_km(tm.cur_lat, tm.cur_lng, s.lat, s.lng) AS km
          INTO t
          FROM teams tm
         WHERE tm.status = 'available' AND fn_team_fits(tm.kind, s.needs)
         ORDER BY (tm.capacity >= s.people_count) DESC, fn_distance_km(tm.cur_lat, tm.cur_lng, s.lat, s.lng)
         LIMIT 1
         FOR UPDATE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;               -- no free team for this kind of need right now
        PERFORM fn_dispatch_team(s.sos_id, t.team_id, p_user);
        n := n + 1;
        ticket := s.ticket; team_name := t.name; distance_km := t.km; priority := s.prio;
        RETURN NEXT;
    END LOOP;
END $$;

-- Team lead updates the job: assigned -> en_route -> on_scene -> completed (or aborted any time before)
CREATE OR REPLACE FUNCTION fn_update_dispatch(
    p_dispatch INT, p_status dispatch_status, p_user INT,
    p_people_rescued INT DEFAULT NULL, p_note TEXT DEFAULT NULL,
    p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    d dispatches%ROWTYPE;
    v_ok BOOLEAN;
BEGIN
    SELECT * INTO d FROM dispatches WHERE dispatch_id = p_dispatch FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: dispatch % does not exist', p_dispatch USING ERRCODE = 'P0001'; END IF;
    PERFORM 1 FROM sos_requests WHERE sos_id = d.sos_id FOR UPDATE;      -- same lock order as dispatch: SOS -> team
    PERFORM 1 FROM teams WHERE team_id = d.team_id FOR UPDATE;

    v_ok := (d.status, p_status) IN (('assigned', 'en_route'), ('en_route', 'on_scene'), ('on_scene', 'completed'),
                                     ('assigned', 'aborted'), ('en_route', 'aborted'), ('on_scene', 'aborted'));
    IF NOT v_ok THEN
        RAISE EXCEPTION 'BAD_TRANSITION: a dispatch cannot go from % to %', d.status, p_status USING ERRCODE = 'P0001';
    END IF;
    IF p_status = 'completed' AND p_people_rescued IS NULL THEN
        RAISE EXCEPTION 'RESCUED_REQUIRED: enter how many people were rescued or helped (0 if none)' USING ERRCODE = 'P0001';
    END IF;

    PERFORM fn_set_actor(p_user);
    PERFORM set_config('rahat.note', COALESCE(p_note, ''), TRUE);
    UPDATE dispatches
       SET status = p_status,
           en_route_at = CASE WHEN p_status = 'en_route' THEN now() ELSE en_route_at END,
           on_scene_at = CASE WHEN p_status = 'on_scene' THEN now() ELSE on_scene_at END,
           finished_at = CASE WHEN p_status IN ('completed', 'aborted') THEN now() ELSE finished_at END,
           people_rescued = CASE WHEN p_status = 'completed' THEN p_people_rescued ELSE people_rescued END,
           notes = COALESCE(p_note, notes)
     WHERE dispatch_id = p_dispatch;

    UPDATE teams
       SET status = CASE p_status WHEN 'on_scene' THEN 'on_scene'::team_status
                                  WHEN 'completed' THEN 'available' WHEN 'aborted' THEN 'available'
                                  ELSE status END,
           cur_lat = COALESCE(p_lat, cur_lat), cur_lng = COALESCE(p_lng, cur_lng), last_seen_at = now()
     WHERE team_id = d.team_id;

    IF p_status = 'on_scene' THEN
        UPDATE sos_requests SET status = 'in_progress' WHERE sos_id = d.sos_id;
    ELSIF p_status = 'completed' THEN
        UPDATE sos_requests SET status = CASE WHEN status = 'assigned' THEN 'in_progress'::sos_status ELSE status END
         WHERE sos_id = d.sos_id;
        UPDATE sos_requests SET status = 'resolved' WHERE sos_id = d.sos_id;
    ELSIF p_status = 'aborted' THEN
        UPDATE sos_requests SET status = 'triaged' WHERE sos_id = d.sos_id;   -- back in the queue for another team
    END IF;
    PERFORM set_config('rahat.note', '', TRUE);
END $$;

-- =====================================================================
-- Camps: automatic depot, capacity, occupancy
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_camp_create_depot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO depots (name, kind, camp_id, lat, lng) VALUES ('Camp store - ' || NEW.name, 'camp', NEW.camp_id, NEW.lat, NEW.lng);
    RETURN NULL;
END $$;
CREATE TRIGGER trg_camp_depot AFTER INSERT ON camps FOR EACH ROW EXECUTE FUNCTION trg_camp_create_depot();

-- before a check-in: lock the camp row (serialises concurrent check-ins) and refuse if full,
-- suggesting the nearest camp of the same incident that still has space
CREATE OR REPLACE FUNCTION trg_stay_before_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    c camps%ROWTYPE;
    alt RECORD;
BEGIN
    SELECT * INTO c FROM camps WHERE camp_id = NEW.camp_id FOR UPDATE;
    IF c.status = 'closed' THEN
        RAISE EXCEPTION 'CAMP_CLOSED: % is closed', c.name USING ERRCODE = 'P0001';
    END IF;
    IF c.occupancy >= c.capacity THEN
        SELECT o.name, o.capacity - o.occupancy AS free, fn_distance_km(c.lat, c.lng, o.lat, o.lng) AS km
          INTO alt
          FROM camps o
         WHERE o.incident_id = c.incident_id AND o.status = 'open' AND o.occupancy < o.capacity AND o.camp_id <> c.camp_id
         ORDER BY fn_distance_km(c.lat, c.lng, o.lat, o.lng) LIMIT 1;
        RAISE EXCEPTION 'CAMP_FULL: % is full (% / %).%', c.name, c.occupancy, c.capacity,
            CASE WHEN alt.name IS NOT NULL THEN format(' Nearest camp with space: %s (%s places, %s km).', alt.name, alt.free, ROUND(alt.km, 1)) ELSE '' END
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_stay_capacity BEFORE INSERT ON camp_stays FOR EACH ROW EXECUTE FUNCTION trg_stay_before_insert();

-- keep camps.occupancy and status in step with open stays; raise near-full alerts
CREATE OR REPLACE FUNCTION trg_stay_after() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_camp INT := COALESCE(NEW.camp_id, OLD.camp_id);
    v_delta INT := 0;
    c camps%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.checked_out_at IS NULL THEN
        v_delta := 1;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.camp_id <> OLD.camp_id OR NEW.person_id <> OLD.person_id OR NEW.checked_in_at <> OLD.checked_in_at THEN
            RAISE EXCEPTION 'IMMUTABLE_STAY: check out and check in again to move a person' USING ERRCODE = 'P0001';
        END IF;
        IF OLD.checked_out_at IS NULL AND NEW.checked_out_at IS NOT NULL THEN v_delta := -1;
        ELSIF OLD.checked_out_at IS NOT NULL AND NEW.checked_out_at IS NULL THEN
            RAISE EXCEPTION 'IMMUTABLE_STAY: a check-out cannot be undone; check the person in again' USING ERRCODE = 'P0001';
        END IF;
    ELSIF TG_OP = 'DELETE' AND OLD.checked_out_at IS NULL THEN
        v_delta := -1;
    END IF;
    IF v_delta = 0 THEN RETURN NULL; END IF;

    UPDATE camps
       SET occupancy = occupancy + v_delta,
           status = CASE WHEN status = 'closed' THEN status
                         WHEN occupancy + v_delta >= capacity THEN 'full'::camp_status
                         ELSE 'open'::camp_status END
     WHERE camp_id = v_camp
    RETURNING * INTO c;

    IF c.occupancy >= c.capacity THEN
        PERFORM fn_raise_alert(c.incident_id, 'camp_full', 'critical',
            format('%s is FULL (%s/%s). New arrivals must go to another camp.', c.name, c.occupancy, c.capacity),
            'camp_cap:' || c.camp_id, '/camps/' || c.camp_id);
    ELSIF c.occupancy >= 0.9 * c.capacity THEN
        PERFORM fn_raise_alert(c.incident_id, 'camp_near_full', 'warning',
            format('%s is %s%% full (%s/%s).', c.name, ROUND(100.0 * c.occupancy / c.capacity), c.occupancy, c.capacity),
            'camp_cap:' || c.camp_id, '/camps/' || c.camp_id);
    ELSE
        PERFORM fn_resolve_alert('camp_cap:' || c.camp_id);
    END IF;
    -- more (or fewer) mouths to feed changes how long the camp's stock lasts
    PERFORM fn_check_supply((SELECT depot_id FROM depots WHERE camp_id = c.camp_id));
    RETURN NULL;
END $$;

-- =====================================================================
-- Stock: every change is a movement; the trigger applies it under a row lock
-- =====================================================================

-- days of supply for a camp depot = stock / (people in camp x daily norm)
CREATE OR REPLACE FUNCTION fn_check_supply(p_depot INT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
    IF p_depot IS NULL THEN RETURN; END IF;
    FOR r IN
        SELECT c.incident_id, c.camp_id, c.name AS camp, c.occupancy, res.resource_id, res.name AS resource, res.unit,
               COALESCE(st.quantity, 0) AS qty,
               COALESCE(st.quantity, 0) / NULLIF(c.occupancy * res.per_person_per_day, 0) AS days
          FROM depots d
          JOIN camps c ON c.camp_id = d.camp_id
          CROSS JOIN resources res
          LEFT JOIN stock st ON st.depot_id = d.depot_id AND st.resource_id = res.resource_id
         WHERE d.depot_id = p_depot AND res.critical AND res.per_person_per_day > 0
    LOOP
        IF r.occupancy > 0 AND r.days < 1.5 THEN
            PERFORM fn_raise_alert(r.incident_id, 'low_supply', CASE WHEN r.days < 0.5 THEN 'critical' ELSE 'warning' END::alert_severity,
                format('%s: %s for %s day(s) only (%s %s for %s people).', r.camp, r.resource, ROUND(r.days, 1), r.qty, r.unit, r.occupancy),
                format('low_supply:%s:%s', p_depot, r.resource_id), '/camps/' || r.camp_id);
        ELSE
            PERFORM fn_resolve_alert(format('low_supply:%s:%s', p_depot, r.resource_id));
        END IF;
    END LOOP;
END $$;

-- trigger on camp_stays is created here because it calls fn_check_supply
CREATE TRIGGER trg_stay_occupancy AFTER INSERT OR UPDATE OR DELETE ON camp_stays
    FOR EACH ROW EXECUTE FUNCTION trg_stay_after();

CREATE OR REPLACE FUNCTION trg_movement_apply() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_have NUMERIC;
    v_res  resources%ROWTYPE;
    v_dep  depots%ROWTYPE;
BEGIN
    INSERT INTO stock (depot_id, resource_id, quantity) VALUES (NEW.depot_id, NEW.resource_id, 0)
    ON CONFLICT (depot_id, resource_id) DO NOTHING;
    SELECT quantity INTO v_have FROM stock WHERE depot_id = NEW.depot_id AND resource_id = NEW.resource_id FOR UPDATE;
    IF v_have + NEW.qty_change < 0 THEN
        SELECT * INTO v_res FROM resources WHERE resource_id = NEW.resource_id;
        SELECT * INTO v_dep FROM depots WHERE depot_id = NEW.depot_id;
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: % has only % % of %', v_dep.name, v_have, v_res.unit, v_res.name
            USING ERRCODE = 'P0001';
    END IF;
    UPDATE stock SET quantity = quantity + NEW.qty_change, updated_at = now()
     WHERE depot_id = NEW.depot_id AND resource_id = NEW.resource_id;
    PERFORM fn_check_supply(NEW.depot_id);
    RETURN NULL;
END $$;
CREATE TRIGGER trg_movement_stock AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION trg_movement_apply();

-- send supplies from one depot to another: stock leaves now, arrives when received
CREATE OR REPLACE FUNCTION fn_create_transfer(p_from INT, p_to INT, p_items JSONB, p_user INT, p_vehicle TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    v_id INT;
    it RECORD;
BEGIN
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_TRANSFER: add at least one item' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO transfers (from_depot, to_depot, created_by, vehicle) VALUES (p_from, p_to, p_user, NULLIF(trim(p_vehicle), ''))
    RETURNING transfer_id INTO v_id;
    -- items in resource_id order: concurrent transfers lock stock rows in the same order (no deadlock)
    FOR it IN
        SELECT (e->>'resource_id')::INT AS resource_id, SUM((e->>'quantity')::NUMERIC) AS qty
          FROM jsonb_array_elements(p_items) e
         GROUP BY 1 ORDER BY 1
    LOOP
        INSERT INTO transfer_items (transfer_id, resource_id, quantity) VALUES (v_id, it.resource_id, it.qty);
        INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, transfer_id, created_by)
        VALUES (p_from, it.resource_id, -it.qty, 'transfer_out', v_id, p_user);
    END LOOP;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_close_transfer(p_transfer INT, p_user INT, p_receive BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    t transfers%ROWTYPE;
BEGIN
    SELECT * INTO t FROM transfers WHERE transfer_id = p_transfer FOR UPDATE;     -- receiving twice is impossible
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: transfer % does not exist', p_transfer USING ERRCODE = 'P0001'; END IF;
    IF t.status <> 'in_transit' THEN
        RAISE EXCEPTION 'TRANSFER_CLOSED: % is already %', t.code, t.status USING ERRCODE = 'P0001';
    END IF;
    -- received: stock enters the destination. cancelled: it goes back to the source.
    INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, transfer_id, created_by, note)
    SELECT CASE WHEN p_receive THEN t.to_depot ELSE t.from_depot END, ti.resource_id, ti.quantity,
           'transfer_in', t.transfer_id, p_user, CASE WHEN p_receive THEN NULL ELSE 'returned: transfer cancelled' END
      FROM transfer_items ti WHERE ti.transfer_id = p_transfer ORDER BY ti.resource_id;
    UPDATE transfers SET status = CASE WHEN p_receive THEN 'received'::transfer_status ELSE 'cancelled' END,
                         closed_by = p_user, closed_at = now()
     WHERE transfer_id = p_transfer;
END $$;

-- =====================================================================
-- People, camps and missing-person matching
-- =====================================================================

-- score how well a camp resident matches a missing-person report (0..1)
CREATE OR REPLACE FUNCTION fn_match_score(
    p_name_a TEXT, p_name_b TEXT, p_emb_a vector, p_emb_b vector,
    p_age_a INT, p_age_b INT, p_gender_a gender_type, p_gender_b gender_type
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
    SELECT ROUND((
          0.45 * similarity(lower(p_name_a), lower(p_name_b))
        + 0.30 * COALESCE(1 - (p_emb_a <=> p_emb_b), 0)
        + 0.15 * CASE WHEN p_age_a IS NULL OR p_age_b IS NULL THEN 0.5
                      ELSE GREATEST(0, 1 - abs(p_age_a - p_age_b) / 10.0) END
        + 0.10 * CASE WHEN p_gender_a = 'unknown' OR p_gender_b = 'unknown' THEN 0.5
                      WHEN p_gender_a = p_gender_b THEN 1 ELSE 0 END
    )::NUMERIC, 3);
$$;

-- candidates for one report: top-20 by name (trigram KNN on the GiST index) UNION top-20 by
-- meaning (HNSW vector index), then re-scored with fn_match_score. Different gender is excluded.
CREATE OR REPLACE FUNCTION fn_match_missing(p_report INT, p_limit INT DEFAULT 5)
RETURNS TABLE (person_id INT, full_name VARCHAR, age SMALLINT, gender gender_type, home_village VARCHAR,
               camp_name VARCHAR, camp_id INT, name_similarity NUMERIC, text_similarity NUMERIC, score NUMERIC)
LANGUAGE sql STABLE AS $$
    WITH r AS (SELECT * FROM missing_reports WHERE report_id = p_report),
    cand AS (
        (SELECT p.person_id FROM people p, r ORDER BY p.full_name <-> r.full_name LIMIT 20)
        UNION
        (SELECT p.person_id FROM people p, r WHERE r.embedding IS NOT NULL AND p.embedding IS NOT NULL
          ORDER BY p.embedding <=> r.embedding LIMIT 20)
    )
    SELECT p.person_id, p.full_name, p.age, p.gender, p.home_village, c.name, c.camp_id,
           ROUND(similarity(lower(p.full_name), lower(r.full_name))::NUMERIC, 3),
           CASE WHEN p.embedding IS NOT NULL AND r.embedding IS NOT NULL
                THEN ROUND((1 - (p.embedding <=> r.embedding))::NUMERIC, 3) END,
           fn_match_score(r.full_name, p.full_name, r.embedding, p.embedding, r.age, p.age, r.gender, p.gender) AS score
      FROM cand
      JOIN people p USING (person_id)
      CROSS JOIN r
      LEFT JOIN camp_stays cs ON cs.person_id = p.person_id AND cs.checked_out_at IS NULL
      LEFT JOIN camps c ON c.camp_id = cs.camp_id
     WHERE NOT (p.gender <> 'unknown' AND r.gender <> 'unknown' AND p.gender <> r.gender)
     ORDER BY score DESC
     LIMIT p_limit;
$$;

-- register an evacuee and check them into a camp in one transaction; then look for open
-- missing-person reports that might be this person and raise an alert for each strong match
CREATE OR REPLACE FUNCTION fn_register_evacuee(
    p_camp INT, p_name TEXT, p_age INT, p_gender gender_type, p_phone TEXT, p_village TEXT,
    p_marks TEXT, p_medical BOOLEAN, p_sos INT, p_embedding vector, p_user INT
) RETURNS TABLE (person_id INT, stay_id INT, possible_matches INT)
LANGUAGE plpgsql AS $$
DECLARE
    v_person INT;
    v_stay INT;
    v_n INT := 0;
    m RECORD;
BEGIN
    INSERT INTO people (full_name, age, gender, phone, home_village, marks, needs_medical, rescued_from, embedding, registered_by)
    VALUES (trim(p_name), p_age, COALESCE(p_gender, 'unknown'), NULLIF(p_phone, ''), NULLIF(trim(p_village), ''),
            NULLIF(trim(p_marks), ''), COALESCE(p_medical, FALSE), p_sos, p_embedding, p_user)
    RETURNING people.person_id INTO v_person;

    INSERT INTO camp_stays (person_id, camp_id) VALUES (v_person, p_camp)      -- capacity trigger runs here
    RETURNING camp_stays.stay_id INTO v_stay;

    FOR m IN
        SELECT mr.report_id, mr.ticket, mr.incident_id, mr.full_name,
               fn_match_score(mr.full_name, trim(p_name), mr.embedding, p_embedding, mr.age, p_age,
                              mr.gender, COALESCE(p_gender, 'unknown')) AS score
          FROM missing_reports mr
         WHERE mr.status = 'open'
           AND (mr.full_name % trim(p_name)                                   -- trigram match (GIN index)
                OR (p_embedding IS NOT NULL AND mr.embedding <=> p_embedding < 0.35))
    LOOP
        IF m.score >= 0.60 THEN
            v_n := v_n + 1;
            PERFORM fn_raise_alert(m.incident_id, 'missing_match', 'warning',
                format('Possible match for missing report %s (%s): %s just registered (score %s).', m.ticket, m.full_name, trim(p_name), m.score),
                format('missing_match:%s:%s', m.report_id, v_person), '/missing?report=' || m.report_id);
        END IF;
    END LOOP;

    person_id := v_person; stay_id := v_stay; possible_matches := v_n;
    RETURN NEXT;
END $$;

CREATE OR REPLACE PROCEDURE sp_check_out(p_stay INT, p_reason TEXT) LANGUAGE plpgsql AS $$
BEGIN
    UPDATE camp_stays SET checked_out_at = now(), checkout_reason = p_reason
     WHERE stay_id = p_stay AND checked_out_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_IN_CAMP: this person is not checked in' USING ERRCODE = 'P0001';
    END IF;
END $$;

-- a coordinator confirms that a camp resident is the missing person
CREATE OR REPLACE PROCEDURE sp_confirm_match(p_report INT, p_person INT, p_user INT) LANGUAGE plpgsql AS $$
DECLARE r missing_reports%ROWTYPE;
BEGIN
    SELECT * INTO r FROM missing_reports WHERE report_id = p_report FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: report % does not exist', p_report USING ERRCODE = 'P0001'; END IF;
    IF r.status <> 'open' THEN
        RAISE EXCEPTION 'ALREADY_MATCHED: % is already %', r.ticket, r.status USING ERRCODE = 'P0001';
    END IF;
    UPDATE missing_reports SET status = 'matched', matched_person_id = p_person, matched_by = p_user, matched_at = now()
     WHERE report_id = p_report;
    UPDATE alerts SET resolved_at = now() WHERE dedupe_key LIKE 'missing_match:' || p_report || ':%' AND resolved_at IS NULL;
END $$;

-- =====================================================================
-- Dashboard refresh (run from the Reports page, or by a scheduler every few minutes)
-- =====================================================================
CREATE OR REPLACE PROCEDURE sp_refresh_dashboard() LANGUAGE plpgsql AS $$
DECLARE s RECORD;
BEGIN
    -- SOS waiting more than 30 minutes without a team
    FOR s IN
        SELECT q.sos_id, q.ticket, q.incident_id, q.people_count,
               ROUND(EXTRACT(EPOCH FROM now() - q.created_at) / 60) AS mins
          FROM sos_requests q
         WHERE q.status IN ('new', 'triaged') AND q.created_at < now() - INTERVAL '30 minutes'
    LOOP
        PERFORM fn_raise_alert(s.incident_id, 'sos_unassigned', CASE WHEN s.mins > 120 THEN 'critical' ELSE 'warning' END::alert_severity,
            format('%s (%s people) has waited %s min without a team.', s.ticket, s.people_count, s.mins),
            'sos_unassigned:' || s.sos_id, '/sos?open=' || s.sos_id);
    END LOOP;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sitrep;
END $$;
