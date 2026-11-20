-- =====================================================================
-- RAHAT : 04_alter_drop_demo.sql
-- Demonstrates ALTER and DROP on a live schema. Runs in a transaction
-- and is rolled back, so it never changes the demo database.
--   npm run db:alter-demo
-- =====================================================================
BEGIN;

\echo '1. ALTER TABLE ... ADD COLUMN with a CHECK: record the water level reported with each SOS'
ALTER TABLE sos_requests ADD COLUMN water_level_m NUMERIC(4,2) CHECK (water_level_m BETWEEN 0 AND 15);
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'sos_requests' AND column_name = 'water_level_m';

\echo '2. ALTER TABLE ... ALTER COLUMN: allow longer identifying descriptions, and set a default'
ALTER TABLE people ALTER COLUMN marks TYPE VARCHAR(500);
ALTER TABLE resources ALTER COLUMN unit SET DEFAULT 'kg';

\echo '3. ALTER TABLE ... ADD CONSTRAINT: a named rule on depot names'
ALTER TABLE depots ADD CONSTRAINT chk_depot_name_len CHECK (length(name) >= 3);

\echo '4. ALTER TABLE ... RENAME COLUMN, then rename back'
ALTER TABLE camps RENAME COLUMN address TO full_address;
ALTER TABLE camps RENAME COLUMN full_address TO address;

\echo '5. CREATE + DROP INDEX'
CREATE INDEX idx_demo_people_village ON people (home_village);
DROP INDEX idx_demo_people_village;

\echo '6. CREATE + DROP VIEW'
CREATE VIEW v_demo_open_teams AS SELECT name, kind FROM teams WHERE status = 'available';
SELECT * FROM v_demo_open_teams;
DROP VIEW v_demo_open_teams;

\echo '7. ALTER TABLE ... DROP COLUMN and DROP TABLE'
ALTER TABLE sos_requests DROP COLUMN water_level_m;
CREATE TABLE demo_scratch (id INT PRIMARY KEY);
DROP TABLE demo_scratch;

\echo '8. DROP CONSTRAINT (and see that the rule is gone), then ROLLBACK restores everything'
ALTER TABLE depots DROP CONSTRAINT chk_depot_name_len;

ROLLBACK;
\echo 'Rolled back - schema unchanged.'
