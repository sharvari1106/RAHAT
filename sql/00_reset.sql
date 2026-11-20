-- RAHAT : 00_reset.sql - drops every object so the schema can be rebuilt from scratch.
-- WARNING: deletes all data.  Run by: npm run db:setup
DROP MATERIALIZED VIEW IF EXISTS mv_daily_sitrep CASCADE;
DROP VIEW IF EXISTS v_sos_queue, v_team_board, v_depot_stock, v_camp_status, v_response_times, v_incident_summary CASCADE;
DROP TABLE IF EXISTS alerts, missing_reports, camp_stays, people, stock_movements, transfer_items, transfers, stock,
                     resources, depots, dispatches, sos_status_history, sos_transitions, sos_requests, users, camps,
                     teams, incidents CASCADE;
DROP SEQUENCE IF EXISTS sos_ticket_seq, transfer_code_seq, missing_ticket_seq CASCADE;
DROP FUNCTION IF EXISTS fn_set_actor, fn_actor, fn_distance_km, fn_sos_priority, fn_team_fits, fn_team_speed_kmh,
                        fn_raise_alert, fn_resolve_alert, trg_append_only, trg_sos_before_update, trg_sos_log_status,
                        fn_find_duplicate_sos, fn_create_sos, fn_suggest_teams, fn_dispatch_team, fn_auto_dispatch,
                        fn_update_dispatch, trg_camp_create_depot, trg_stay_before_insert, trg_stay_after, fn_check_supply,
                        trg_movement_apply, fn_create_transfer, fn_close_transfer, fn_match_score, fn_match_missing,
                        fn_register_evacuee CASCADE;
DROP PROCEDURE IF EXISTS sp_merge_duplicate, sp_check_out, sp_confirm_match, sp_refresh_dashboard CASCADE;
DROP TYPE IF EXISTS disaster_type, incident_status, user_role, team_kind, team_status, sos_status, need_type, dispatch_status,
                    camp_status, depot_kind, resource_category, movement_reason, transfer_status, gender_type, missing_status,
                    alert_severity CASCADE;
