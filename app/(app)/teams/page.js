'use client';
import MapView from '@/components/MapView';
import { api, ago, escapeHtml, label, TEAM_ICON, teamBadge, useApi } from '@/lib/client';

export default function TeamsPage() {
  const { data, error, reload } = useApi('/api/teams', { refreshMs: 20000 });
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  async function setDuty(t, status) {
    try {
      await api(`/api/teams/${t.team_id}`, { method: 'PATCH', body: { status } });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  const free = data.teams.filter((t) => t.status === 'available').length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rescue teams</h1>
          <p>
            {free} of {data.teams.length} teams free. A team can only be on one job at a time (partial unique index + row lock).
          </p>
        </div>
      </div>
      <div className="grid side">
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Status</th>
                <th>Current job</th>
                <th className="num">Jobs done</th>
                <th className="num">Rescued</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={t.team_id}>
                  <td>
                    {TEAM_ICON[t.kind]} <b>{t.name}</b>
                    <div className="small muted">
                      {label(t.kind)} · {t.members} members · carries {t.capacity}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${teamBadge(t.status)}`}>{label(t.status)}</span>
                  </td>
                  <td className="small">
                    {t.ticket ? (
                      <>
                        <a href={`/sos?open=${t.sos_id}`} className="ticket">{t.ticket}</a> · {label(t.dispatch_status)}
                        <div className="muted">
                          {t.minutes_on_job} min on job · ETA was {t.eta_minutes} min · {t.landmark}
                        </div>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="num">{t.jobs_done}</td>
                  <td className="num">{t.people_rescued}</td>
                  <td className="small muted">{ago(t.last_seen_at)}</td>
                  <td>
                    {t.status === 'available' && <button className="small secondary" onClick={() => setDuty(t, 'off_duty')}>Off duty</button>}
                    {t.status === 'off_duty' && <button className="small green" onClick={() => setDuty(t, 'available')}>On duty</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Positions</h2>
          <MapView
            fit
            className="map"
            points={data.teams.map((t) => ({
              lat: Number(t.cur_lat),
              lng: Number(t.cur_lng),
              color: t.status === 'available' ? '#2f9e5b' : t.status === 'off_duty' ? '#9aa4b2' : '#4a74c9',
              radius: 8,
              popup: `<b>${escapeHtml(t.name)}</b><br>${escapeHtml(label(t.status))}`,
            }))}
          />
        </div>
      </div>
    </>
  );
}
