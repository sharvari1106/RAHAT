'use client';
import Link from 'next/link';
import { useState } from 'react';
import MapView from '@/components/MapView';
import { api, daysBadge, escapeHtml, label, useApi } from '@/lib/client';

export default function CampsPage() {
  const { data, error, reload } = useApi('/api/camps');
  const [show, setShow] = useState(false);
  const [pick, setPick] = useState(null);
  const [f, setF] = useState({ name: '', kind: 'school', address: '', capacity: 100 });
  const [msg, setMsg] = useState(null);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  async function create(e) {
    e.preventDefault();
    if (!pick) return setMsg({ ok: false, text: 'Click the map to place the camp.' });
    try {
      await api('/api/camps', { method: 'POST', body: { ...f, incidentId: data.incidentId, lat: pick.lat, lng: pick.lng } });
      setMsg({ ok: true, text: `${f.name} opened. Its supply store was created automatically (trigger).` });
      setShow(false);
      setPick(null);
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const totalPeople = data.camps.reduce((a, c) => a + c.occupancy, 0);
  const totalCap = data.camps.filter((c) => c.status !== 'closed').reduce((a, c) => a + c.capacity, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Relief camps</h1>
          <p>
            {totalPeople} people in {data.camps.filter((c) => c.status !== 'closed').length} camps · {totalCap - totalPeople} places free
          </p>
        </div>
        <button className="accent" onClick={() => setShow(!show)}>
          {show ? 'Close' : '+ Open a camp'}
        </button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <div className="grid side">
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Camp</th>
                <th>Occupancy</th>
                <th className="num">Children</th>
                <th className="num">Elderly</th>
                <th className="num">Medical</th>
                <th>Supply</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.camps.map((c) => (
                <tr key={c.camp_id}>
                  <td>
                    <Link href={`/camps/${c.camp_id}`}>
                      <b>{c.name}</b>
                    </Link>
                    <div className="small muted">{label(c.kind)}</div>
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <div className="small">
                      {c.occupancy} / {c.capacity} ({c.occupancy_pct}%)
                    </div>
                    <div className={`meter ${c.occupancy_pct >= 100 ? 'bad' : c.occupancy_pct >= 90 ? 'warn' : ''}`}>
                      <i style={{ width: `${Math.min(100, c.occupancy_pct)}%` }} />
                    </div>
                  </td>
                  <td className="num">{c.children}</td>
                  <td className="num">{c.elderly}</td>
                  <td className="num">{c.needs_medical}</td>
                  <td>
                    <span className={`badge ${daysBadge(c.days_of_supply)}`}>{c.days_of_supply ?? '-'} days</span>
                    <div className="small muted">{c.shortest_resource}</div>
                  </td>
                  <td>
                    <span className={`badge ${c.status === 'open' ? 'green' : c.status === 'full' ? 'red' : 'grey'}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          {show ? (
            <form onSubmit={create} className="grid" style={{ gap: 10 }}>
              <h2>Open a camp</h2>
              <label>
                Name
                <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
              </label>
              <div className="form-grid">
                <label>
                  Kind
                  <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                    {['school', 'community_hall', 'temple', 'tent_city', 'stadium', 'other'].map((k) => (
                      <option key={k} value={k}>{label(k)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Capacity
                  <input type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} required />
                </label>
              </div>
              <label>
                Address
                <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              </label>
              <span className="small muted">{pick ? `Location: ${pick.lat}, ${pick.lng}` : 'Click the map to place the camp'}</span>
              <MapView className="map pick" fit points={data.camps.map((c) => ({ lat: Number(c.lat), lng: Number(c.lng), color: '#14213d' }))} onPick={(lat, lng) => setPick({ lat, lng })} picked={pick} />
              <button className="accent">Open camp</button>
            </form>
          ) : (
            <MapView
              fit
              points={data.camps.map((c) => ({
                lat: Number(c.lat),
                lng: Number(c.lng),
                color: c.status === 'full' ? '#c0262d' : c.status === 'closed' ? '#9aa4b2' : '#1d7a4c',
                radius: 6 + Math.min(10, c.occupancy / 40),
                popup: `<b>${escapeHtml(c.name)}</b><br>${c.occupancy}/${c.capacity}<br><a href="/camps/${c.camp_id}">open</a>`,
              }))}
            />
          )}
        </div>
      </div>
    </>
  );
}
