-- =====================================================================
-- RAHAT : seed.sql  -  a simulated 3-day flood response (Kodagu district)
-- Run by: npm run db:seed   (after npm run db:setup)
--
-- The places are real towns; the incident, people and phone numbers are made up.
-- Everything is written through the real tables, so triggers run (occupancy,
-- stock ledger, alerts, SOS history). Because the story happened "over the last
-- three days", the seed back-dates timestamps at the end of the script.
-- =====================================================================
DO $$
DECLARE
    pwd CONSTANT TEXT := '$2a$10$DAQ98M9bk..Y9Cv9KogXN.HpN8hfAUJJn1JgOuD0gZOZNrUdKVJLS';   -- bcrypt("password123")
    t0  TIMESTAMPTZ := date_trunc('hour', now()) - INTERVAL '3 days';                      -- flood began
    inc INT;
    v_admin INT; v_coord INT; v_coord2 INT;
    wh1 INT; wh2 INT;
    c_mdk INT; c_ksn INT; c_vjp INT; c_swp INT; c_npk INT;
    places JSONB := '[
        {"n":"Madikeri","lat":12.4244,"lng":75.7382}, {"n":"Kushalnagar","lat":12.4573,"lng":75.9631},
        {"n":"Virajpet","lat":12.1975,"lng":75.8040}, {"n":"Somwarpet","lat":12.5970,"lng":75.8497},
        {"n":"Napoklu","lat":12.3087,"lng":75.6915}, {"n":"Bhagamandala","lat":12.3866,"lng":75.5310},
        {"n":"Siddapur","lat":12.3393,"lng":75.8888}, {"n":"Murnad","lat":12.3420,"lng":75.7640},
        {"n":"Gonikoppal","lat":12.1834,"lng":75.9300}, {"n":"Suntikoppa","lat":12.4569,"lng":75.8291}
    ]';
    tmpl JSONB := '[
        {"d":"Water entered the house up to chest level, {n} people stuck on the terrace, need a boat urgently","needs":["rescue"]},
        {"d":"ಮನೆಗೆ ನೀರು ನುಗ್ಗಿದೆ, ಮಹಡಿ ಮೇಲೆ ಸಿಕ್ಕಿಕೊಂಡಿದ್ದೇವೆ, ದೋಣಿ ಬೇಕು","needs":["rescue"]},
        {"d":"Ghar mein paani bhar gaya hai, chhat par fase hain, jaldi bachao","needs":["rescue"]},
        {"d":"Landslide near the road, house partly collapsed, an elderly man is trapped inside","needs":["rescue","medical"]},
        {"d":"ಗುಡ್ಡ ಕುಸಿತ, ಮನೆ ಕುಸಿದಿದೆ, ವೃದ್ಧರು ಒಳಗೆ ಸಿಕ್ಕಿದ್ದಾರೆ","needs":["rescue","medical"]},
        {"d":"Pregnant woman in labour, road to hospital is under water","needs":["medical","rescue"]},
        {"d":"Diabetic patient has run out of insulin, needs medicine today","needs":["medical"]},
        {"d":"ಮಕ್ಕಳಿಗೆ ಜ್ವರ ಬಂದಿದೆ, ಔಷಧಿ ಬೇಕು","needs":["medical"]},
        {"d":"No drinking water for two days, {n} people in our colony","needs":["water","food"]},
        {"d":"Paani aur khana chahiye, bacche bhookhe hain","needs":["food","water"]},
        {"d":"ಕುಡಿಯುವ ನೀರು ಇಲ್ಲ, ಆಹಾರ ಬೇಕು","needs":["water","food"]},
        {"d":"Roof blown off, need tarpaulin and a safe place to stay tonight","needs":["shelter"]},
        {"d":"River overflowing next to our estate line houses, families want to evacuate","needs":["rescue","shelter"]},
        {"d":"Coffee estate workers cut off by flood, {n} people, food running out","needs":["food","rescue"]}
    ]';
    first_m TEXT[] := ARRAY['Ramesh','Suresh','Ganapathy','Muthappa','Kariappa','Somanna','Prakash','Manjunath','Ravi','Ashok',
                            'Thimmaiah','Belliappa','Naveen','Harish','Chengappa','Mohan','Sanjay','Abdul','Joseph','Venkatesh'];
    first_f TEXT[] := ARRAY['Lakshmi','Kaveri','Sita','Geetha','Pooja','Bhavya','Shobha','Kavya','Meena','Saraswathi',
                            'Rekha','Chitra','Nandini','Fathima','Mary','Yamuna','Deepa','Shruthi','Anitha','Gowri'];
    last_n  TEXT[] := ARRAY['Kumar','Poovaiah','Gowda','Nanjappa','Achaiah','Shetty','Rai','Bopanna','Kushalappa','Hegde',
                            'Nayak','Rao','Uthappa','Devaiah','Pinto','Khan','Murthy','Subbaiah','Appaiah','Bhat'];
    teams_def JSONB := '[
        {"n":"Boat Team Alpha","k":"boat","m":6,"c":12,"p":0},   {"n":"Boat Team Bravo","k":"boat","m":6,"c":12,"p":4},
        {"n":"Boat Team Charlie","k":"boat","m":5,"c":10,"p":1}, {"n":"Search & Rescue 1","k":"search_rescue","m":8,"c":15,"p":0},
        {"n":"Search & Rescue 2","k":"search_rescue","m":8,"c":15,"p":2}, {"n":"Medical Unit 1","k":"medical","m":4,"c":4,"p":0},
        {"n":"Medical Unit 2","k":"medical","m":4,"c":4,"p":1},  {"n":"Supply Truck 1","k":"supply","m":3,"c":2,"p":0},
        {"n":"Supply Truck 2","k":"supply","m":3,"c":2,"p":2}
    ]';
    e JSONB; pl JSONB; tp JSONB;
    v_id INT; v_sos INT; v_team INT; v_disp INT;
    v_created TIMESTAMPTZ; v_assigned TIMESTAMPTZ; v_scene TIMESTAMPTZ; v_done TIMESTAMPTZ;
    v_people INT; v_n INT; v_camp INT; v_g gender_type; v_age INT; v_name TEXT;
    camp_ids INT[]; i INT; j INT; d INT;
    v_tr INT;
