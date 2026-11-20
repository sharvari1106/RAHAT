-- =====================================================================
-- RAHAT : disaster relief coordination - 01_schema.sql
-- PostgreSQL 16 + pgvector + pg_trgm
-- Tables, keys, constraints, indexes. Business rules that need code live
-- in 02_functions_triggers.sql; reporting views in 03_views.sql.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;     -- embeddings for duplicate SOS + missing-person matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy name matching (Ramesh / Ramesha / Rames)

-- ---------- enumerated types ----------
CREATE TYPE disaster_type   AS ENUM ('flood', 'cyclone', 'earthquake', 'landslide', 'fire', 'drought', 'other');
CREATE TYPE incident_status AS ENUM ('monitoring', 'active', 'recovery', 'closed');
CREATE TYPE user_role       AS ENUM ('admin', 'coordinator', 'responder', 'camp_manager');
CREATE TYPE team_kind       AS ENUM ('boat', 'search_rescue', 'medical', 'supply');
CREATE TYPE team_status     AS ENUM ('available', 'dispatched', 'on_scene', 'off_duty');
CREATE TYPE sos_status      AS ENUM ('new', 'triaged', 'assigned', 'in_progress', 'resolved', 'duplicate', 'cancelled');
CREATE TYPE need_type       AS ENUM ('rescue', 'medical', 'food', 'water', 'shelter');
CREATE TYPE dispatch_status AS ENUM ('assigned', 'en_route', 'on_scene', 'completed', 'aborted');
CREATE TYPE camp_status     AS ENUM ('open', 'full', 'closed');
CREATE TYPE depot_kind      AS ENUM ('warehouse', 'camp');
CREATE TYPE resource_category AS ENUM ('food', 'water', 'medical', 'shelter', 'hygiene');
CREATE TYPE movement_reason AS ENUM ('donation_in', 'transfer_out', 'transfer_in', 'distributed', 'damaged', 'adjustment');
CREATE TYPE transfer_status AS ENUM ('in_transit', 'received', 'cancelled');
CREATE TYPE gender_type     AS ENUM ('male', 'female', 'other', 'unknown');
CREATE TYPE missing_status  AS ENUM ('open', 'matched', 'reunited', 'closed');
CREATE TYPE alert_severity  AS ENUM ('info', 'warning', 'critical');

-- ---------- 1. incidents (a disaster event being managed) ----------
CREATE TABLE incidents (
    incident_id   SERIAL PRIMARY KEY,
    code          VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^INC-[0-9]{4}-[0-9]{3}$'),
    name          VARCHAR(120) NOT NULL,
    disaster_type disaster_type NOT NULL,
    status        incident_status NOT NULL DEFAULT 'active',
    severity      SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
    center_lat    NUMERIC(9,6) NOT NULL CHECK (center_lat BETWEEN 6 AND 37.5),     -- India bounding box
    center_lng    NUMERIC(9,6) NOT NULL CHECK (center_lng BETWEEN 68 AND 97.5),
    radius_km     NUMERIC(6,1) NOT NULL CHECK (radius_km > 0 AND radius_km <= 500),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at      TIMESTAMPTZ,
    CONSTRAINT chk_incident_dates  CHECK (ended_at IS NULL OR ended_at > started_at),
    CONSTRAINT chk_closed_has_end  CHECK (status <> 'closed' OR ended_at IS NOT NULL)
);

