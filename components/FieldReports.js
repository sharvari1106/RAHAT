'use client';
// Field situation reports (MongoDB documents with type-specific fields).
import { useState } from 'react';
import { ago, api, label, useApi } from '@/lib/client';

export default function FieldReports({ picked }) {
  const { data, reload } = useApi('/api/field-reports');
  const [type, setType] = useState('water_level');
  const [details, setDetails] = useState({});
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState(null);

  if (!data) return null;
  if (!data.available) {
    return (
      <div className="card">
        <h2>Field reports</h2>
        <p className="muted small">MongoDB is not configured (MONGODB_URI is empty), so field reports are switched off. Everything else works.</p>
      </div>
    );
  }
  const fields = data.types[type]?.fields || {};

  async function submit(e) {
    e.preventDefault();
    if (!picked) return setMsg({ ok: false, text: 'Click the map above to set where this report is from.' });
    try {
      await api('/api/field-reports', { method: 'POST', body: { type, lat: picked.lat, lng: picked.lng, note, details } });
      setMsg({ ok: true, text: 'Report saved.' });
      setDetails({});
      setNote('');
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <div className="grid two">
      <form className="card" onSubmit={submit}>
        <h2>New field report</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Stored in MongoDB - each type has its own fields. Location: {picked ? `${picked.lat}, ${picked.lng}` : 'click the map'}
        </p>
        <div className="form-grid">
          <label>
            Type
            <select value={type} onChange={(e) => { setType(e.target.value); setDetails({}); }}>
              {Object.entries(data.types).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {Object.entries(fields).map(([k, kind]) => (
            <label key={k}>
              {k}
              {kind === 'boolean' ? (
                <select value={details[k] ?? ''} onChange={(e) => setDetails({ ...details, [k]: e.target.value })}>
                  <option value="">-</option>
                  <option value="true">yes</option>
                  <option value="false">no</option>
                </select>
              ) : (
                <input type={kind === 'number' ? 'number' : 'text'} step="any" value={details[k] ?? ''} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} />
              )}
            </label>
          ))}
          <label className="wide">
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
        </div>
        {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
        <button className="accent" style={{ marginTop: 10 }}>
          Save report
        </button>
      </form>
      <div className="card">
        <h2>Latest field reports</h2>
        {!data.reports.length && <p className="muted">None yet.</p>}
        <table>
          <tbody>
            {data.reports.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="badge blue">{label(r.type)}</span>
                  <div className="small muted">{ago(r.reportedAt)}</div>
                </td>
                <td className="small">
                  {Object.entries(r.details || {}).map(([k, v]) => (
                    <div key={k}>
                      {k}: <b>{String(v)}</b>
                    </div>
                  ))}
                  {r.note && <div className="muted">{r.note}</div>}
                </td>
                <td className="small muted">{r.reportedBy?.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
