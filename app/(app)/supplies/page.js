'use client';
import { useState } from 'react';
import { api, daysBadge, fmtDateTime, fmtNum, label, useApi } from '@/lib/client';

export default function SuppliesPage() {
  const { data, error, reload } = useApi('/api/supplies');
  const [don, setDon] = useState({ depotId: '', resourceId: '', quantity: '', note: '' });
  const [tr, setTr] = useState({ fromDepot: '', toDepot: '', vehicle: '', items: [{ resourceId: '', quantity: '' }] });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  const cell = {};
  for (const s of data.stock) cell[`${s.depot_id}:${s.resource_id}`] = s;

  async function run(fn, text) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text });
      reload();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function donate(e) {
    e.preventDefault();
    if (await run(() => api('/api/supplies/donations', { method: 'POST', body: don }), 'Stock received.')) setDon({ ...don, quantity: '', note: '' });
  }
  async function transfer(e) {
    e.preventDefault();
    const items = tr.items.filter((i) => i.resourceId && i.quantity);
    if (await run(() => api('/api/transfers', { method: 'POST', body: { ...tr, items } }), 'Truck dispatched - stock left the source depot.')) {
      setTr({ ...tr, vehicle: '', items: [{ resourceId: '', quantity: '' }] });
    }
  }
  const closeTransfer = (t, action) =>
    run(() => api(`/api/transfers/${t.transfer_id}`, { method: 'PATCH', body: { action } }), action === 'receive' ? `${t.code} received.` : `${t.code} cancelled - stock returned.`);

  const setItem = (i, k, v) => setTr({ ...tr, items: tr.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Supplies</h1>
          <p>Every change is a row in the append-only stock ledger; a trigger keeps the totals and refuses negative stock.</p>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="card table-wrap" style={{ marginBottom: 16 }}>
        <h2>Stock by depot</h2>
        <table>
          <thead>
            <tr>
              <th>Depot</th>
              {data.resources.map((r) => (
                <th key={r.resource_id} className="num" title={`${r.per_person_per_day} ${r.unit}/person/day`}>
                  {r.name}
                  <div style={{ textTransform: 'none', fontWeight: 400 }}>{r.unit}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.depots.map((d) => (
              <tr key={d.depot_id}>
                <td>
                  <b>{d.name}</b>
                  <div className="small muted">{d.kind === 'camp' ? `${d.occupancy} people` : 'warehouse'}</div>
                </td>
                {data.resources.map((r) => {
                  const s = cell[`${d.depot_id}:${r.resource_id}`];
                  return (
                    <td key={r.resource_id} className="num">
                      {fmtNum(s?.quantity)}
                      {s?.days_of_supply != null && r.critical && (
                        <div><span className={`badge ${daysBadge(s.days_of_supply)}`}>{s.days_of_supply} d</span></div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid two" style={{ marginBottom: 16 }}>
        <form className="card" onSubmit={transfer}>
          <h2>Send a truck</h2>
          <div className="form-grid">
            <label>
              From
              <select value={tr.fromDepot} onChange={(e) => setTr({ ...tr, fromDepot: e.target.value })} required>
                <option value="">choose...</option>
                {data.depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              To
              <select value={tr.toDepot} onChange={(e) => setTr({ ...tr, toDepot: e.target.value })} required>
                <option value="">choose...</option>
                {data.depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              Vehicle
              <input value={tr.vehicle} onChange={(e) => setTr({ ...tr, vehicle: e.target.value })} placeholder="KA-12-1234" />
            </label>
          </div>
          {tr.items.map((it, i) => (
            <div className="row" key={i} style={{ marginTop: 8 }}>
              <select value={it.resourceId} onChange={(e) => setItem(i, 'resourceId', e.target.value)} style={{ flex: 2 }}>
                <option value="">item...</option>
                {data.resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.name} ({r.unit})</option>)}
              </select>
              <input type="number" step="any" min={0} placeholder="qty" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} style={{ flex: 1 }} />
              {tr.items.length > 1 && (
                <button type="button" className="small secondary" onClick={() => setTr({ ...tr, items: tr.items.filter((_, j) => j !== i) })}>✕</button>
              )}
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="secondary small" onClick={() => setTr({ ...tr, items: [...tr.items, { resourceId: '', quantity: '' }] })}>+ item</button>
            <span className="spacer" />
            <button className="accent" disabled={busy}>Dispatch truck</button>
          </div>
        </form>

        <form className="card" onSubmit={donate}>
          <h2>Receive donation / purchase</h2>
          <div className="form-grid">
            <label>
              Depot
              <select value={don.depotId} onChange={(e) => setDon({ ...don, depotId: e.target.value })} required>
                <option value="">choose...</option>
                {data.depots.map((d) => <option key={d.depot_id} value={d.depot_id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              Item
              <select value={don.resourceId} onChange={(e) => setDon({ ...don, resourceId: e.target.value })} required>
                <option value="">choose...</option>
                {data.resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.name} ({r.unit})</option>)}
              </select>
            </label>
            <label>
              Quantity
              <input type="number" step="any" min={0.01} value={don.quantity} onChange={(e) => setDon({ ...don, quantity: e.target.value })} required />
            </label>
            <label>
              Source
              <input value={don.note} onChange={(e) => setDon({ ...don, note: e.target.value })} placeholder="e.g. Rotary club" />
            </label>
          </div>
          <button style={{ marginTop: 10 }} disabled={busy}>Add to stock</button>
        </form>
      </div>

      <div className="card">
        <h2>Transfers</h2>
        <table>
          <thead>
            <tr><th>Code</th><th>Route</th><th>Items</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {data.transfers.map((t) => (
              <tr key={t.transfer_id}>
                <td><b>{t.code}</b><div className="small muted">{fmtDateTime(t.created_at)} · {t.vehicle}</div></td>
                <td className="small">{t.from_depot} → {t.to_depot}</td>
                <td className="small">{t.items.map((i) => `${fmtNum(i.quantity)} ${i.unit} ${i.resource}`).join(', ')}</td>
                <td><span className={`badge ${t.status === 'in_transit' ? 'amber' : t.status === 'received' ? 'green' : 'grey'}`}>{label(t.status)}</span></td>
                <td className="num">
                  {t.status === 'in_transit' && (
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button className="small green" disabled={busy} onClick={() => closeTransfer(t, 'receive')}>Received</button>
                      <button className="small danger" disabled={busy} onClick={() => closeTransfer(t, 'cancel')}>Cancel</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