BEGIN
    PERFORM setseed(0.42);

    -- ---------- incident ----------
    INSERT INTO incidents (code, name, disaster_type, status, severity, center_lat, center_lng, radius_km, started_at)
    VALUES ('INC-2026-001', 'Kodagu monsoon floods (simulation)', 'flood', 'active', 4, 12.3800, 75.7900, 45, t0)
    RETURNING incident_id INTO inc;

    -- ---------- resources (daily norms per person, Sphere-style) ----------
    INSERT INTO resources (name, unit, category, per_person_per_day, critical) VALUES
        ('Drinking water',     'litre',  'water',   3.000, TRUE),
        ('Rice',               'kg',     'food',    0.400, TRUE),
        ('Dal',                'kg',     'food',    0.060, FALSE),
        ('Cooking oil',        'litre',  'food',    0.030, FALSE),
        ('ORS sachets',        'packet', 'medical', 0.050, TRUE),
        ('Paracetamol strips', 'strip',  'medical', 0,     FALSE),
        ('Blankets',           'piece',  'shelter', 0,     FALSE),
        ('Tarpaulin sheets',   'piece',  'shelter', 0,     FALSE),
        ('Hygiene kits',       'kit',    'hygiene', 0.020, FALSE),
        ('Baby food',          'packet', 'food',    0.050, FALSE);

    -- ---------- teams ----------
    FOR e IN SELECT * FROM jsonb_array_elements(teams_def) LOOP
        pl := places -> (e->>'p')::INT;
        INSERT INTO teams (name, kind, members, capacity, incident_id, base_lat, base_lng, cur_lat, cur_lng)
        VALUES (e->>'n', (e->>'k')::team_kind, (e->>'m')::INT, (e->>'c')::INT, inc,
                (pl->>'lat')::NUMERIC, (pl->>'lng')::NUMERIC, (pl->>'lat')::NUMERIC, (pl->>'lng')::NUMERIC);
    END LOOP;

    -- ---------- warehouses and camps (each camp gets its own store automatically) ----------
    INSERT INTO depots (name, kind, lat, lng) VALUES ('District Relief Warehouse, Madikeri', 'warehouse', 12.4210, 75.7400) RETURNING depot_id INTO wh1;
    INSERT INTO depots (name, kind, lat, lng) VALUES ('Kushalnagar Relief Depot', 'warehouse', 12.4600, 75.9590) RETURNING depot_id INTO wh2;

    INSERT INTO camps (incident_id, name, kind, address, lat, lng, capacity, opened_at) VALUES
        (inc, 'Govt High School, Madikeri',      'school',         'Near bus stand, Madikeri', 12.4260, 75.7350, 300, t0 + INTERVAL '2 hours') RETURNING camp_id INTO c_mdk;
    INSERT INTO camps (incident_id, name, kind, address, lat, lng, capacity, opened_at) VALUES
        (inc, 'Community Hall, Kushalnagar',     'community_hall', 'Main road, Kushalnagar',   12.4580, 75.9610, 200, t0 + INTERVAL '3 hours') RETURNING camp_id INTO c_ksn;
    INSERT INTO camps (incident_id, name, kind, address, lat, lng, capacity, opened_at) VALUES
        (inc, 'Stadium Tent City, Virajpet',     'tent_city',      'Taluk stadium, Virajpet',  12.1990, 75.8020, 500, t0 + INTERVAL '6 hours') RETURNING camp_id INTO c_vjp;
    INSERT INTO camps (incident_id, name, kind, address, lat, lng, capacity, opened_at) VALUES
        (inc, 'Temple Hall, Somwarpet',          'temple',         'Temple street, Somwarpet', 12.5960, 75.8510, 120, t0 + INTERVAL '8 hours') RETURNING camp_id INTO c_swp;
    INSERT INTO camps (incident_id, name, kind, address, lat, lng, capacity, opened_at) VALUES
        (inc, 'Govt Primary School, Napoklu',    'school',         'Napoklu town',             12.3090, 75.6930,  80, t0 + INTERVAL '10 hours') RETURNING camp_id INTO c_npk;
    camp_ids := ARRAY[c_mdk, c_ksn, c_vjp, c_swp, c_npk];

    -- ---------- users ----------
    INSERT INTO users (name, phone, password_hash, role) VALUES ('Control Room Admin', '9000000001', pwd, 'admin') RETURNING user_id INTO v_admin;
    INSERT INTO users (name, phone, password_hash, role) VALUES ('Anita (Coordinator)', '9000000002', pwd, 'coordinator') RETURNING user_id INTO v_coord;
    INSERT INTO users (name, phone, password_hash, role) VALUES ('Farhan (Coordinator)', '9000000003', pwd, 'coordinator') RETURNING user_id INTO v_coord2;
    INSERT INTO users (name, phone, password_hash, role, team_id)
        SELECT 'Lead - ' || name, '90000001' || lpad(team_id::TEXT, 2, '0'), pwd, 'responder', team_id FROM teams;
    INSERT INTO users (name, phone, password_hash, role, camp_id)
        SELECT 'Manager - ' || trim(split_part(name, ',', 2)), '90000002' || lpad(camp_id::TEXT, 2, '0'), pwd, 'camp_manager', camp_id FROM camps;
    PERFORM fn_set_actor(v_coord);

    -- ---------- donations into the warehouses ----------
    INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, note, created_by, created_at)
    SELECT w, r.resource_id, q * CASE WHEN w = wh1 THEN 1 ELSE 0.5 END, 'donation_in', src, v_admin, t0 + INTERVAL '1 hour'
      FROM resources r
      CROSS JOIN LATERAL (VALUES (wh1), (wh2)) AS ws(w)
      JOIN (VALUES ('Drinking water', 20000, 'State disaster fund'), ('Rice', 6000, 'Civil supplies dept'), ('Dal', 900, 'Civil supplies dept'),
                   ('Cooking oil', 500, 'Donation - traders association'), ('ORS sachets', 3000, 'Health dept'),
                   ('Paracetamol strips', 1500, 'Health dept'), ('Blankets', 1500, 'NGO donation drive'),
                   ('Tarpaulin sheets', 600, 'State disaster fund'), ('Hygiene kits', 800, 'NGO donation drive'),
                   ('Baby food', 400, 'Donation - citizens')) AS q0(rname, q, src) ON q0.rname = r.name;

    -- ---------- send supplies to camps (transfers through the real functions) ----------
    FOREACH v_camp IN ARRAY camp_ids LOOP
        SELECT capacity INTO v_n FROM camps WHERE camp_id = v_camp;
        v_tr := fn_create_transfer(CASE WHEN v_camp = c_ksn THEN wh2 ELSE wh1 END,
                                   (SELECT depot_id FROM depots WHERE camp_id = v_camp),
                                   jsonb_build_array(
                                       jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Drinking water'), 'quantity', v_n * 3 * 4),
                                       jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Rice'), 'quantity', v_n * 0.4 * 4),
                                       jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Dal'), 'quantity', v_n * 0.06 * 4),
                                       jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'ORS sachets'), 'quantity', v_n * 0.05 * 4),
                                       jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Blankets'), 'quantity', v_n),
                                       jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Hygiene kits'), 'quantity', CEIL(v_n * 0.02 * 4))),
                                   v_coord, 'KA-12-' || (1000 + v_camp));
        PERFORM fn_close_transfer(v_tr, v_coord, TRUE);
    END LOOP;
    -- one more truck is still on the road to Virajpet
    v_tr := fn_create_transfer(wh1, (SELECT depot_id FROM depots WHERE camp_id = c_vjp),
                               jsonb_build_array(jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Tarpaulin sheets'), 'quantity', 150),
                                                 jsonb_build_object('resource_id', (SELECT resource_id FROM resources WHERE name = 'Baby food'), 'quantity', 60)),
                               v_coord, 'KA-12-2231');

    -- ---------- SOS requests over three days ----------
    FOR i IN 1..74 LOOP
        tp := tmpl -> floor(random() * jsonb_array_length(tmpl))::INT;
        pl := places -> floor(random() * jsonb_array_length(places))::INT;
        v_people := 1 + floor(random() * 9)::INT;
        -- the last 14 requests are recent and still open; the rest arrived over the three days
        v_created := CASE WHEN i > 60 THEN now() - (random() * INTERVAL '150 minutes')
                          ELSE t0 + (i / 60.0) * (now() - INTERVAL '3 hours' - t0) END;
        INSERT INTO sos_requests (incident_id, reporter_name, reporter_phone, lat, lng, landmark, description, people_count,
                                  children, elderly, injured, needs, channel, created_at)
        VALUES (inc,
                first_m[1 + floor(random() * 20)::INT] || ' ' || last_n[1 + floor(random() * 20)::INT],
                (ARRAY['9','8','7','6'])[1 + floor(random() * 4)::INT] || lpad(floor(random() * 1e9)::TEXT, 9, '0'),
                ROUND(((pl->>'lat')::NUMERIC + (random() - 0.5) * 0.06)::NUMERIC, 6),
                ROUND(((pl->>'lng')::NUMERIC + (random() - 0.5) * 0.06)::NUMERIC, 6),
                'near ' || (pl->>'n') || (ARRAY[' bus stop', ' temple', ' river bridge', ' school', ' estate gate', ' market'])[1 + floor(random() * 6)::INT],
                replace(tp->>'d', '{n}', v_people::TEXT), v_people,
                LEAST(v_people / 2, floor(random() * 3)::INT), LEAST(v_people / 3, floor(random() * 2)::INT),
                CASE WHEN random() < 0.25 THEN 1 + floor(random() * LEAST(v_people, 2))::INT ELSE 0 END,
                ARRAY(SELECT jsonb_array_elements_text(tp->'needs'))::need_type[],
                (ARRAY['web', 'web', 'helpline', 'field'])[1 + floor(random() * 4)::INT],
                v_created)
        RETURNING sos_id INTO v_sos;

        IF i <= 60 THEN
            -- historical request: a fitting team was sent, reached and finished
            SELECT t.team_id INTO v_team FROM teams t, sos_requests s
             WHERE s.sos_id = v_sos AND fn_team_fits(t.kind, s.needs) ORDER BY random() LIMIT 1;
            v_assigned := v_created + (5 + random() * 40) * INTERVAL '1 minute';
            v_scene    := v_assigned + (10 + random() * 60) * INTERVAL '1 minute';
            v_done     := v_scene + (15 + random() * 75) * INTERVAL '1 minute';
            INSERT INTO dispatches (sos_id, team_id, assigned_by, status, distance_km, eta_minutes, assigned_at, en_route_at,
                                    on_scene_at, finished_at, people_rescued)
            SELECT v_sos, v_team, CASE WHEN i % 2 = 0 THEN v_coord ELSE v_coord2 END, 'completed',
                   ROUND((2 + random() * 18)::NUMERIC, 2), (10 + random() * 50)::INT,
                   v_assigned, v_assigned + INTERVAL '3 minutes', v_scene, v_done,
                   CASE WHEN 'rescue' = ANY (s.needs) THEN s.people_count ELSE 0 END
              FROM sos_requests s WHERE s.sos_id = v_sos;
            UPDATE sos_requests SET status = 'assigned' WHERE sos_id = v_sos;
            UPDATE sos_requests SET status = 'in_progress' WHERE sos_id = v_sos;
            UPDATE sos_requests SET status = 'resolved' WHERE sos_id = v_sos;
        END IF;
    END LOOP;

    -- a few recent ones are already being handled, through the real dispatch function
    PERFORM fn_auto_dispatch(inc, v_coord, 3);
    SELECT dispatch_id INTO v_disp FROM dispatches WHERE status = 'assigned' ORDER BY dispatch_id LIMIT 1;
    PERFORM fn_update_dispatch(v_disp, 'en_route', v_coord);
    PERFORM fn_update_dispatch(v_disp, 'on_scene', v_coord, NULL, 'Water still rising, evacuating in two trips');

    -- two clear duplicates for the demo: same family calling again from the same phone, and a neighbour 80 m away
    e := (SELECT to_jsonb(s) FROM sos_requests s WHERE status = 'new' ORDER BY created_at LIMIT 1);
    PERFORM fn_create_sos(inc, e->>'reporter_name', e->>'reporter_phone', (e->>'lat')::NUMERIC + 0.0004, (e->>'lng')::NUMERIC,
                          e->>'landmark', 'Calling again - still waiting on the roof, water is rising, please hurry',
                          (e->>'people_count')::INT, 0, 0, 0, ARRAY['rescue']::need_type[], 'helpline', NULL, v_coord);
    e := (SELECT to_jsonb(s) FROM sos_requests s WHERE status = 'new' AND suspected_dup_of IS NULL ORDER BY created_at OFFSET 3 LIMIT 1);
    PERFORM fn_create_sos(inc, 'Neighbour ' || last_n[3], '9845098450', (e->>'lat')::NUMERIC + 0.0005, (e->>'lng')::NUMERIC + 0.0003,
                          e->>'landmark', e->>'description', 4, 1, 1, 0,
                          ARRAY(SELECT jsonb_array_elements_text(e->'needs'))::need_type[], 'web', NULL, v_coord);

    -- ---------- evacuees in camps ----------
    FOR i IN 1..5 LOOP
        v_camp := camp_ids[i];
        v_n := (ARRAY[212, 141, 268, 112, 80])[i];          -- Somwarpet nearly full, Napoklu full
        FOR j IN 1..v_n LOOP
            v_g := CASE WHEN random() < 0.5 THEN 'male' ELSE 'female' END;
            v_age := CASE WHEN random() < 0.2 THEN floor(random() * 12)::INT
                          WHEN random() < 0.25 THEN 60 + floor(random() * 30)::INT
                          ELSE 12 + floor(random() * 48)::INT END;
            v_name := CASE WHEN v_g = 'male' THEN first_m[1 + floor(random() * 20)::INT] ELSE first_f[1 + floor(random() * 20)::INT] END
                      || ' ' || last_n[1 + floor(random() * 20)::INT];
            INSERT INTO people (full_name, age, gender, phone, home_village, marks, needs_medical, registered_by, registered_at)
            VALUES (v_name, v_age, v_g,
                    CASE WHEN random() < 0.6 THEN (ARRAY['9','8','7'])[1 + floor(random() * 3)::INT] || lpad(floor(random() * 1e9)::TEXT, 9, '0') END,
                    places -> floor(random() * 10)::INT ->> 'n', NULL, random() < 0.06, v_coord,
                    t0 + INTERVAL '3 hours' + random() * (now() - t0 - INTERVAL '4 hours'))
            RETURNING person_id INTO v_id;
            INSERT INTO camp_stays (person_id, camp_id, checked_in_at)
            SELECT v_id, v_camp, registered_at FROM people WHERE person_id = v_id;
        END LOOP;
    END LOOP;
    -- some went home already
    PERFORM fn_set_actor(v_coord);
    UPDATE camp_stays SET checked_out_at = checked_in_at + INTERVAL '30 hours', checkout_reason = 'returned_home'
     WHERE stay_id IN (SELECT stay_id FROM camp_stays WHERE camp_id = c_mdk AND checked_in_at < now() - INTERVAL '40 hours' LIMIT 25);

    -- residents with identifying details that missing-person reports will match
    UPDATE people SET full_name = 'Ramesh Kumar', age = 67, gender = 'male', home_village = 'Bhagamandala',
                      marks = 'white beard, walks with a stick, blue checked lungi'
     WHERE person_id = (SELECT person_id FROM camp_stays WHERE camp_id = c_vjp AND checked_out_at IS NULL ORDER BY stay_id LIMIT 1);
    UPDATE people SET full_name = 'Kaveri Poovaiah', age = 9, gender = 'female', home_village = 'Napoklu',
                      marks = 'school uniform, red hair band, small scar on left cheek'
     WHERE person_id = (SELECT person_id FROM camp_stays WHERE camp_id = c_mdk AND checked_out_at IS NULL ORDER BY stay_id LIMIT 1);
    UPDATE people SET full_name = 'Unknown woman (unconscious on arrival)', age = 45, gender = 'female', home_village = NULL,
                      marks = 'green saree, gold nose ring, mole near right eye', needs_medical = TRUE
     WHERE person_id = (SELECT person_id FROM camp_stays WHERE camp_id = c_ksn AND checked_out_at IS NULL ORDER BY stay_id LIMIT 1);

    -- ---------- daily food / water distribution at each camp ----------
    FOR d IN 0..2 LOOP
        FOREACH v_camp IN ARRAY camp_ids LOOP
            SELECT COUNT(*) INTO v_n FROM camp_stays
             WHERE camp_id = v_camp AND checked_in_at < t0 + (d + 1) * INTERVAL '1 day'
               AND (checked_out_at IS NULL OR checked_out_at > t0 + (d + 1) * INTERVAL '1 day');
            CONTINUE WHEN v_n = 0;
            INSERT INTO stock_movements (depot_id, resource_id, qty_change, reason, people_served, created_by, created_at)
            SELECT dp.depot_id, r.resource_id,
                   -ROUND(v_n * r.per_person_per_day * CASE WHEN v_camp = c_swp AND r.name = 'Drinking water' THEN 1.7 ELSE 0.9 END, 2),
                   'distributed', v_n, v_coord, t0 + d * INTERVAL '1 day' + INTERVAL '20 hours'
              FROM depots dp, resources r
             WHERE dp.camp_id = v_camp AND r.name IN ('Drinking water', 'Rice', 'Dal')
               AND t0 + d * INTERVAL '1 day' + INTERVAL '20 hours' < now();
        END LOOP;
    END LOOP;

    -- ---------- missing-person reports ----------
    INSERT INTO missing_reports (incident_id, reporter_name, reporter_phone, full_name, age, gender, home_village,
                                 last_seen_place, last_seen_at, description, created_at)
    VALUES
      (inc, 'Suma Ramesh', '9845011111', 'Ramesha K', 68, 'male', 'Bhagamandala', 'Triveni Sangama ghat',
       t0 + INTERVAL '5 hours', 'Old man with a white beard, uses a walking stick, was wearing a blue lungi', t0 + INTERVAL '9 hours'),
      (inc, 'Devaki Poovaiah', '9845022222', 'Kaveri P', 8, 'female', 'Napoklu', 'Napoklu school gate',
       t0 + INTERVAL '20 hours', 'Girl in school uniform with a red hair band, scar on her cheek', t0 + INTERVAL '22 hours'),
      (inc, 'Prakash Shetty', '9845033333', 'Vanitha Shetty', 46, 'female', 'Suntikoppa', 'Suntikoppa market',
       t0 + INTERVAL '30 hours', 'Wearing a green saree and gold nose ring, has a mole near her right eye', t0 + INTERVAL '31 hours'),
      (inc, 'Mohan Rai', '9845044444', 'Arjun Rai', 23, 'male', 'Siddapur', 'Siddapur river bridge',
       t0 + INTERVAL '40 hours', 'Young man in a black raincoat, riding a red motorbike', t0 + INTERVAL '41 hours'),
      (inc, 'Fathima Khan', '9845055555', 'Imran Khan', 35, 'male', 'Kushalnagar', 'Kushalnagar bus stand',
       t0 + INTERVAL '50 hours', 'Tall, wears spectacles, grey shirt', t0 + INTERVAL '52 hours');

    -- ---------- back-date what the simulation says happened earlier ----------
    -- (only this seed does this; in the app, history is append-only)
    ALTER TABLE sos_status_history DISABLE TRIGGER trg_history_append_only;
    UPDATE sos_status_history h
       SET changed_at = CASE h.to_status WHEN 'new' THEN s.created_at
                                         WHEN 'assigned' THEN COALESCE(d.assigned_at, h.changed_at)
                                         WHEN 'in_progress' THEN COALESCE(d.on_scene_at, h.changed_at)
                                         WHEN 'resolved' THEN COALESCE(d.finished_at, h.changed_at)
                                         ELSE h.changed_at END,
           changed_by = CASE WHEN h.to_status = 'new' THEN NULL ELSE COALESCE(d.assigned_by, h.changed_by) END
      FROM sos_requests s
      LEFT JOIN dispatches d ON d.sos_id = s.sos_id AND d.status = 'completed'
     WHERE s.sos_id = h.sos_id;
    ALTER TABLE sos_status_history ENABLE TRIGGER trg_history_append_only;
    UPDATE sos_requests s SET updated_at = COALESCE((SELECT MAX(changed_at) FROM sos_status_history h WHERE h.sos_id = s.sos_id), s.created_at);
    UPDATE teams SET last_seen_at = now() - (random() * INTERVAL '20 minutes');

    CALL sp_refresh_dashboard();
    RAISE NOTICE 'Seeded incident % with % SOS, % teams, % camps, % people, % missing reports',
        inc, (SELECT COUNT(*) FROM sos_requests), (SELECT COUNT(*) FROM teams), (SELECT COUNT(*) FROM camps),
        (SELECT COUNT(*) FROM people), (SELECT COUNT(*) FROM missing_reports);
END $$;
