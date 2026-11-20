import { CONTROL_ROLES, handler, requireUser } from '@/lib/api';
import { query } from '@/lib/db';

// POST /api/reports/refresh - CALL sp_refresh_dashboard(): overdue-SOS alerts + REFRESH MATERIALIZED VIEW CONCURRENTLY
export const POST = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const t0 = Date.now();
  await query('CALL sp_refresh_dashboard()');
  return { ok: true, ms: Date.now() - t0 };
});
