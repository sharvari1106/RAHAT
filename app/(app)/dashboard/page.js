'use client';
import Link from 'next/link';
import { useState } from 'react';
import FieldReports from '@/components/FieldReports';
import MapView from '@/components/MapView';
import { api, daysBadge, escapeHtml, fmtDay, fmtNum, label, NEED_ICON, severityBadge, TEAM_ICON, useApi } from '@/lib/client';

const PRIO_COLOR = (p) => (p >= 60 ? '#c0262d' : p >= 35 ? '#f0a020' : '#2f9e5b');

export default function DashboardPage() {
  const { data, error, reload } = useApi('/api/dashboard', { refreshMs: 30000 });
  const [layers, setLayers] = useState({ sos: true, teams: true, camps: true });
  const [pick, setPick] = useState(null);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading situation picture...</p>;
  const s = data.summary;

  const points = [
    ...(layers.camps
      ? data.camps.map((c) => ({
          lat: Number(c.lat),
          lng: Number(c.lng),
          color: '#14213d',
          radius: 10,
          popup: `<b>⛺ ${escapeHtml(c.name)}</b><br>${c.occupancy}/${c.capacity} (${c.occupancy_pct}%)<br>${
            c.days_of_supply != null ? `${escapeHtml(c.shortest_resource)}: ${c.days_of_supply} days left` : ''
          }<br><a href="/camps/${c.camp_id}">open camp</a>`,
        }))
      : []),
    ...(layers.teams
      ? data.teams.map((t) => ({
          lat: Number(t.cur_lat),
          lng: Number(t.cur_lng),
          color: t.status === 'available' ? '#2f9e5b' : '#4a74c9',
          radius: 6,
          popup: `<b>${TEAM_ICON[t.kind] || ''} ${escapeHtml(t.name)}</b><br>${escapeHtml(label(t.status))}${t.ticket ? ` - ${escapeHtml(t.ticket)}` : ''}`,
        }))
      : []),
    ...(layers.sos
      ? data.sos.map((q) => ({
          lat: Number(q.lat),
          lng: Number(q.lng),
          color: q.assigned_team ? '#7d8796' : PRIO_COLOR(q.priority),
          radius: 5 + Math.min(6, q.people_count / 2),
          popup: `<b>${escapeHtml(q.ticket)}</b> priority ${q.priority}<br>${q.people_count} people - ${q.needs
            .map((n) => NEED_ICON[n])
            .join(' ')}<br>${escapeHtml(q.landmark || '')}<br>${q.assigned_team ? `Team: ${escapeHtml(q.assigned_team)}` : `waiting ${q.waiting_min} min`}<br><a href="/sos?open=${q.sos_id}">open</a>`,
        }))
      : []),
  ];

  async function ack(id) {
    await api(`/api/alerts/${id}`, { method: 'POST' });
    reload();
  }

  const maxDay = Math.max(1, ...data.sitrep.map((d) => Math.max(d.sos_received, d.sos_resolved)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{s.name}</h1>
          <p>
            {s.code} · {label(s.disaster_type)} · severity {s.severity}/5 · <span className="badge red">{s.status}</span> · refreshes every 30 s
          </p>
        </div>
        <Link href="/sos" className="btn">
          Open SOS queue →
        </Link>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi cls={s.sos_waiting > 0 ? 'kpi-red' : ''} label="SOS waiting" value={s.sos_waiting} sub="no team yet" />
        <Kpi label="Teams on jobs" value={s.sos_active} sub={`${data.teams.filter((t) => t.status === 'available').length} teams free`} />
        <Kpi cls="kpi-green" label="People rescued" value={fmtNum(s.people_rescued)} sub={`${s.sos_resolved} requests resolved`} />
        <Kpi label="People in camps" value={fmtNum(s.people_in_camps)} sub={`${s.camps_open} camps open`} />
        <Kpi cls={s.missing_open > 0 ? 'kpi-amber' : ''} label="Missing (open)" value={s.missing_open} sub="reports" />
        <Kpi cls={s.open_alerts > 0 ? 'kpi-amber' : ''} label="Open alerts" value={s.open_alerts} />
      </div>

      <div className="grid side" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Map</h2>
            <span className="spacer" />
            {Object.keys(layers).map((k) => (
              <label key={k} className={`chip ${layers[k] ? 'on' : ''}`}>
                <input type="checkbox" checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} />
                {k === 'sos' ? '🆘 SOS' : k === 'teams' ? '🚤 Teams' : '⛺ Camps'}
              </label>
            ))}
          </div>
          <MapView points={points} center={[Number(s.center_lat), Number(s.center_lng)]} zoom={10} fit onPick={(lat, lng) => setPick({ lat, lng })} picked={pick} />
          <div className="legend">
            <span><i style={{ background: '#c0262d' }} />urgent SOS</span>
            <span><i style={{ background: '#f0a020' }} />medium</span>
            <span><i style={{ background: '#2f9e5b' }} />low / team free</span>
            <span><i style={{ background: '#7d8796' }} />SOS with team</span>
            <span><i style={{ background: '#4a74c9' }} />team busy</span>
            <span><i style={{ background: '#14213d' }} />camp</span>
          </div>
        </div>
        <div className="card">
          <h2>Alerts</h2>
          {!data.alerts.length && <p className="muted">No open alerts.</p>}
          <div className="alert-list">
            {data.alerts.map((a) => (
              <div key={a.alert_id} className={`alert-item ${a.severity}`}>
                <span className={`badge ${severityBadge(a.severity)}`}>{label(a.kind)}</span>
                <span>
                  {a.link ? <Link href={a.link}>{a.message}</Link> : a.message}
                </span>
                <button className="small secondary" title="Acknowledge" onClick={() => ack(a.alert_id)}>
                  ✓
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Camps</h2>
          <table>
            <tbody>
              {data.camps.map((c) => (
                <tr key={c.camp_id}>
                  <td>
                    <Link href={`/camps/${c.camp_id}`}>{c.name}</Link>
                    <div className={`meter ${c.occupancy_pct >= 100 ? 'bad' : c.occupancy_pct >= 90 ? 'warn' : ''}`}>
                      <i style={{ width: `${Math.min(100, c.occupancy_pct)}%` }} />
                    </div>
                  </td>
                  <td className="num small">
                    {c.occupancy}/{c.capacity}
                  </td>
                  <td className="num">
                    <span className={`badge ${daysBadge(c.days_of_supply)}`} title={c.shortest_resource}>
                      {c.days_of_supply ?? '-'} d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Badge = days until the first critical item runs out.</p>
        </div>
        <div className="card">
          <h2>Needs right now</h2>
          <table>
            <thead>
              <tr>
                <th>Need</th>
                <th className="num">Waiting</th>
                <th className="num">Being served</th>
              </tr>
            </thead>
            <tbody>
              {data.needs.map((n) => (
                <tr key={n.need}>
                  <td>
                    {NEED_ICON[n.need]} {n.need}
                  </td>
                  <td className="num">{n.waiting}</td>
                  <td className="num">{n.active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Requests per day</h2>
          <div className="bars">
            {data.sitrep.map((d) => (
              <div className="bar" key={d.day}>
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%', width: '100%' }}>
                  <i style={{ height: `${(100 * d.sos_received) / maxDay}%`, flex: 1, background: 'var(--accent)' }} title={`${d.sos_received} received`} />
                  <i style={{ height: `${(100 * d.sos_resolved) / maxDay}%`, flex: 1 }} title={`${d.sos_resolved} resolved`} />
                </div>
                <span>{fmtDay(d.day)}</span>
              </div>
            ))}
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--accent)' }} />received</span>
            <span><i style={{ background: 'var(--ink)' }} />resolved</span>
          </div>
        </div>
      </div>

      <FieldReports picked={pick} />
    </>
  );
}

function Kpi({ label: text, value, sub, cls = '' }) {
  return (
    <div className={`card stat ${cls}`}>
      <span className="label">{text}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
