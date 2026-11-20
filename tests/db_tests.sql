-- =====================================================================
-- RAHAT : database tests.  Everything runs inside one transaction and is
-- ROLLED BACK at the end, so it is safe to run on the demo database.
--   npm run db:test        (or: psql -f tests/db_tests.sql)
-- Each test prints PASS or FAIL.
-- =====================================================================
BEGIN;

CREATE FUNCTION pg_temp.ok(name TEXT, cond BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE '%  %', CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END, name;
END $$;

-- a 384-d unit vector pointing mostly along axis k (cosine similarity between vec(k,a) and vec(k,b) is high)
CREATE FUNCTION pg_temp.vec(k INT, noise_axis INT DEFAULT 0, noise REAL DEFAULT 0) RETURNS vector LANGUAGE sql AS $$
    SELECT ('[' || string_agg(CASE WHEN i = k THEN '1' WHEN i = noise_axis THEN noise::TEXT ELSE '0' END, ',' ORDER BY i) || ']')::vector
      FROM generate_series(1, 384) i;
$$;

-- fixture ids, looked up by name in the tests
CREATE TEMP TABLE fx (k TEXT PRIMARY KEY, v INT);
CREATE FUNCTION pg_temp.id(key TEXT) RETURNS INT LANGUAGE sql AS $$ SELECT v FROM fx WHERE k = key $$;

DO $$
DECLARE v INT;
BEGIN
    INSERT INTO incidents (code, name, disaster_type, severity, center_lat, center_lng, radius_km)
    VALUES ('INC-2099-001', 'Test flood', 'flood', 3, 12.9000, 77.6000, 20) RETURNING incident_id INTO v;
    INSERT INTO fx VALUES ('inc', v);
    INSERT INTO users (name, phone, password_hash, role) VALUES ('Test coord', '6999999901', 'x', 'coordinator') RETURNING user_id INTO v;
    INSERT INTO fx VALUES ('coord', v);
    INSERT INTO teams (name, kind, members, capacity, base_lat, base_lng, cur_lat, cur_lng)
    VALUES ('T Boat', 'boat', 5, 10, 12.9000, 77.6000, 12.9000, 77.6000) RETURNING team_id INTO v;
    INSERT INTO fx VALUES ('boat', v);
    INSERT INTO teams (name, kind, members, capacity, base_lat, base_lng, cur_lat, cur_lng)
    VALUES ('T Supply', 'supply', 3, 2, 12.9100, 77.6100, 12.9100, 77.6100) RETURNING team_id INTO v;
    INSERT INTO fx VALUES ('supply', v);
    INSERT INTO camps (incident_id, name, kind, lat, lng, capacity) VALUES (pg_temp.id('inc'), 'T Small Camp', 'school', 12.9050, 77.6050, 2)
    RETURNING camp_id INTO v;
    INSERT INTO fx VALUES ('camp', v);
    INSERT INTO camps (incident_id, name, kind, lat, lng, capacity) VALUES (pg_temp.id('inc'), 'T Big Camp', 'stadium', 12.9200, 77.6200, 100)
    RETURNING camp_id INTO v;
    INSERT INTO fx VALUES ('camp2', v);
    INSERT INTO fx SELECT 'campdepot', depot_id FROM depots WHERE camp_id = pg_temp.id('camp');
    INSERT INTO depots (name, kind, lat, lng) VALUES ('T Warehouse', 'warehouse', 12.9, 77.6) RETURNING depot_id INTO v;
    INSERT INTO fx VALUES ('wh', v);
    INSERT INTO resources (name, unit, category, per_person_per_day, critical) VALUES ('T Water', 'litre', 'water', 3, TRUE)
    RETURNING resource_id INTO v;
    INSERT INTO fx VALUES ('water', v);
END $$;

-- ---------------------------------------------------------------- constraints
DO $$ BEGIN
    INSERT INTO sos_requests (incident_id, reporter_name, reporter_phone, lat, lng, description, people_count, needs)
    VALUES (pg_temp.id('inc'), 'Test', '9876543210', 51.5, -0.1, 'stuck in water', 2, '{rescue}');
    PERFORM pg_temp.ok('T01 location outside India is rejected (CHECK)', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T01 location outside India is rejected (CHECK)', TRUE); END $$;

DO $$ BEGIN
    INSERT INTO sos_requests (incident_id, reporter_name, reporter_phone, lat, lng, description, people_count, children, elderly, needs)
    VALUES (pg_temp.id('inc'), 'Test', '9876543210', 12.9, 77.6, 'stuck in water', 3, 2, 2, '{rescue}');
    PERFORM pg_temp.ok('T02 children + elderly cannot exceed people_count', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T02 children + elderly cannot exceed people_count', SQLERRM LIKE '%chk_sos_groups%'); END $$;

DO $$ BEGIN
    INSERT INTO sos_requests (incident_id, reporter_name, reporter_phone, lat, lng, description, people_count, needs)
    VALUES (pg_temp.id('inc'), 'Test', '9876543210', 12.9, 77.6, 'stuck in water', 2, '{}');
    PERFORM pg_temp.ok('T03 an SOS needs at least one need', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T03 an SOS needs at least one need', TRUE); END $$;

DO $$ BEGIN
    INSERT INTO sos_requests (incident_id, reporter_name, reporter_phone, lat, lng, description, people_count, needs)
    VALUES (pg_temp.id('inc'), 'Test', '12345', 12.9, 77.6, 'stuck in water', 2, '{rescue}');
    PERFORM pg_temp.ok('T04 phone must be a 10-digit Indian mobile', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T04 phone must be a 10-digit Indian mobile', TRUE); END $$;

-- ---------------------------------------------------------------- SOS creation + duplicates
DO $$ BEGIN
    PERFORM fn_create_sos(pg_temp.id('inc'), 'Far Away', '9876500000', 13.9, 77.6, NULL, 'stuck in water', 2, 0, 0, 0,
                          '{rescue}', 'web', NULL);
    PERFORM pg_temp.ok('T05 SOS far outside the incident area is refused', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T05 SOS far outside the incident area is refused', SQLERRM LIKE 'OUTSIDE_AREA%'); END $$;

DO $$
DECLARE r RECORD;
BEGIN
    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Asha', '9876500001', 12.9000, 77.6000, 'near temple',
                                       'Family of four on the roof, water rising', 4, 1, 1, 0, '{rescue}', 'web', pg_temp.vec(1));
    INSERT INTO fx VALUES ('sos1', r.sos_id);
    PERFORM pg_temp.ok('T06 fn_create_sos returns a ticket and writes history',
        r.ticket ~ '^SOS-[0-9]{6}$' AND r.suspected_dup_of IS NULL
        AND EXISTS (SELECT 1 FROM sos_status_history WHERE sos_id = r.sos_id AND to_status = 'new'));

    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Asha', '9876500001', 12.9020, 77.6000, NULL,
                                       'calling again please hurry', 4, 0, 0, 0, '{rescue}', 'helpline', NULL);
    INSERT INTO fx VALUES ('sos_dup_phone', r.sos_id);
    PERFORM pg_temp.ok('T07 same phone within 1 km is flagged as a suspected duplicate',
        r.suspected_dup_of = pg_temp.id('sos1') AND r.dup_reason = 'same phone number');

    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Ravi', '9876500002', 12.9450, 77.6000, NULL,
                                       'Family of four on the roof, water rising', 4, 0, 0, 0, '{rescue}', 'web', pg_temp.vec(1));
    PERFORM pg_temp.ok('T08 a similar text 5 km away is NOT a duplicate', r.suspected_dup_of IS NULL);

    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Neighbour', '9876500003', 12.9050, 77.6000, NULL,
                                       'ಮನೆಯ ಮೇಲ್ಛಾವಣಿಯಲ್ಲಿ ನಾಲ್ವರು', 4, 0, 0, 0, '{rescue}', 'web', pg_temp.vec(1, 2, 0.2));
    PERFORM pg_temp.ok('T09 different phone, 550 m away, similar meaning (vector) is flagged',
        r.suspected_dup_of = pg_temp.id('sos1') AND r.dup_reason = 'very similar description');
END $$;

DO $$ BEGIN
    UPDATE sos_requests SET description = 'changed later' WHERE sos_id = pg_temp.id('sos1');
    PERFORM pg_temp.ok('T10 the original report text cannot be edited', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T10 the original report text cannot be edited', SQLERRM LIKE 'IMMUTABLE_REPORT%'); END $$;

DO $$ BEGIN
    UPDATE sos_requests SET status = 'resolved' WHERE sos_id = pg_temp.id('sos1');
    PERFORM pg_temp.ok('T11 new -> resolved is not an allowed transition', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T11 new -> resolved is not an allowed transition', SQLERRM LIKE 'BAD_TRANSITION%'); END $$;

-- ---------------------------------------------------------------- dispatch
DO $$ BEGIN
    PERFORM pg_temp.ok('T12 suggested teams list a fitting team first',
        (SELECT team_id FROM fn_suggest_teams(pg_temp.id('sos1')) LIMIT 1) = pg_temp.id('boat')
        AND (SELECT fits FROM fn_suggest_teams(pg_temp.id('sos1'), 100) WHERE team_id = pg_temp.id('supply')) = FALSE);
END $$;

DO $$ BEGIN
    PERFORM fn_dispatch_team(pg_temp.id('sos1'), pg_temp.id('supply'), pg_temp.id('coord'));
    PERFORM pg_temp.ok('T13 a supply truck cannot be sent to a rescue-only SOS', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T13 a supply truck cannot be sent to a rescue-only SOS', SQLERRM LIKE 'TEAM_MISMATCH%'); END $$;

DO $$
DECLARE v INT;
BEGIN
    v := fn_dispatch_team(pg_temp.id('sos1'), pg_temp.id('boat'), pg_temp.id('coord'));
    INSERT INTO fx VALUES ('disp1', v);
    PERFORM pg_temp.ok('T14 dispatch: team dispatched, SOS assigned, history records who did it',
        (SELECT status FROM teams WHERE team_id = pg_temp.id('boat')) = 'dispatched'
        AND (SELECT status FROM sos_requests WHERE sos_id = pg_temp.id('sos1')) = 'assigned'
        AND (SELECT changed_by FROM sos_status_history WHERE sos_id = pg_temp.id('sos1') AND to_status = 'assigned') = pg_temp.id('coord'));
END $$;

DO $$ BEGIN
    PERFORM fn_dispatch_team(pg_temp.id('sos_dup_phone'), pg_temp.id('boat'), pg_temp.id('coord'));
    PERFORM pg_temp.ok('T15 a busy team cannot be dispatched again', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T15 a busy team cannot be dispatched again', SQLERRM LIKE 'TEAM_BUSY%'); END $$;

DO $$ BEGIN
    PERFORM fn_dispatch_team(pg_temp.id('sos1'), pg_temp.id('supply'), pg_temp.id('coord'));
    PERFORM pg_temp.ok('T16 an already-assigned SOS cannot get a second team', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T16 an already-assigned SOS cannot get a second team', SQLERRM LIKE 'SOS_NOT_OPEN%'); END $$;

DO $$ BEGIN
    INSERT INTO dispatches (sos_id, team_id, distance_km, eta_minutes) VALUES (pg_temp.id('sos_dup_phone'), pg_temp.id('boat'), 1, 5);
    PERFORM pg_temp.ok('T17 partial unique index: one live job per team even with a direct INSERT', FALSE);
EXCEPTION WHEN unique_violation THEN PERFORM pg_temp.ok('T17 partial unique index: one live job per team even with a direct INSERT', TRUE); END $$;

DO $$ BEGIN
    PERFORM fn_update_dispatch(pg_temp.id('disp1'), 'completed', pg_temp.id('coord'), 4);
    PERFORM pg_temp.ok('T18 a dispatch cannot jump from assigned to completed', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T18 a dispatch cannot jump from assigned to completed', SQLERRM LIKE 'BAD_TRANSITION%'); END $$;

DO $$ BEGIN
    PERFORM fn_update_dispatch(pg_temp.id('disp1'), 'en_route', pg_temp.id('coord'));
    PERFORM fn_update_dispatch(pg_temp.id('disp1'), 'on_scene', pg_temp.id('coord'), NULL, NULL, 12.9001, 77.6001);
    BEGIN
        PERFORM fn_update_dispatch(pg_temp.id('disp1'), 'completed', pg_temp.id('coord'));
        PERFORM pg_temp.ok('T19 completing a job requires the number of people rescued', FALSE);
    EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T19 completing a job requires the number of people rescued', SQLERRM LIKE 'RESCUED_REQUIRED%'); END;
    PERFORM fn_update_dispatch(pg_temp.id('disp1'), 'completed', pg_temp.id('coord'), 4, 'all four safe');
    PERFORM pg_temp.ok('T20 full job: team free again at its new position, SOS resolved, 4 history rows',
        (SELECT status FROM teams WHERE team_id = pg_temp.id('boat')) = 'available'
        AND (SELECT cur_lat FROM teams WHERE team_id = pg_temp.id('boat')) = 12.9001
        AND (SELECT status FROM sos_requests WHERE sos_id = pg_temp.id('sos1')) = 'resolved'
        AND (SELECT COUNT(*) FROM sos_status_history WHERE sos_id = pg_temp.id('sos1')) = 4);
END $$;

DO $$
DECLARE v INT;
BEGIN
    v := fn_dispatch_team(pg_temp.id('sos_dup_phone'), pg_temp.id('boat'), pg_temp.id('coord'));
    PERFORM fn_update_dispatch(v, 'aborted', pg_temp.id('coord'), NULL, 'boat engine failed');
    PERFORM pg_temp.ok('T21 aborting puts the SOS back in the queue and frees the team',
        (SELECT status FROM sos_requests WHERE sos_id = pg_temp.id('sos_dup_phone')) = 'triaged'
        AND (SELECT status FROM teams WHERE team_id = pg_temp.id('boat')) = 'available');
END $$;

DO $$ BEGIN
    UPDATE sos_status_history SET note = 'x' WHERE sos_id = pg_temp.id('sos1');
    PERFORM pg_temp.ok('T22 SOS history is append-only', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T22 SOS history is append-only', SQLERRM LIKE 'APPEND_ONLY%'); END $$;

DO $$
DECLARE r RECORD; ok1 BOOLEAN;
BEGIN
    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Original', '9876500010', 12.8800, 77.6000, NULL,
                                       'two people stuck', 2, 0, 0, 0, '{rescue}', 'web', NULL);
    INSERT INTO fx VALUES ('orig', r.sos_id);
    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Original', '9876500010', 12.8801, 77.6000, NULL,
                                       'two people stuck, again', 2, 0, 0, 0, '{rescue}', 'web', NULL);
    CALL sp_merge_duplicate(r.sos_id, pg_temp.id('orig'), pg_temp.id('coord'));
    ok1 := (SELECT status = 'duplicate' AND duplicate_of = pg_temp.id('orig') FROM sos_requests WHERE sos_id = r.sos_id);
    BEGIN
        CALL sp_merge_duplicate(pg_temp.id('orig'), pg_temp.id('orig'), pg_temp.id('coord'));
        PERFORM pg_temp.ok('T23 merge marks the duplicate; merging into itself is refused', FALSE);
    EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T23 merge marks the duplicate; merging into itself is refused', ok1); END;
END $$;

DO $$
DECLARE r RECORD; a RECORD;
BEGIN
    -- only the boat is free for rescue; an injured group must be served before a bigger uninjured one
    UPDATE sos_requests SET status = 'cancelled' WHERE incident_id = pg_temp.id('inc') AND status IN ('new', 'triaged');
    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Big group', '9876500020', 12.8700, 77.5900, NULL,
                                       'six people waiting', 6, 0, 0, 0, '{rescue}', 'web', NULL);
    SELECT * INTO r FROM fn_create_sos(pg_temp.id('inc'), 'Injured', '9876500021', 12.8600, 77.5900, NULL,
                                       'two injured after wall collapse', 3, 0, 1, 2, '{rescue,medical}', 'web', NULL);
    SELECT * INTO a FROM fn_auto_dispatch(pg_temp.id('inc'), pg_temp.id('coord'), 1);
    PERFORM pg_temp.ok('T24 auto-dispatch serves the highest-priority (injured) SOS first', a.ticket = r.ticket);
    PERFORM pg_temp.ok('T25 v_sos_queue ranks by priority within the incident',
        (SELECT ticket FROM v_sos_queue WHERE incident_id = pg_temp.id('inc') ORDER BY queue_rank LIMIT 1) = r.ticket);
END $$;

-- ---------------------------------------------------------------- camps
DO $$
DECLARE r RECORD; v_stay INT;
BEGIN
    SELECT * INTO r FROM fn_register_evacuee(pg_temp.id('camp'), 'Person One', 30, 'male', NULL, 'X', NULL, FALSE, NULL, NULL, pg_temp.id('coord'));
    v_stay := r.stay_id;
    INSERT INTO fx VALUES ('stay1', v_stay), ('person1', r.person_id);
    SELECT * INTO r FROM fn_register_evacuee(pg_temp.id('camp'), 'Person Two', 31, 'female', NULL, 'X', NULL, FALSE, NULL, NULL, pg_temp.id('coord'));
    PERFORM pg_temp.ok('T26 occupancy is counted by trigger and the camp turns FULL',
        (SELECT occupancy = 2 AND status = 'full' FROM camps WHERE camp_id = pg_temp.id('camp')));
    BEGIN
        PERFORM fn_register_evacuee(pg_temp.id('camp'), 'Person Three', 32, 'male', NULL, 'X', NULL, FALSE, NULL, NULL, pg_temp.id('coord'));
        PERFORM pg_temp.ok('T27 a full camp refuses check-in and names the nearest camp with space', FALSE);
    EXCEPTION WHEN raise_exception THEN
        PERFORM pg_temp.ok('T27 a full camp refuses check-in and names the nearest camp with space',
            SQLERRM LIKE 'CAMP_FULL%' AND SQLERRM LIKE '%T Big Camp%');
    END;
END $$;

DO $$ BEGIN
    INSERT INTO camp_stays (person_id, camp_id) VALUES (pg_temp.id('person1'), pg_temp.id('camp2'));
    PERFORM pg_temp.ok('T28 a person cannot be checked into two camps at once', FALSE);
EXCEPTION WHEN unique_violation THEN PERFORM pg_temp.ok('T28 a person cannot be checked into two camps at once', TRUE); END $$;

DO $$ BEGIN
    UPDATE camp_stays SET checked_out_at = now() WHERE stay_id = pg_temp.id('stay1');
    PERFORM pg_temp.ok('T29 check-out needs a reason (CHECK)', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T29 check-out needs a reason (CHECK)', TRUE); END $$;

DO $$ BEGIN
    CALL sp_check_out(pg_temp.id('stay1'), 'returned_home');
    PERFORM pg_temp.ok('T30 check-out lowers occupancy and re-opens the camp',
        (SELECT occupancy = 1 AND status = 'open' FROM camps WHERE camp_id = pg_temp.id('camp')));
END $$;

-- ---------------------------------------------------------------- stock
DO $$ BEGIN
    INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason) VALUES (pg_temp.id('wh'), pg_temp.id('water'), -5, 'donation_in');
    PERFORM pg_temp.ok('T31 a donation cannot be negative (movement sign CHECK)', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T31 a donation cannot be negative (movement sign CHECK)', TRUE); END $$;

INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason) VALUES (pg_temp.id('wh'), pg_temp.id('water'), 1000, 'donation_in');
DO $$ BEGIN
    INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, people_served)
    VALUES (pg_temp.id('wh'), pg_temp.id('water'), -1500, 'distributed', 100);
    PERFORM pg_temp.ok('T32 cannot distribute more than is in stock', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T32 cannot distribute more than is in stock', SQLERRM LIKE 'INSUFFICIENT_STOCK%'); END $$;

DO $$
DECLARE v INT;
BEGIN
    v := fn_create_transfer(pg_temp.id('wh'), pg_temp.id('campdepot'),
                            jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('water'), 'quantity', 2)), pg_temp.id('coord'));
    INSERT INTO fx VALUES ('tr1', v);
    PERFORM pg_temp.ok('T33 transfer: stock leaves the source now, the camp gets nothing until received',
        (SELECT quantity FROM stock WHERE depot_id = pg_temp.id('wh') AND resource_id = pg_temp.id('water')) = 998
        AND COALESCE((SELECT quantity FROM stock WHERE depot_id = pg_temp.id('campdepot') AND resource_id = pg_temp.id('water')), 0) = 0);
    PERFORM pg_temp.ok('T34 a camp with 1 person and 0 litres raises a low-supply alert',
        EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = format('low_supply:%s:%s', pg_temp.id('campdepot'), pg_temp.id('water')) AND resolved_at IS NULL));
    PERFORM fn_close_transfer(v, pg_temp.id('coord'), TRUE);
    PERFORM pg_temp.ok('T35 after receiving, the camp has 2 litres (still under 1.5 days: alert stays)',
        (SELECT quantity FROM stock WHERE depot_id = pg_temp.id('campdepot') AND resource_id = pg_temp.id('water')) = 2
        AND EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = format('low_supply:%s:%s', pg_temp.id('campdepot'), pg_temp.id('water')) AND resolved_at IS NULL));
    BEGIN
        PERFORM fn_close_transfer(v, pg_temp.id('coord'), TRUE);
        PERFORM pg_temp.ok('T36 a transfer cannot be received twice', FALSE);
    EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T36 a transfer cannot be received twice', SQLERRM LIKE 'TRANSFER_CLOSED%'); END;
    INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason) VALUES (pg_temp.id('campdepot'), pg_temp.id('water'), 100, 'donation_in');
    PERFORM pg_temp.ok('T37 the low-supply alert resolves itself when stock arrives',
        NOT EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = format('low_supply:%s:%s', pg_temp.id('campdepot'), pg_temp.id('water')) AND resolved_at IS NULL));
