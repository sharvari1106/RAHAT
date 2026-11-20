# RAHAT: disaster relief coordination

During a flood or cyclone, a district control room has to answer four questions every minute:

- **Who needs help most urgently?**
- **Which rescue team is free and closest?**
- **Which relief camp still has space and supplies?**
- **Is this missing person already safe in one of our camps?**

RAHAT is one shared system for all four. The rules that keep people safe are enforced **inside the database**. For example, no team can be sent to two calls at once, no camp can be filled beyond its capacity, and supplies cannot go negative.

**Stack:** Next.js 15 · PostgreSQL 16 + pgvector + pg_trgm · MongoDB 7 (optional) · transformers.js (local multilingual embeddings) · Leaflet + OpenStreetMap

> DBMS Level 3 project (Option 2: SQL + vector database, plus MongoDB for field reports).
> - Full write-up: [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md)
> - ER diagram: [`docs/er-diagram.png`](docs/er-diagram.png)
> - Team split: [`docs/TEAM_SPLIT.md`](docs/TEAM_SPLIT.md)

---

## Quick start

**Requirements:** Node.js 20.6+ and one PostgreSQL database with pgvector. Any of these works:

- **Docker Desktop:** `docker compose up -d` starts PostgreSQL (with pgvector) on port 5434 and MongoDB on 27018.
- **Neon / Supabase (no Docker):** create a free project and paste its connection string into `DATABASE_URL`. pgvector and pg_trgm are available on both.

```bash
# 1. configuration
cp .env.example .env            # Windows: copy .env.example .env
#    set DATABASE_URL (Docker default already filled in, or your Neon string)
#    set JWT_SECRET to any random string of 32+ characters
#    leave MONGODB_URI empty if you are not running MongoDB

# 2. install, create schema, load the 3-day flood simulation, compute embeddings
npm install
npm run setup                   # = db:setup + db:seed + db:embed

# 3. run
npm run dev                     # open http://localhost:3000
```

- The first `db:embed` downloads the embedding model (~120 MB) once.
- **`npm run setup` wipes the database.** Run it only the first time, or when you want fresh demo data. Afterwards, only `npm run dev` is needed.

### Demo accounts

Every account uses the password `password123`. The login page has buttons that fill these in.

| Role | Mobile | What they see |
|---|---|---|
| Admin (control room) | 9000000001 | everything + incidents, users, teams |
| Coordinator | 9000000002 | situation room, SOS queue, teams, camps, supplies, missing persons, reports |
| Second coordinator | 9000000003 | same, for the two-window race demo |
| Responder (Boat Team Alpha lead) | 9000000101 | "My task": the team's live job |
| Camp manager (Madikeri camp) | 9000000201 | only their own camp |

**Citizens do not log in.** `/help` lets anyone send an SOS, report a missing person, or track a ticket.

---

## npm scripts

| Script | What it does |
|---|---|
| `npm run db:up` | `docker compose up -d` |
| `npm run db:setup` | drop + recreate the schema (`sql/00`–`03`) |
| `npm run db:seed` | simulated 3-day flood: 1 incident, 9 teams, 5 camps, 76 SOS, 813 evacuees, 5 missing reports, stock + transfers (+ MongoDB field reports if configured) |
| `npm run db:embed` | 384-d embeddings for SOS, people and missing reports, then prints two demos |
| `npm run db:test` | 48 database tests (`tests/db_tests.sql`), all rolled back |
| `npm run db:queries` | the 18 annotated important queries (`sql/05_important_queries.sql`) |
| `npm run db:alter-demo` | ALTER / DROP demonstration (rolled back) |
| `npm run db:refresh` | `CALL sp_refresh_dashboard()` and list open alerts |
| `npm run dev` / `build` / `start` | Next.js |

---

## What to demo (about 10 minutes)