-- ---------- 2. rescue / relief teams ----------
CREATE TABLE teams (
    team_id      SERIAL PRIMARY KEY,
    name         VARCHAR(80) NOT NULL UNIQUE,
    kind         team_kind NOT NULL,
    members      SMALLINT NOT NULL CHECK (members BETWEEN 1 AND 50),
    capacity     SMALLINT NOT NULL CHECK (capacity BETWEEN 1 AND 100),           -- people it can evacuate per trip
    status       team_status NOT NULL DEFAULT 'available',
    incident_id  INT REFERENCES incidents(incident_id) ON DELETE SET NULL,        -- where it is deployed
    base_lat     NUMERIC(9,6) NOT NULL CHECK (base_lat BETWEEN 6 AND 37.5),
    base_lng     NUMERIC(9,6) NOT NULL CHECK (base_lng BETWEEN 68 AND 97.5),
    cur_lat      NUMERIC(9,6) NOT NULL CHECK (cur_lat BETWEEN 6 AND 37.5),
    cur_lng      NUMERIC(9,6) NOT NULL CHECK (cur_lng BETWEEN 68 AND 97.5),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 3. relief camps ----------
CREATE TABLE camps (
    camp_id     SERIAL PRIMARY KEY,
    incident_id INT NOT NULL REFERENCES incidents(incident_id) ON DELETE RESTRICT,
    name        VARCHAR(120) NOT NULL,
    kind        VARCHAR(30) NOT NULL CHECK (kind IN ('school', 'community_hall', 'temple', 'tent_city', 'stadium', 'other')),
    address     VARCHAR(200),
    lat         NUMERIC(9,6) NOT NULL CHECK (lat BETWEEN 6 AND 37.5),
    lng         NUMERIC(9,6) NOT NULL CHECK (lng BETWEEN 68 AND 97.5),
    capacity    INT NOT NULL CHECK (capacity BETWEEN 1 AND 20000),
    occupancy   INT NOT NULL DEFAULT 0,                                         -- maintained by trigger
    status      camp_status NOT NULL DEFAULT 'open',
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ,
    CONSTRAINT chk_camp_occupancy CHECK (occupancy BETWEEN 0 AND capacity),
    CONSTRAINT chk_camp_closed    CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    CONSTRAINT uq_camp_name_per_incident UNIQUE (incident_id, name)
);

-- ---------- 4. users (control-room staff, team leads, camp managers) ----------
CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    name          VARCHAR(80) NOT NULL,
    phone         VARCHAR(10) NOT NULL UNIQUE CHECK (phone ~ '^[6-9][0-9]{9}$'),
    password_hash VARCHAR(100) NOT NULL,
    role          user_role NOT NULL,
    team_id       INT REFERENCES teams(team_id) ON DELETE SET NULL,
    camp_id       INT,                                   -- FK added below with ALTER TABLE
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- a responder must belong to a team, a camp manager must run a camp
    CONSTRAINT chk_user_assignment CHECK (
        (role = 'responder'    AND team_id IS NOT NULL AND camp_id IS NULL) OR
        (role = 'camp_manager' AND camp_id IS NOT NULL AND team_id IS NULL) OR
        (role IN ('admin', 'coordinator') AND team_id IS NULL AND camp_id IS NULL)
    )
);
-- ALTER: users is created before camps' manager link is needed, so the FK is added afterwards
ALTER TABLE users ADD CONSTRAINT fk_users_camp FOREIGN KEY (camp_id) REFERENCES camps(camp_id) ON DELETE SET NULL;

-- ---------- 5. SOS requests (from citizens, helpline or field) ----------
CREATE SEQUENCE sos_ticket_seq START 1;
CREATE TABLE sos_requests (
    sos_id          SERIAL PRIMARY KEY,
    ticket          VARCHAR(12) NOT NULL UNIQUE DEFAULT ('SOS-' || lpad(nextval('sos_ticket_seq')::TEXT, 6, '0')),
    incident_id     INT NOT NULL REFERENCES incidents(incident_id) ON DELETE RESTRICT,
    reporter_name   VARCHAR(80) NOT NULL CHECK (length(trim(reporter_name)) >= 2),
    reporter_phone  VARCHAR(10) NOT NULL CHECK (reporter_phone ~ '^[6-9][0-9]{9}$'),
    lat             NUMERIC(9,6) NOT NULL CHECK (lat BETWEEN 6 AND 37.5),
    lng             NUMERIC(9,6) NOT NULL CHECK (lng BETWEEN 68 AND 97.5),
    landmark        VARCHAR(160),
    description     TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 5 AND 1000),
    people_count    SMALLINT NOT NULL CHECK (people_count BETWEEN 1 AND 500),
    children        SMALLINT NOT NULL DEFAULT 0 CHECK (children >= 0),
    elderly         SMALLINT NOT NULL DEFAULT 0 CHECK (elderly >= 0),
    injured         SMALLINT NOT NULL DEFAULT 0 CHECK (injured >= 0),
    needs           need_type[] NOT NULL CHECK (cardinality(needs) BETWEEN 1 AND 5),
    channel         VARCHAR(12) NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'helpline', 'field')),
    status          sos_status NOT NULL DEFAULT 'new',
    suspected_dup_of INT REFERENCES sos_requests(sos_id),       -- flagged automatically, coordinator decides
    duplicate_of    INT REFERENCES sos_requests(sos_id),        -- confirmed duplicate
    embedding       vector(384),                                -- multilingual sentence embedding of the description
    search_tsv      tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple', coalesce(description, '') || ' ' || coalesce(landmark, ''))
                    ) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_sos_groups    CHECK (children <= people_count AND elderly <= people_count AND injured <= people_count
                                        AND children + elderly <= people_count),
    CONSTRAINT chk_sos_duplicate CHECK ((status = 'duplicate') = (duplicate_of IS NOT NULL)),
    CONSTRAINT chk_sos_not_self  CHECK (duplicate_of IS DISTINCT FROM sos_id AND suspected_dup_of IS DISTINCT FROM sos_id)
);