END $$;

DO $$
DECLARE v INT;
BEGIN
    v := fn_create_transfer(pg_temp.id('wh'), pg_temp.id('campdepot'),
                            jsonb_build_array(jsonb_build_object('resource_id', pg_temp.id('water'), 'quantity', 100)), pg_temp.id('coord'));
    PERFORM fn_close_transfer(v, pg_temp.id('coord'), FALSE);
    PERFORM pg_temp.ok('T38 a cancelled transfer returns the stock to the source',
        (SELECT quantity FROM stock WHERE depot_id = pg_temp.id('wh') AND resource_id = pg_temp.id('water')) = 998);
END $$;

DO $$ BEGIN
    DELETE FROM stock_movements WHERE depot_id = pg_temp.id('wh');
    PERFORM pg_temp.ok('T39 the stock ledger is append-only', FALSE);
EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T39 the stock ledger is append-only', SQLERRM LIKE 'APPEND_ONLY%'); END $$;

-- ---------------------------------------------------------------- missing persons
DO $$
DECLARE v INT; r RECORD;
BEGIN
    INSERT INTO missing_reports (incident_id, reporter_name, reporter_phone, full_name, age, gender, description, embedding)
    VALUES (pg_temp.id('inc'), 'Daughter', '9876500030', 'Shivanna Gowda', 70, 'male', 'old man, white shirt, glasses', pg_temp.vec(7))
    RETURNING report_id INTO v;
    INSERT INTO fx VALUES ('report', v);
    SELECT * INTO r FROM fn_register_evacuee(pg_temp.id('camp2'), 'Shivana Gowdru', 68, 'male', NULL, NULL, 'white shirt, spectacles',
                                             FALSE, NULL, pg_temp.vec(7, 3, 0.1), pg_temp.id('coord'));
    INSERT INTO fx VALUES ('found', r.person_id);
    PERFORM pg_temp.ok('T40 registering a likely match raises a missing_match alert automatically',
        r.possible_matches = 1 AND EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = format('missing_match:%s:%s', v, r.person_id)));
    PERFORM pg_temp.ok('T41 fn_match_missing ranks the spelling variant first (trigram + vector)',
        (SELECT person_id FROM fn_match_missing(v) LIMIT 1) = r.person_id);
    CALL sp_confirm_match(v, r.person_id, pg_temp.id('coord'));
    PERFORM pg_temp.ok('T42 confirming sets the report to matched and resolves its alerts',
        (SELECT status FROM missing_reports WHERE report_id = v) = 'matched'
        AND NOT EXISTS (SELECT 1 FROM alerts WHERE dedupe_key LIKE 'missing_match:' || v || ':%' AND resolved_at IS NULL));
    BEGIN
        CALL sp_confirm_match(v, r.person_id, pg_temp.id('coord'));
        PERFORM pg_temp.ok('T43 a report cannot be matched twice', FALSE);
    EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('T43 a report cannot be matched twice', SQLERRM LIKE 'ALREADY_MATCHED%'); END;
