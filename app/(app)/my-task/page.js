'use client';
import { useState } from 'react';
import MapView from '@/components/MapView';
import { ago, api, escapeHtml, fmtDateTime, label, NEED_ICON, TEAM_ICON, teamBadge, useApi } from '@/lib/client';

const NEXT = { assigned: ['en_route', '🚦 Start - we are on the way'], en_route: ['on_scene', '📍 We have reached'], on_scene: ['completed', '✅ Job complete'] };

export default function MyTaskPage() {
  const { data, error, reload } = useApi('/api/my-task', { refreshMs: 15000 });
  const [people, setPeople] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  const { team, job } = data;

  function position() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
        () => resolve({}),
        { timeout: 5000 }
      );
    });
  }

  async function update(status) {
    if (status === 'completed' && people === '') return setMsg({ ok: false, text: 'Enter how many people you rescued or helped (0 if none).' });
    if (status === 'aborted' && !note.trim()) return setMsg({ ok: false, text: 'Write why you are aborting, so the next team knows.' });
    setBusy(true);
    setMsg(null);
    try {
      const pos = await position(); // team position is updated with every status change (if the phone allows)
      // positions outside India (e.g. testing from abroad) are left out
      const where = pos.lat >= 6 && pos.lat <= 37.5 && pos.lng >= 68 && pos.lng <= 97.5 ? pos : {};
      await api(`/api/dispatches/${job.dispatch_id}`, { method: 'PATCH', body: { status, peopleRescued: people, note: note || undefined, ...where } });
      setMsg({ ok: true, text: `Updated: ${label(status)}.` });
      setPeople('');
      setNote('');
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{TEAM_ICON[team.kind]} {team.name}</h1>
          <p>
            {team.members} members · carries {team.capacity} · <span className={`badge ${teamBadge(team.status)}`}>{label(team.status)}</span>
          </p>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      {!job ? (
        <div className="card empty">
          No job right now. Stay ready - this page refreshes by itself.
        </div>
      ) : (
        <div className="grid two">
          <div className="card">
            <div className="row">
              <span className="ticket" style={{ fontSize: '1.3rem' }}>{job.ticket}</span>
              <span className="badge blue">{label(job.status)}</span>
              <span className="spacer" />
              <span className="small muted">assigned {ago(job.assigned_at)}</span>
            </div>
            <p style={{ fontSize: '1.1rem' }}>{job.description}</p>
            <div className="row small" style={{ marginBottom: 10 }}>
              {job.needs.map((n) => <span key={n} className="badge blue">{NEED_ICON[n]} {n}</span>)}
            </div>
            <table className="small">
              <tbody>
                <tr><td>People</td><td><b>{job.people_count}</b> · {job.children} children · {job.elderly} elderly · {job.injured} injured</td></tr>
                <tr><td>Caller</td><td>{job.reporter_name} · <a href={`tel:${job.reporter_phone}`}>📞 {job.reporter_phone}</a></td></tr>
                <tr><td>Where</td><td>{job.landmark}</td></tr>
                <tr><td>Distance</td><td>{job.distance_km} km · ETA {job.eta_minutes} min (estimated when sent)</td></tr>
                <tr><td>Reported</td><td>{fmtDateTime(job.created_at)}</td></tr>
              </tbody>
            </table>
            <p>
              <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`} target="_blank" rel="noreferrer">
                🧭 Navigate
              </a>
            </p>
            <hr style={{ border: 'none', borderTop: '1px dashed var(--rule)' }} />
            {job.status === 'on_scene' && (
              <label style={{ marginBottom: 8 }}>
                People rescued / helped
                <input type="number" min={0} value={people} onChange={(e) => setPeople(e.target.value)} />
              </label>
            )}
            <label style={{ marginBottom: 8 }}>
              Note for the control room
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. two trips needed, road blocked at bridge" />
            </label>
            <div className="row">
              <button className="accent big" style={{ flex: 2 }} disabled={busy} onClick={() => update(NEXT[job.status][0])}>
                {NEXT[job.status][1]}
              </button>
              <button className="danger" disabled={busy} onClick={() => update('aborted')}>Abort</button>
            </div>
          </div>
          <div className="card">
            <MapView
              center={[Number(job.lat), Number(job.lng)]}
              zoom={12}
              fit
              points={[
                { lat: Number(job.lat), lng: Number(job.lng), color: '#e4572e', radius: 11, popup: escapeHtml(job.ticket) },
                { lat: Number(team.cur_lat), lng: Number(team.cur_lng), color: '#4a74c9', radius: 8, popup: 'your team' },
              ]}
            />
          </div>
        </div>
      )}

      {data.recent.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Recent jobs</h2>
          <table>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.dispatch_id}>
                  <td className="ticket">{r.ticket}</td>
                  <td>{r.landmark}</td>
                  <td><span className={`badge ${r.status === 'completed' ? 'green' : 'grey'}`}>{label(r.status)}</span></td>
                  <td className="num">{r.people_rescued ?? '-'} rescued</td>
                  <td className="small muted">{fmtDateTime(r.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
