'use client';
import { useState } from 'react';
import { api, fmtDay, fmtNum, label, TEAM_ICON, useApi } from '@/lib/client';

export default function ReportsPage() {
  const { data, error, reload } = useApi('/api/reports');
  const [msg, setMsg] = useState(null);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  async function refresh() {
    try {
      const r = await api('/api/reports/refresh', { method: 'POST' });
      setMsg({ ok: true, text: `CALL sp_refresh_dashboard() finished in ${r.ms} ms: overdue-SOS alerts raised and mv_daily_sitrep refreshed concurrently.` });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const maxHour = Math.max(1, ...data.byHour.map((h) => h.n));
  const hours = Array.from({ length: 24 }, (_, h) => data.byHour.find((x) => x.hour === h)?.n || 0);
  const maxRescued = Math.max(1, ...data.teams.map((t) => t.people_rescued));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Daily situation report (materialized view), response-time percentiles, hotspots and MongoDB aggregations.</p>
        </div>
        <button className="accent" onClick={refresh}>↻ Refresh materialized view</button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="card table-wrap" style={{ marginBottom: 16 }}>
        <h2>Daily situation report</h2>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">SOS received</th>
              <th className="num">People reported</th>
              <th className="num">Resolved</th>
              <th className="num">People rescued</th>
              <th className="num">Median response</th>
              <th className="num">90th pct response</th>
              <th className="num">Camp check-ins</th>
              <th className="num">Cumulative</th>
              <th className="num">Relief servings</th>
            </tr>
          </thead>
          <tbody>
            {data.sitrep.map((d) => (
              <tr key={d.day}>
                <td>{fmtDay(d.day)}</td>
                <td className="num">{d.sos_received}</td>
                <td className="num">{d.people_reported}</td>
                <td className="num">{d.sos_resolved}</td>
                <td className="num">{d.people_rescued}</td>
                <td className="num">{d.median_response_min != null ? `${d.median_response_min} min` : '-'}</td>
                <td className="num">{d.p90_response_min != null ? `${d.p90_response_min} min` : '-'}</td>
                <td className="num">{d.camp_checkins}</td>
                <td className="num">{d.cumulative_checkins}</td>
                <td className="num">{fmtNum(d.relief_servings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Response time by team type</h2>
          <table>
            <thead>
              <tr><th>Team type</th><th className="num">Jobs</th><th className="num">Rescued</th><th className="num">Average</th><th className="num">Median</th><th className="num">90th pct</th><th className="num">ETA error</th></tr>
            </thead>
            <tbody>
              {data.byKind.map((k) => (
                <tr key={k.kind}>
                  <td>{TEAM_ICON[k.kind]} {label(k.kind)}</td>
                  <td className="num">{k.jobs}</td>
                  <td className="num">{k.rescued}</td>
                  <td className="num">{k.avg_min} min</td>
                  <td className="num">{k.median_min} min</td>
                  <td className="num">{k.p90_min} min</td>
                  <td className="num">{k.avg_eta_error != null ? `${k.avg_eta_error > 0 ? '+' : ''}${k.avg_eta_error} min` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Response = SOS received → team on scene (PERCENTILE_CONT). ETA error = actual travel minus the estimate.</p>
        </div>
        <div className="card">
          <h2>SOS by hour of day</h2>
          <div className="bars">
            {hours.map((n, h) => (
              <div className="bar" key={h}>
                <i style={{ height: `${(100 * n) / maxHour}%` }} title={`${n} requests`} />
                <span>{h % 3 === 0 ? h : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Hotspots (GROUP BY ... HAVING COUNT(*) ≥ 2)</h2>
          <table>
            <thead>
              <tr><th>Area</th><th className="num">Requests</th><th className="num">People</th><th className="num">Injured</th><th className="num">Waiting</th></tr>
            </thead>
            <tbody>
              {data.areas.map((a) => (
                <tr key={a.area}>
                  <td>{a.area}</td>
                  <td className="num">{a.requests}</td>
                  <td className="num">{a.people}</td>
                  <td className="num">{a.injured}</td>
                  <td className="num">{a.waiting > 0 ? <span className="badge red">{a.waiting}</span> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Teams - people rescued</h2>
          {data.teams.map((t) => (
            <div className="hbar" key={t.name}>
              <span>{TEAM_ICON[t.kind]} {t.name}</span>
              <span className="track"><i style={{ width: `${(100 * t.people_rescued) / maxRescued}%` }} /></span>
              <span className="num small">{t.people_rescued} · {t.jobs_done} jobs</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>MongoDB aggregations</h2>
        {!data.mongo ? (
          <p className="muted">MongoDB is not configured, so field-report and activity-log aggregations are skipped.</p>
        ) : (
          <div className="grid two">
            <div>
              <h3>Field reports by type ($group)</h3>
              <table>
                <thead><tr><th>Type</th><th className="num">Reports</th><th className="num">Max water level</th><th className="num">Houses damaged</th></tr></thead>
                <tbody>
                  {data.mongo.fieldByType.map((r) => (
                    <tr key={r._id}>
                      <td>{label(r._id)}</td>
                      <td className="num">{r.reports}</td>
                      <td className="num">{r.maxWaterLevel != null ? `${r.maxWaterLevel} m` : '-'}</td>
                      <td className="num">{r.housesDamaged || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3>Activity in the last 7 days ($group + $addToSet)</h3>
              <table>
                <thead><tr><th>Action</th><th className="num">Times</th><th className="num">Users</th></tr></thead>
                <tbody>
                  {data.mongo.activity.map((a) => (
                    <tr key={a.action}>
                      <td className="mono">{a.action}</td>
                      <td className="num">{a.n}</td>
                      <td className="num">{a.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