END $$;

DO $$ BEGIN
    UPDATE missing_reports SET status = 'matched' WHERE report_id = (SELECT report_id FROM missing_reports WHERE status = 'open' LIMIT 1);
    PERFORM pg_temp.ok('T44 status matched without a person is rejected (CHECK)', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T44 status matched without a person is rejected (CHECK)', TRUE); END $$;

-- ---------------------------------------------------------------- users
DO $$ BEGIN
    INSERT INTO users (name, phone, password_hash, role) VALUES ('No team', '6999999902', 'x', 'responder');
    PERFORM pg_temp.ok('T45 a responder must belong to a team', FALSE);
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.ok('T45 a responder must belong to a team', SQLERRM LIKE '%chk_user_assignment%'); END $$;

DO $$ BEGIN
    INSERT INTO users (name, phone, password_hash, role, camp_id) VALUES ('Ghost camp', '6999999903', 'x', 'camp_manager', 999999);
    PERFORM pg_temp.ok('T46 camp managers must point to a real camp (FK added with ALTER TABLE)', FALSE);
EXCEPTION WHEN foreign_key_violation THEN PERFORM pg_temp.ok('T46 camp managers must point to a real camp (FK added with ALTER TABLE)', TRUE); END $$;

-- ---------------------------------------------------------------- dashboard
DO $$
DECLARE v INT;
BEGIN
    INSERT INTO sos_requests (incident_id, reporter_name, reporter_phone, lat, lng, description, people_count, needs, created_at)
    VALUES (pg_temp.id('inc'), 'Old request', '9876500040', 12.85, 77.58, 'waiting since morning', 2, '{food}', now() - INTERVAL '45 minutes')
    RETURNING sos_id INTO v;
    CALL sp_refresh_dashboard();
    PERFORM pg_temp.ok('T47 sp_refresh_dashboard raises an alert for an SOS waiting > 30 min and refreshes the sitrep',
        EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = 'sos_unassigned:' || v AND resolved_at IS NULL)
        AND EXISTS (SELECT 1 FROM mv_daily_sitrep WHERE incident_id = pg_temp.id('inc')));
    PERFORM fn_dispatch_team(v, pg_temp.id('supply'), pg_temp.id('coord'));
    PERFORM pg_temp.ok('T48 dispatching the SOS resolves its waiting alert (trigger)',
        NOT EXISTS (SELECT 1 FROM alerts WHERE dedupe_key = 'sos_unassigned:' || v AND resolved_at IS NULL));
END $$;

ROLLBACK;
