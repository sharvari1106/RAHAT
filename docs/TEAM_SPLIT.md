# Team split (2 members)

The brief asks that both members work on **both** the database and the application, and that commits show who did what. Here is a suggested split along the two halves of the system. Each person owns their database objects **and** the pages and API routes that use them.

## Member 1: emergency response (SOS → dispatch)

| Layer | Files |
|---|---|
| Schema | `incidents`, `teams`, `sos_requests`, `sos_transitions`, `sos_status_history`, `dispatches`, `users` (in `sql/01_schema.sql`) |
| Functions / triggers | SOS state machine + history triggers, `fn_sos_priority`, `fn_find_duplicate_sos`, `fn_create_sos`, `sp_merge_duplicate`, `fn_suggest_teams`, `fn_dispatch_team`, `fn_auto_dispatch`, `fn_update_dispatch` |
| Views | `v_sos_queue`, `v_team_board`, `v_response_times`, `v_incident_summary` |
| Vector | SOS embeddings, duplicate detection, hybrid SOS search (RRF) |
| API | `app/api/public/{sos,track,incidents}`, `app/api/sos/**`, `app/api/teams/**`, `app/api/dispatches/**`, `app/api/my-task`, `app/api/auth/**`, `app/api/incidents/**`, `app/api/users/**` |
| Pages | `/help` (SOS tab), `/track`, `/login`, `/dashboard`, `/sos`, `/teams`, `/my-task`, `/admin` |
| Tests | T01–T25, T45–T48 |

## Member 2: relief (camps, supplies, missing persons)

| Layer | Files |
|---|---|
| Schema | `camps`, `depots`, `resources`, `stock`, `stock_movements`, `transfers`, `transfer_items`, `people`, `camp_stays`, `missing_reports`, `alerts` |
| Functions / triggers | camp depot trigger, capacity + occupancy triggers, stock ledger trigger, `fn_check_supply`, `fn_create_transfer`, `fn_close_transfer`, `fn_register_evacuee`, `sp_check_out`, `fn_match_score`, `fn_match_missing`, `sp_confirm_match`, `sp_refresh_dashboard` |
| Views | `v_depot_stock`, `v_camp_status`, `mv_daily_sitrep` |
| Vector / NoSQL | person + missing-report embeddings, trigram + vector matching; MongoDB field reports and activity log |
| API | `app/api/camps/**`, `app/api/stays/**`, `app/api/supplies/**`, `app/api/transfers/**`, `app/api/missing/**`, `app/api/public/missing`, `app/api/people`, `app/api/alerts/**`, `app/api/reports/**`, `app/api/field-reports` |
| Pages | `/help` (missing + camps tabs), `/camps`, `/camps/[id]`, `/supplies`, `/missing`, `/reports` |
| Tests | T26–T44 |

## Shared

`lib/*`, `middleware.js`, `components/Shell.js`, `components/MapView.js`, `sql/seed.sql`, `sql/05_important_queries.sql` (split by topic), README, report, and the demo.

## Git workflow

```bash
git checkout -b m1/sos-dispatch      # Member 1
git checkout -b m2/camps-supplies    # Member 2
# small commits as you study and extend each part, push, open a pull request, the other member reviews and merges
```

Never commit `.env`. It is in `.gitignore`.
