import { CONTROL_ROLES, handler, requireUser, resolveIncident } from '@/lib/api';
import { many, one } from '@/lib/db';
import { getMongo } from '@/lib/mongo';

// GET /api/reports?incident=1 - SQL analytics + MongoDB aggregation pipelines
export const GET = handler(async (request) => {
  await requireUser(request, CONTROL_ROLES);
  const inc = await resolveIncident(request, one);
  const [sitrep, byKind, byHour, areas, teams] = await Promise.all([
    many('SELECT * FROM mv_daily_sitrep WHERE incident_id = $1 ORDER BY day', [inc]),
    many(
      `SELECT kind, COUNT(*) AS jobs, SUM(people_rescued) AS rescued,
              ROUND(AVG(minutes_to_scene), 1) AS avg_min,
              ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes_to_scene))::NUMERIC, 1) AS median_min,
              ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY minutes_to_scene))::NUMERIC, 1) AS p90_min,
              ROUND(AVG(eta_error_min), 1) AS avg_eta_error
         FROM v_response_times WHERE incident_id = $1 AND status = 'completed'
        GROUP BY kind ORDER BY median_min`,
      [inc]
    ),
    many(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::INT AS hour, COUNT(*) AS n
         FROM sos_requests WHERE incident_id = $1 AND status <> 'duplicate' GROUP BY 1 ORDER BY 1`,
      [inc]
    ),
    many(
      `SELECT COALESCE(NULLIF(split_part(landmark, ' ', 2), ''), 'unknown') AS area, COUNT(*) AS requests,
              SUM(people_count) AS people, SUM(injured) AS injured,
              COUNT(*) FILTER (WHERE status IN ('new', 'triaged')) AS waiting
         FROM sos_requests WHERE incident_id = $1 AND status <> 'duplicate'
        GROUP BY 1 HAVING COUNT(*) >= 2 ORDER BY requests DESC LIMIT 12`,
      [inc]
    ),
    many(
      `SELECT name, kind, jobs_done, people_rescued, status FROM v_team_board ORDER BY people_rescued DESC`
    ),
  ]);

  // MongoDB aggregation pipelines (optional)
  let mongo = null;
  const db = await getMongo();
  if (db) {
    const [fieldByType, activity] = await Promise.all([
      db
        .collection('field_reports')
        .aggregate([
          { $match: { incidentId: inc } },
          {
            $group: {
              _id: '$type',
              reports: { $sum: 1 },
              latest: { $max: '$reportedAt' },
              maxWaterLevel: { $max: '$details.waterLevelM' },
              housesDamaged: { $sum: { $ifNull: ['$details.housesDamaged', 0] } },
            },
          },
          { $sort: { reports: -1 } },
        ])
        .toArray(),
      db
        .collection('activity_logs')
        .aggregate([
          { $match: { at: { $gte: new Date(Date.now() - 7 * 86400_000) } } },
          { $group: { _id: '$action', n: { $sum: 1 }, users: { $addToSet: '$userId' } } },
          { $project: { _id: 0, action: '$_id', n: 1, users: { $size: '$users' } } },
          { $sort: { n: -1 } },
          { $limit: 12 },
        ])
        .toArray(),
    ]);
    mongo = { fieldByType, activity };
  }
  return { incidentId: inc, sitrep, byKind, byHour, areas, teams, mongo };
});
