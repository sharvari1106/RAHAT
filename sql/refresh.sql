CALL sp_refresh_dashboard();
SELECT kind, severity, message FROM alerts WHERE resolved_at IS NULL ORDER BY severity DESC, created_at DESC;
