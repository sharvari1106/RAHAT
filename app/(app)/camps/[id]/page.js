'use client';
import { use, useState } from 'react';
import { api, daysBadge, fmtDateTime, fmtNum, label, useApi } from '@/lib/client';

const EMPTY = { fullName: '', age: '', gender: 'unknown', phone: '', village: '', marks: '', needsMedical: false };

export default function CampPage({ params }) {
  const { id } = use(params);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, reload } = useApi(`/api/camps/${id}${search ? `?q=${encodeURIComponent(search)}` : ''}`);
  const me = useApi('/api/auth/me');
  const [p, setP] = useState(EMPTY);
  const [dist, setDist] = useState({ resourceId: '', quantity: '', peopleServed: '', reason: 'distributed', note: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;
  const c = data.camp;
  const control = ['admin', 'coordinator'].includes(me.data?.user?.role);

  async function run(fn, okText) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: typeof okText === 'function' ? okText(r) : okText });
      reload();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function register(e) {
    e.preventDefault();
    const ok = await run(
      () => api(`/api/camps/${id}/residents`, { method: 'POST', body: p }),
      (r) =>
        `${p.fullName} checked in.${r.possible_matches ? ` ⚠ Looks like ${r.possible_matches} open missing-person report(s) - the control room has been alerted.` : ''}`
    );
    if (ok) setP(EMPTY);
  }

  async function distribute(e) {
    e.preventDefault();
    const ok = await run(() => api(`/api/camps/${id}/distribute`, { method: 'POST', body: dist }), 'Recorded in the stock ledger.');
    if (ok) setDist({ ...dist, quantity: '', peopleServed: '', note: '' });
  }

  function checkout(r) {
    const reason = prompt('Reason: returned_home, moved_camp, hospital, with_family, deceased', 'returned_home');
    if (!reason) return;
    run(() => api(`/api/stays/${r.stay_id}/checkout`, { method: 'POST', body: { reason: reason.trim() } }), `${r.full_name} checked out.`);
  }

  const receive = (t) => run(() => api(`/api/transfers/${t.transfer_id}`, { method: 'PATCH', body: { action: 'receive' } }), `${t.code} received - stock added.`);

  function changeCapacity() {
    const v = prompt('New capacity', String(c.capacity));
    if (v) run(() => api(`/api/camps/${id}`, { method: 'PATCH', body: { capacity: v } }), 'Capacity updated.');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          <p>
            {label(c.kind)} · <span className={`badge ${c.status === 'open' ? 'green' : c.status === 'full' ? 'red' : 'grey'}`}>{c.status}</span>
          </p>
        </div>
        {control && (
          <div className="row">
            <button className="secondary small" onClick={changeCapacity}>Change capacity</button>
            {c.status !== 'closed' && (
              <button className="danger small" onClick={() => confirm('Close this camp?') && run(() => api(`/api/camps/${id}`, { method: 'PATCH', body: { status: 'closed' } }), 'Camp closed.')}>
                Close camp
              </button>
            )}
          </div>
        )}
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <div className={`card stat ${c.occupancy_pct >= 100 ? 'kpi-red' : c.occupancy_pct >= 90 ? 'kpi-amber' : ''}`}>
          <span className="label">Occupancy</span>
          <span className="value">{c.occupancy} / {c.capacity}</span>
          <div className={`meter ${c.occupancy_pct >= 100 ? 'bad' : c.occupancy_pct >= 90 ? 'warn' : ''}`}>
            <i style={{ width: `${Math.min(100, c.occupancy_pct)}%` }} />
          </div>
        </div>
        <div className="card stat"><span className="label">Children</span><span className="value">{c.children}</span></div>
        <div className="card stat"><span className="label">Elderly</span><span className="value">{c.elderly}</span></div>
        <div className="card stat"><span className="label">Need medical care</span><span className="value">{c.needs_medical}</span></div>
        <div className={`card stat ${c.days_of_supply < 1.5 ? 'kpi-red' : ''}`}>
          <span className="label">Supply lasts</span>
          <span className="value">{c.days_of_supply ?? '-'} days</span>
          <span className="sub">{c.shortest_resource} runs out first</span>
        </div>
      </div>

      {data.incoming.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <h2>🚚 Trucks on the way</h2>
          <table>
            <tbody>
              {data.incoming.map((t) => (
                <tr key={t.transfer_id}>
                  <td><b>{t.code}</b><div className="small muted">from {t.from_depot} · {t.vehicle} · sent {fmtDateTime(t.created_at)}</div></td>
                  <td className="small">{t.items.map((i) => `${fmtNum(i.quantity)} ${i.unit} ${i.resource}`).join(', ')}</td>
                  <td className="num"><button className="green small" disabled={busy} onClick={() => receive(t)}>Received</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid two" style={{ marginBottom: 16 }}>
        <form className="card" onSubmit={register}>
          <h2>Register an arrival</h2>
          <div className="form-grid">
            <label className="wide">
              Full name
              <input value={p.fullName} onChange={(e) => setP({ ...p, fullName: e.target.value })} required />
            </label>
            <label>
              Age
              <input type="number" min={0} max={120} value={p.age} onChange={(e) => setP({ ...p, age: e.target.value })} />
            </label>
            <label>
              Gender
              <select value={p.gender} onChange={(e) => setP({ ...p, gender: e.target.value })}>
                <option value="unknown">-</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Phone
              <input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} inputMode="numeric" />
            </label>
            <label>
              Home village
              <input value={p.village} onChange={(e) => setP({ ...p, village: e.target.value })} />
            </label>
            <label className="wide">
              Identifying details (clothes, marks) - used to match missing-person reports
              <input value={p.marks} onChange={(e) => setP({ ...p, marks: e.target.value })} />
            </label>
            <label className="row" style={{ flexDirection: 'row' }}>
              <input type="checkbox" checked={p.needsMedical} onChange={(e) => setP({ ...p, needsMedical: e.target.checked })} /> needs medical care
            </label>
          </div>
          <button className="accent" style={{ marginTop: 10 }} disabled={busy}>Check in</button>
        </form>

        <form className="card" onSubmit={distribute}>
          <h2>Distribute / write off supplies</h2>
          <div className="form-grid">
            <label>
              Item
              <select value={dist.resourceId} onChange={(e) => setDist({ ...dist, resourceId: e.target.value })} required>
                <option value="">choose...</option>
                {data.resources.map((r) => (
                  <option key={r.resource_id} value={r.resource_id}>{r.name} ({r.unit})</option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input type="number" step="any" min={0.01} value={dist.quantity} onChange={(e) => setDist({ ...dist, quantity: e.target.value })} required />
            </label>
            <label>
              What happened
              <select value={dist.reason} onChange={(e) => setDist({ ...dist, reason: e.target.value })}>
                <option value="distributed">Distributed</option>
                <option value="damaged">Damaged / spoiled</option>
              </select>
            </label>
            {dist.reason === 'distributed' && (
              <label>
                People served
                <input type="number" min={1} value={dist.peopleServed} onChange={(e) => setDist({ ...dist, peopleServed: e.target.value })} required />
              </label>
            )}
            <label className="wide">
              Note
              <input value={dist.note} onChange={(e) => setDist({ ...dist, note: e.target.value })} />
            </label>
          </div>
          <button style={{ marginTop: 10 }} disabled={busy}>Record</button>
          <p className="small muted">The database refuses to give out more than the camp store holds.</p>
        </form>
      </div>

      <div className="grid two">
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Residents</h2>
            <span className="spacer" />
            <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="row">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name (fuzzy)" />
              <button className="small secondary">Find</button>
            </form>
          </div>
          <table>
            <thead>
              <tr><th>Name</th><th className="num">Age</th><th>From</th><th>Since</th><th /></tr>
            </thead>
            <tbody>
              {data.residents.map((r) => (
                <tr key={r.stay_id}>
                  <td>
                    {r.full_name} {r.needs_medical && <span className="badge red">medical</span>}
                    {r.sim != null && <span className="small muted"> · sim {r.sim}</span>}
                  </td>
                  <td className="num">{r.age ?? '-'}</td>
                  <td className="small">{r.home_village || '-'}</td>
                  <td className="small muted">{fmtDateTime(r.checked_in_at)}</td>
                  <td><button className="small secondary" onClick={() => checkout(r)}>Check out</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!search && c.occupancy > data.residents.length && <p className="small muted">Showing the latest {data.residents.length}. Search to find anyone.</p>}
        </div>
        <div className="card">
          <h2>Camp store</h2>
          <table>
            <thead>
              <tr><th>Item</th><th className="num">In stock</th><th className="num">Lasts</th></tr>
            </thead>
            <tbody>
              {data.stock.map((s) => (
                <tr key={s.resource_id}>
                  <td>{s.resource} {s.critical && <span className="badge amber">critical</span>}</td>
                  <td className="num">{fmtNum(s.quantity, 1)} {s.unit}</td>
                  <td className="num">{s.days_of_supply != null ? <span className={`badge ${daysBadge(s.days_of_supply)}`}>{s.days_of_supply} d</span> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 14 }}>Ledger (latest)</h3>
          <table className="small">
            <tbody>
              {data.movements.map((m, i) => (
                <tr key={i}>
                  <td className="muted">{fmtDateTime(m.created_at)}</td>
                  <td>{label(m.reason)}</td>
                  <td>{m.resource}</td>
                  <td className="num" style={{ color: m.qty_change < 0 ? 'var(--red)' : 'var(--green)' }}>
                    {m.qty_change > 0 ? '+' : ''}{fmtNum(m.qty_change, 1)} {m.unit}
                  </td>
                  <td className="muted">{m.people_served ? `${m.people_served} people` : m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