1. **Public SOS:** open `/help` in a private window. Tick *Rescue*, type the situation in Kannada or Hindi, tap the map near Madikeri, and send. You get a ticket and your place in the queue. Track it on the *Track my request* tab with the last 4 digits of the phone.
2. **Triage queue:** log in as Coordinator → **SOS queue**. Requests are ranked by a SQL priority score (injured, children/elderly, group size, rescue/medical need, waiting time).
3. **Duplicates:** SOS-000075 and SOS-000076 are flagged *dup?*. Open one and choose *Yes - merge* or *No - different emergency*. Detection uses distance, phone number, and (after `db:embed`) multilingual vector similarity.
4. **Race condition:** open two browsers as 9000000002 and 9000000003. Pick two different waiting SOS and send **the same team** to both at the same moment. One succeeds; the other gets *"… is dispatched - pick another team"* (row locks in `fn_dispatch_team`).
5. **Auto-dispatch:** *⚡ Auto-dispatch top 5* uses `FOR UPDATE SKIP LOCKED`.
6. **Responder:** log in as 9000000101 → *My task*. Try *Job complete* without the number rescued; the database refuses it.
7. **Camps:** open *Govt Primary School, Napoklu* (full) and try to check someone in. The trigger refuses and names the nearest camp with space. *Temple Hall, Somwarpet* shows a low-water alert (1.2 days of supply).
8. **Supplies:** send a truck to Somwarpet, then receive it on the camp page (log in as camp manager 90000002**04**). The low-supply alert resolves itself.
9. **Missing persons:** MP-000001 "Ramesha K, 68, white beard" matches resident "Ramesh Kumar, 67" (name trigram + description vector + age + gender). Confirm it, then track MP-000001 publicly with phone digits `1111`.
10. **Reports:** daily situation report (materialized view), median and 90th-percentile response times, hotspots. *Refresh* calls the stored procedure.

---

## Project structure

```
rahat/
├── sql/
│   ├── 00_reset.sql                 DROP everything
│   ├── 01_schema.sql                16 enums, 18 tables, keys, CHECKs, ALTER, indexes (HNSW, GiST/GIN trigram, GIN FTS, BRIN, partial)
│   ├── 02_functions_triggers.sql    state machine, duplicate detection, dispatch, capacity, stock ledger, matching
│   ├── 03_views.sql                 6 views + materialized view mv_daily_sitrep
│   ├── 04_alter_drop_demo.sql       ALTER / DROP demonstration (rolled back)
│   ├── 05_important_queries.sql     18 queries grouped by topic + EXPLAIN
│   ├── seed.sql                     3-day flood simulation
│   └── refresh.sql                  CALL sp_refresh_dashboard()
├── tests/db_tests.sql               48 database tests
├── app/
│   ├── help/, track/                public pages (no login)
│   ├── login/
│   ├── (app)/                       dashboard, sos, teams, camps, camps/[id], supplies, missing, reports, admin, my-task
│   └── api/                         39 Route Handlers = backend API layer
├── components/                      Shell, MapView (Leaflet), SosForm, TrackTicket, FieldReports
├── lib/
│   ├── db.js                        pg pool + withTransaction (retry on deadlock)
│   ├── api.js / session.js          JWT sessions, role guard, PostgreSQL error → message
│   ├── sos.js                       SOS validation + embedding + fn_create_sos
│   ├── embeddings.js                transformers.js multilingual embeddings
│   ├── mongo.js                     MongoDB field reports + activity log
│   ├── validate.js                  input validation
│   └── client.js                    browser helpers
├── middleware.js                    page-level role-based access control
├── scripts/                         db-setup, seed, embed, run-sql
└── docs/                            PROJECT_REPORT.md, TEAM_SPLIT.md, er-diagram, architecture
```

## Security notes

- **Credentials:** they live only in `.env`, which is git-ignored; `.env.example` documents them.
- **Passwords and sessions:** passwords are hashed with bcrypt. Sessions are HS256 JWTs in an `httpOnly`, `sameSite=lax` cookie.
- **Roles:** checked twice, by `middleware.js` for pages and by `requireUser()` in every API route. Camp managers are limited to their own camp, and responders to their own team's job.
- **Queries:** every query is parameterised. Map pop-ups escape all text.
- **Public tracking:** needs both the ticket number and the last 4 digits of the reporter's phone, so tickets cannot be enumerated. The public SOS form is rate-limited per phone number.

## Troubleshooting

| Problem | Fix |
|---|---|
| `pgvector extension is not installed` | Use the Docker database, Neon or Supabase |
| `JWT_SECRET must be set …` | Set a 32+ character `JWT_SECRET` in `.env` and restart `npm run dev` |
| "The database already has data" on seed | `npm run db:setup` first (it resets everything) |
| Duplicate / missing matching ignores meaning | Run `npm run db:embed` (needs internet once) |
| Map is grey | The map tiles come from openstreetmap.org, so the browser needs internet |
| Field reports say MongoDB is off | Set `MONGODB_URI` (Docker: `mongodb://localhost:27018`) and restart |
| Port 5434 already used | Change the left side of `5434:5432` in `docker-compose.yml` and the port in `DATABASE_URL` |