-- allowed status changes (a lookup table drives the state machine trigger)
CREATE TABLE sos_transitions (
    from_status sos_status NOT NULL,
    to_status   sos_status NOT NULL,
    PRIMARY KEY (from_status, to_status),
    CHECK (from_status <> to_status)
);

-- ---------- 6. SOS status history (append-only audit, written by trigger) ----------
CREATE TABLE sos_status_history (
    history_id  BIGSERIAL PRIMARY KEY,
    sos_id      INT NOT NULL REFERENCES sos_requests(sos_id) ON DELETE CASCADE,
    from_status sos_status,
    to_status   sos_status NOT NULL,
    changed_by  INT REFERENCES users(user_id),
    note        VARCHAR(200),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 7. dispatches (a team sent to an SOS) ----------
CREATE TABLE dispatches (
    dispatch_id    SERIAL PRIMARY KEY,
    sos_id         INT NOT NULL REFERENCES sos_requests(sos_id) ON DELETE RESTRICT,
    team_id        INT NOT NULL REFERENCES teams(team_id) ON DELETE RESTRICT,
    assigned_by    INT REFERENCES users(user_id),
    status         dispatch_status NOT NULL DEFAULT 'assigned',
    distance_km    NUMERIC(7,2) NOT NULL CHECK (distance_km >= 0),
    eta_minutes    INT NOT NULL CHECK (eta_minutes >= 0),
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    en_route_at    TIMESTAMPTZ,
    on_scene_at    TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    people_rescued SMALLINT CHECK (people_rescued BETWEEN 0 AND 500),
    notes          VARCHAR(300),
    CONSTRAINT chk_dispatch_times CHECK (
        (en_route_at IS NULL OR en_route_at >= assigned_at) AND
        (on_scene_at IS NULL OR on_scene_at >= assigned_at) AND
        (finished_at IS NULL OR finished_at >= assigned_at)),
    CONSTRAINT chk_dispatch_completed CHECK ((status = 'completed') = (people_rescued IS NOT NULL AND finished_at IS NOT NULL)
                                             OR status = 'aborted')
);
-- a team can be on only one live job, and an SOS has at most one live team
CREATE UNIQUE INDEX uq_dispatch_active_team ON dispatches (team_id) WHERE status IN ('assigned', 'en_route', 'on_scene');
CREATE UNIQUE INDEX uq_dispatch_active_sos  ON dispatches (sos_id)  WHERE status IN ('assigned', 'en_route', 'on_scene');

-- ---------- 8. supply depots (warehouses + one per camp) ----------
CREATE TABLE depots (
    depot_id  SERIAL PRIMARY KEY,
    name      VARCHAR(120) NOT NULL UNIQUE,
    kind      depot_kind NOT NULL,
    camp_id   INT UNIQUE REFERENCES camps(camp_id) ON DELETE CASCADE,
    lat       NUMERIC(9,6) NOT NULL CHECK (lat BETWEEN 6 AND 37.5),
    lng       NUMERIC(9,6) NOT NULL CHECK (lng BETWEEN 68 AND 97.5),
    CONSTRAINT chk_depot_camp CHECK ((kind = 'camp') = (camp_id IS NOT NULL))
);

-- ---------- 9. relief resources (catalogue with Sphere-style daily norms) ----------
CREATE TABLE resources (
    resource_id        SERIAL PRIMARY KEY,
    name               VARCHAR(80) NOT NULL UNIQUE,
    unit               VARCHAR(12) NOT NULL CHECK (unit IN ('kg', 'litre', 'packet', 'piece', 'kit', 'strip')),
    category           resource_category NOT NULL,
    per_person_per_day NUMERIC(8,3) NOT NULL DEFAULT 0 CHECK (per_person_per_day >= 0),
    critical           BOOLEAN NOT NULL DEFAULT FALSE      -- running out is life-threatening (water, food, ORS)
);

-- ---------- 10. current stock (one row per depot x resource, kept by trigger) ----------
CREATE TABLE stock (
    depot_id    INT NOT NULL REFERENCES depots(depot_id) ON DELETE CASCADE,
    resource_id INT NOT NULL REFERENCES resources(resource_id) ON DELETE RESTRICT,
    quantity    NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (depot_id, resource_id),
    CONSTRAINT chk_stock_nonnegative CHECK (quantity >= 0)
);

-- ---------- 11. transfers between depots ----------
CREATE SEQUENCE transfer_code_seq START 1;
CREATE TABLE transfers (
    transfer_id  SERIAL PRIMARY KEY,
    code         VARCHAR(12) NOT NULL UNIQUE DEFAULT ('TRF-' || lpad(nextval('transfer_code_seq')::TEXT, 5, '0')),
    from_depot   INT NOT NULL REFERENCES depots(depot_id),
    to_depot     INT NOT NULL REFERENCES depots(depot_id),
    status       transfer_status NOT NULL DEFAULT 'in_transit',
    vehicle      VARCHAR(40),
    created_by   INT REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_by    INT REFERENCES users(user_id),
    closed_at    TIMESTAMPTZ,
    CONSTRAINT chk_transfer_depots CHECK (from_depot <> to_depot),
    CONSTRAINT chk_transfer_closed CHECK ((status = 'in_transit') = (closed_at IS NULL))
);
CREATE TABLE transfer_items (
    transfer_id INT NOT NULL REFERENCES transfers(transfer_id) ON DELETE CASCADE,
    resource_id INT NOT NULL REFERENCES resources(resource_id),
    quantity    NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (transfer_id, resource_id)
);

-- ---------- 12. stock movements (append-only ledger; the only way stock changes) ----------
CREATE TABLE stock_movements (
    movement_id  BIGSERIAL PRIMARY KEY,
    depot_id     INT NOT NULL REFERENCES depots(depot_id),
    resource_id  INT NOT NULL REFERENCES resources(resource_id),
    qty_change   NUMERIC(12,2) NOT NULL CHECK (qty_change <> 0),
    reason       movement_reason NOT NULL,
    transfer_id  INT REFERENCES transfers(transfer_id),
    people_served INT CHECK (people_served > 0),
    note         VARCHAR(200),
    created_by   INT REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- direction must match the reason; transfer rows must point to a transfer
    CONSTRAINT chk_movement_sign CHECK (
        (reason IN ('donation_in', 'transfer_in') AND qty_change > 0) OR
        (reason IN ('transfer_out', 'distributed', 'damaged') AND qty_change < 0) OR
        reason = 'adjustment'),
    CONSTRAINT chk_movement_transfer CHECK ((reason IN ('transfer_in', 'transfer_out')) = (transfer_id IS NOT NULL)),
    CONSTRAINT chk_movement_served   CHECK (people_served IS NULL OR reason = 'distributed')
);

-- ---------- 13. people (evacuees / survivors registered at camps) ----------
CREATE TABLE people (
    person_id      SERIAL PRIMARY KEY,
    full_name      VARCHAR(100) NOT NULL CHECK (length(trim(full_name)) >= 2),
    age            SMALLINT CHECK (age BETWEEN 0 AND 120),
    gender         gender_type NOT NULL DEFAULT 'unknown',
    phone          VARCHAR(10) CHECK (phone ~ '^[6-9][0-9]{9}$'),
    home_village   VARCHAR(80),
    marks          VARCHAR(300),                       -- identifying description (clothes, scars, glasses...)
    needs_medical  BOOLEAN NOT NULL DEFAULT FALSE,
    rescued_from   INT REFERENCES sos_requests(sos_id) ON DELETE SET NULL,
    embedding      vector(384),
    registered_by  INT REFERENCES users(user_id),
    registered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 14. camp stays (check-in / check-out) ----------
CREATE TABLE camp_stays (
    stay_id         SERIAL PRIMARY KEY,
    person_id       INT NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
    camp_id         INT NOT NULL REFERENCES camps(camp_id) ON DELETE RESTRICT,
    checked_in_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    checked_out_at  TIMESTAMPTZ,
    checkout_reason VARCHAR(20) CHECK (checkout_reason IN ('returned_home', 'moved_camp', 'hospital', 'with_family', 'deceased')),
    CONSTRAINT chk_stay_times    CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at),
    CONSTRAINT chk_stay_checkout CHECK ((checked_out_at IS NULL) = (checkout_reason IS NULL))
);
-- a person can be in only one camp at a time
CREATE UNIQUE INDEX uq_one_open_stay ON camp_stays (person_id) WHERE checked_out_at IS NULL;

-- ---------- 15. missing-person reports ----------
CREATE SEQUENCE missing_ticket_seq START 1;
CREATE TABLE missing_reports (
    report_id         SERIAL PRIMARY KEY,
    ticket            VARCHAR(12) NOT NULL UNIQUE DEFAULT ('MP-' || lpad(nextval('missing_ticket_seq')::TEXT, 6, '0')),
    incident_id       INT NOT NULL REFERENCES incidents(incident_id),
    reporter_name     VARCHAR(80) NOT NULL CHECK (length(trim(reporter_name)) >= 2),
    reporter_phone    VARCHAR(10) NOT NULL CHECK (reporter_phone ~ '^[6-9][0-9]{9}$'),
    full_name         VARCHAR(100) NOT NULL CHECK (length(trim(full_name)) >= 2),
    age               SMALLINT CHECK (age BETWEEN 0 AND 120),
    gender            gender_type NOT NULL DEFAULT 'unknown',
    home_village      VARCHAR(80),
    last_seen_place   VARCHAR(160),
    last_seen_at      TIMESTAMPTZ,
    description       VARCHAR(500) NOT NULL CHECK (length(trim(description)) >= 5),
    status            missing_status NOT NULL DEFAULT 'open',
    matched_person_id INT REFERENCES people(person_id),
    matched_by        INT REFERENCES users(user_id),
    matched_at        TIMESTAMPTZ,
    embedding         vector(384),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_missing_match CHECK ((status IN ('matched', 'reunited')) = (matched_person_id IS NOT NULL)),
    CONSTRAINT chk_missing_seen  CHECK (last_seen_at IS NULL OR last_seen_at <= created_at + INTERVAL '1 hour')
);

-- ---------- 16. alerts (raised automatically by triggers / procedures) ----------
CREATE TABLE alerts (
    alert_id    SERIAL PRIMARY KEY,
    incident_id INT REFERENCES incidents(incident_id) ON DELETE CASCADE,
    kind        VARCHAR(30) NOT NULL CHECK (kind IN ('sos_unassigned', 'camp_near_full', 'camp_full', 'low_supply', 'missing_match')),
    severity    alert_severity NOT NULL,
    message     VARCHAR(300) NOT NULL,
    dedupe_key  VARCHAR(80) NOT NULL,                  -- e.g. low_supply:depot:3:resource:2
    link        VARCHAR(120),                          -- page that resolves it
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
-- the same problem is never raised twice while it is still open
CREATE UNIQUE INDEX uq_alert_open ON alerts (dedupe_key) WHERE resolved_at IS NULL;

-- =====================================================================
-- Indexes (beyond the ones created by PRIMARY KEY / UNIQUE)
-- =====================================================================
-- triage queue only ever reads open requests -> partial index
CREATE INDEX idx_sos_open ON sos_requests (incident_id, created_at) WHERE status IN ('new', 'triaged', 'assigned', 'in_progress');
CREATE INDEX idx_sos_phone ON sos_requests (reporter_phone, created_at DESC);
CREATE INDEX idx_sos_latlng ON sos_requests (lat, lng);                         -- bounding-box pre-filter for nearby SOS
CREATE INDEX idx_sos_fts ON sos_requests USING GIN (search_tsv);                -- full-text search of descriptions
CREATE INDEX idx_sos_embedding ON sos_requests USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_history_sos ON sos_status_history (sos_id, changed_at);
CREATE INDEX idx_dispatch_sos ON dispatches (sos_id);
CREATE INDEX idx_team_available ON teams (kind) WHERE status = 'available';
CREATE INDEX idx_camp_incident ON camps (incident_id) WHERE status <> 'closed';
CREATE INDEX idx_stays_camp_open ON camp_stays (camp_id) WHERE checked_out_at IS NULL;
CREATE INDEX idx_people_name_trgm ON people USING GIST (full_name gist_trgm_ops);  -- KNN: ORDER BY full_name <-> 'Ramesh'
CREATE INDEX idx_people_embedding ON people USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_missing_name_trgm ON missing_reports USING GIN (full_name gin_trgm_ops);
CREATE INDEX idx_missing_open ON missing_reports (incident_id) WHERE status = 'open';
CREATE INDEX idx_missing_embedding ON missing_reports USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_movements_depot ON stock_movements (depot_id, resource_id, created_at DESC);
CREATE INDEX idx_movements_time ON stock_movements USING BRIN (created_at);       -- append-only, time-ordered table
CREATE INDEX idx_transfers_open ON transfers (to_depot) WHERE status = 'in_transit';
CREATE INDEX idx_alerts_open ON alerts (incident_id, created_at DESC) WHERE resolved_at IS NULL;
