'use client';
// Public page: report an emergency, report a missing person, or track a ticket. No login.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import MapView from '@/components/MapView';
import SosForm from '@/components/SosForm';
import TrackTicket from '@/components/TrackTicket';
import { api, escapeHtml, useApi } from '@/lib/client';

export default function HelpPage() {
  const { data, error } = useApi('/api/public/incidents');
  const [tab, setTab] = useState('sos');
  const [incidentId, setIncidentId] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (['sos', 'missing', 'track', 'camps'].includes(t)) setTab(t);
  }, []);

  const incidents = data?.incidents || [];
  const incident = incidents.find((i) => i.incident_id === incidentId) || incidents[0];

  async function sendSos(body) {
    const r = await api('/api/public/sos', { method: 'POST', body });
    setDone({ kind: 'sos', phone: body.phone, ...r });
    window.scrollTo(0, 0);
  }

  return (
    <div className="public">
      <div className="public-head">
        <span className="logo">RAHAT</span>
        <div>
          <b>Emergency help</b>
          <div className="small muted">Life in danger right now? Also call 112.</div>
        </div>
        <span className="spacer" />
        <Link href="/login" className="small">
          Staff login
        </Link>
      </div>

      {error && <div className="alert error">{error}</div>}
      {data && !incidents.length && <div className="alert info">There is no active emergency at the moment.</div>}

      {done?.kind === 'sos' && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="small muted">Your request was received. Save this ticket number:</div>
          <div className="big-ticket">{done.ticket}</div>
          <p style={{ margin: '6px 0' }}>
            {done.queuePosition ? <>You are number <b>{done.queuePosition}</b> in the queue. </> : null}
            The most urgent requests are served first. Stay where you are if it is safe, and keep your phone on.
          </p>
          {done.similarExists && (
            <div className="alert info">A request from the same place was already received - the control room will treat them together.</div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Track it under &ldquo;Track my request&rdquo; with the ticket and the last 4 digits of {done.phone ? `${done.phone.slice(0, 2)}xxxx${done.phone.slice(-4)}` : 'your phone'}.
          </p>
        </div>
      )}

      {incidents.length > 1 && (
        <label style={{ maxWidth: 380, marginBottom: 12 }}>
          Which emergency?
          <select value={incident?.incident_id || ''} onChange={(e) => setIncidentId(Number(e.target.value))}>
            {incidents.map((i) => (
              <option key={i.incident_id} value={i.incident_id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="tabs">
        {[
          ['sos', '🆘 I need help'],
          ['missing', '🔎 Someone is missing'],
          ['track', '🎫 Track my request'],
          ['camps', '⛺ Relief camps'],
        ].map(([k, text]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'sos' && incident && (
        <div className="card">
          <SosForm incident={incident} onSubmit={sendSos} />
        </div>
      )}
      {tab === 'missing' && incident && <MissingForm incident={incident} />}
      {tab === 'track' && (
        <div className="card">
          <TrackTicket initialTicket={done?.ticket || ''} />
        </div>
      )}
      {tab === 'camps' && incident && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Open relief camps with free places. Food, water and medical help are available at every camp.</p>
          <MapView
            className="map small"
            center={[Number(incident.center_lat), Number(incident.center_lng)]}
            fit
            points={(data.camps || [])
              .filter((c) => c.incident_id === incident.incident_id)
              .map((c) => ({
                lat: Number(c.lat),
                lng: Number(c.lng),
                color: c.status === 'full' ? '#c0262d' : '#1d7a4c',
                radius: 9,
                popup: `<b>${escapeHtml(c.name)}</b><br>${escapeHtml(c.address || '')}<br>${c.status === 'full' ? 'FULL' : `${c.free_places} places free`}`,
              }))}
          />
          <table style={{ marginTop: 12 }}>
            <tbody>
              {(data.camps || [])
                .filter((c) => c.incident_id === incident.incident_id)
                .map((c) => (
                  <tr key={c.name}>
                    <td>
                      <b>{c.name}</b>
                      <div className="small muted">{c.address}</div>
                    </td>
                    <td className="num">{c.status === 'full' ? <span className="badge red">full</span> : <span className="badge green">{c.free_places} free</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MissingForm({ incident }) {
  const empty = { reporterName: '', reporterPhone: '', fullName: '', age: '', gender: 'unknown', village: '', lastSeenPlace: '', lastSeenAt: '', description: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api('/api/public/missing', { method: 'POST', body: { ...f, incidentId: incident.incident_id } });
      setMsg({
        ok: true,
        text: `Report ${r.ticket} saved. ${r.possibleMatch ? 'Someone similar is already registered at a camp - the control room will verify and call you.' : 'Every new camp registration is checked against your report.'}`,
      });
      setF(empty);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card grid" style={{ gap: 12 }} onSubmit={submit}>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <h3>The missing person</h3>
      <div className="form-grid">
        <label>
          Full name
          <input value={f.fullName} onChange={set('fullName')} required />
        </label>
        <label>
          Age
          <input type="number" min={0} max={120} value={f.age} onChange={set('age')} />
        </label>
        <label>
          Gender
          <select value={f.gender} onChange={set('gender')}>
            <option value="unknown">-</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Home village / area
          <input value={f.village} onChange={set('village')} />
        </label>
        <label>
          Last seen where
          <input value={f.lastSeenPlace} onChange={set('lastSeenPlace')} />
        </label>
        <label>
          Last seen when
          <input type="datetime-local" value={f.lastSeenAt} onChange={set('lastSeenAt')} />
        </label>
        <label className="wide">
          How to recognise them (clothes, marks, glasses...)
          <textarea rows={2} value={f.description} onChange={set('description')} required minLength={5} />
        </label>
      </div>
      <h3>You</h3>
      <div className="form-grid">
        <label>
          Your name
          <input value={f.reporterName} onChange={set('reporterName')} required />
        </label>
        <label>
          Your mobile
          <input value={f.reporterPhone} onChange={set('reporterPhone')} inputMode="numeric" required />
        </label>
      </div>
      <button className="accent big" disabled={busy}>
        {busy ? 'Saving...' : 'Report missing person'}
      </button>
    </form>
  );
}
