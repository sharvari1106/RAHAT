'use client';
import { useEffect, useState } from 'react';
import MapView from '@/components/MapView';
import SosForm from '@/components/SosForm';
import {
  ago, api, escapeHtml, fmtDateTime, label, NEED_ICON, priorityBadge, sosBadge, TEAM_ICON, useApi,
} from '@/lib/client';

export default function SosPage() {
  const [view, setView] = useState('open');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get('open');
    if (open) setSelected(Number(open));
  }, []);

  const listPath = query ? `/api/sos?q=${encodeURIComponent(query)}` : `/api/sos?view=${view}`;
  const list = useApi(listPath, { refreshMs: query ? 0 : 20000 });
  const incidents = useApi('/api/incidents');
  const incident = incidents.data?.incidents?.find((i) => i.incident_id === list.data?.incidentId);

  async function autoDispatch() {
    if (!incident) return;
    try {
      const r = await api('/api/sos/auto-dispatch', { method: 'POST', body: { incidentId: incident.incident_id, max: 5 } });
      setMsg({
        ok: true,
        text: r.assigned.length
          ? `Auto-dispatch sent ${r.assigned.length} team(s): ${r.assigned.map((a) => `${a.ticket} → ${a.team_name} (${a.distance_km} km)`).join(', ')}`
          : 'No free team fits any waiting request right now.',
      });
      list.reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  async function logCall(body) {
    const r = await api('/api/sos', { method: 'POST', body: { ...body, channel: 'helpline' } });
    setShowNew(false);
    setMsg({ ok: true, text: `Logged ${r.ticket}.${r.dup_ticket ? ` Possible duplicate of ${r.dup_ticket} (${r.dup_reason}).` : ''}` });
    setSelected(r.sos_id);
    list.reload();
  }

  const rows = list.data?.rows || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SOS queue</h1>
          <p>Ranked by priority: injured, children and elderly, group size, rescue/medical need, and waiting time.</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Close form' : '☎️ Log helpline call'}
          </button>
          <button className="accent" onClick={autoDispatch} title="Send the nearest fitting free team to the top requests">
            ⚡ Auto-dispatch top 5
          </button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      {showNew && incident && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Helpline call</h2>
          <SosForm incident={incident} onSubmit={logCall} submitLabel="Log SOS" compact />
        </div>
      )}

      <div className="grid side">
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
              {['open', 'closed'].map((v) => (
                <button key={v} className={!query && view === v ? 'on' : ''} onClick={() => { setQuery(''); setQ(''); setView(v); }}>
                  {v === 'open' ? 'Open queue' : 'Closed'}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="row">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: ticket, phone, words or meaning" style={{ width: 280 }} />
              <button className="secondary small">Search</button>
            </form>
          </div>
          {query && (
            <p className="small muted">
              Results for &ldquo;{query}&rdquo; - full-text + {list.data?.semantic ? 'semantic (multilingual vectors)' : 'no semantic (embeddings off)'}, fused with RRF.{' '}
              <button className="small secondary" onClick={() => { setQuery(''); setQ(''); }}>Clear</button>
            </p>
          )}
          {list.error && <div className="alert error">{list.error}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {!query && view === 'open' && <th>#</th>}
                  {!query && view === 'open' && <th>Prio</th>}
                  <th>Ticket</th>
                  <th>Situation</th>
                  <th className="num">People</th>
                  <th>{query ? 'Matched by' : view === 'open' ? 'Waiting' : 'Closed'}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sos_id} className={`clickable ${selected === r.sos_id ? 'sel' : ''}`} onClick={() => setSelected(r.sos_id)}>
                    {!query && view === 'open' && <td className="muted">{r.queue_rank}</td>}
                    {!query && view === 'open' && (
                      <td>
                        <span className={`prio ${priorityBadge(r.priority)}`}>{r.priority}</span>
                      </td>
                    )}
                    <td>
                      <span className="ticket">{r.ticket}</span>
                      {r.suspected_dup_ticket && <div><span className="badge amber">dup? {r.suspected_dup_ticket}</span></div>}
                    </td>
                    <td>
                      <div className="small">{r.needs.map((n) => NEED_ICON[n]).join(' ')} {r.landmark}</div>
                      <div className="small muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.description}
                      </div>
                    </td>
                    <td className="num">
                      {r.people_count}
                      {r.injured > 0 && <div className="small" style={{ color: 'var(--red)' }}>{r.injured} injured</div>}
                    </td>
                    <td className="small">
                      {query ? r.matched_by : view === 'open' ? (r.assigned_team || `${r.waiting_min} min`) : ago(r.updated_at)}
                    </td>
                    <td>
                      <span className={`badge ${sosBadge(r.status)}`}>{label(r.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.data && !rows.length && <p className="empty">Nothing here.</p>}
        </div>

        <div className="detail">
          {selected ? (
            <SosDetail key={selected} id={selected} onChanged={() => list.reload()} onSelect={setSelected} />
          ) : (
            <div className="card muted">Select a request to see details, suggested teams and possible duplicates.</div>
          )}
        </div>
      </div>
    </>
  );
}

function SosDetail({ id, onChanged, onSelect }) {
  const { data, error, reload } = useApi(`/api/sos/${id}`);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="card muted">Loading...</div>;
  const s = data.sos;
  const open = ['new', 'triaged'].includes(s.status);

  async function act(fn, okText) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      reload();
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      reload();
    } finally {
      setBusy(false);
    }
  }

  const dispatch = (t) => act(() => api(`/api/sos/${id}/dispatch`, { method: 'POST', body: { teamId: t.team_id } }), `${t.name} dispatched.`);
  const merge = (origId, origTicket) =>
    act(() => api(`/api/sos/${id}/merge`, { method: 'POST', body: { originalId: origId } }), `Merged into ${origTicket}.`);
  const status = (action, note) => act(() => api(`/api/sos/${id}/status`, { method: 'POST', body: { action, note } }), 'Updated.');

  return (
    <div className="card">
      <div className="row">
        <span className="ticket" style={{ fontSize: '1.2rem' }}>{s.ticket}</span>
        <span className={`badge ${sosBadge(s.status)}`}>{label(s.status)}</span>
        <span className="spacer" />
        {open && <span className={`prio ${priorityBadge(s.priority)}`} title="priority">{s.priority}</span>}
      </div>
      <p className="small muted" style={{ margin: '4px 0 10px' }}>
        {label(s.channel)} · {fmtDateTime(s.created_at)} ({ago(s.created_at)}){s.queue_rank ? ` · queue #${s.queue_rank}` : ''}
      </p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <p style={{ fontSize: '1.02rem' }}>{s.description}</p>
      <div className="row small" style={{ marginBottom: 8 }}>
        {s.needs.map((n) => (
          <span key={n} className="badge blue">{NEED_ICON[n]} {n}</span>
        ))}
      </div>
      <table className="small" style={{ marginBottom: 10 }}>
        <tbody>
          <tr><td>People</td><td><b>{s.people_count}</b> · {s.children} children · {s.elderly} elderly · <span style={{ color: s.injured ? 'var(--red)' : undefined }}>{s.injured} injured</span></td></tr>
          <tr><td>Caller</td><td>{s.reporter_name} · <a href={`tel:${s.reporter_phone}`}>{s.reporter_phone}</a></td></tr>
          <tr><td>Where</td><td>{s.landmark || '-'} <span className="mono muted">({s.lat}, {s.lng})</span></td></tr>
        </tbody>
      </table>
      <MapView
        className="map small"
        center={[Number(s.lat), Number(s.lng)]}
        zoom={12}
        points={[
          { lat: Number(s.lat), lng: Number(s.lng), color: '#e4572e', radius: 10, popup: escapeHtml(s.ticket) },
        ]}
      />

      {s.suspected_dup_of && open && (
        <div className="alert info" style={{ marginTop: 12 }}>
          Flagged automatically as a possible duplicate of{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onSelect(s.suspected_dup_of); }}>{s.suspected_dup_ticket}</a>.
          <div className="row" style={{ marginTop: 6 }}>
            <button className="small" disabled={busy} onClick={() => merge(s.suspected_dup_of, s.suspected_dup_ticket)}>Yes - merge</button>
            <button className="small secondary" disabled={busy} onClick={() => status('not_duplicate')}>No - different emergency</button>
          </div>
        </div>
      )}
      {s.duplicate_of_ticket && <div className="alert info">Merged into {s.duplicate_of_ticket}.</div>}

      {open && data.duplicates.filter((d) => d.sos_id !== s.suspected_dup_of).length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Other requests nearby</h3>
          <table className="small">
            <tbody>
              {data.duplicates.filter((d) => d.sos_id !== s.suspected_dup_of).map((d) => (
                <tr key={d.sos_id}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); onSelect(d.sos_id); }}>{d.ticket}</a></td>
                  <td>{d.distance_m} m · {d.reason}{d.similarity != null ? ` · sim ${d.similarity}` : ''}</td>
                  <td className="num"><button className="small secondary" disabled={busy} onClick={() => merge(d.sos_id, d.ticket)}>merge into</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {open && (
        <>
          <h3 style={{ marginTop: 14 }}>Send a team</h3>
          {!data.suggestions.length && <p className="small muted">No team is free right now.</p>}
          <table className="small">
            <tbody>
              {data.suggestions.map((t) => (
                <tr key={t.team_id} style={{ opacity: t.fits ? 1 : 0.5 }}>
                  <td>
                    {TEAM_ICON[t.kind]} <b>{t.name}</b>
                    <div className="muted">{t.members} people · carries {t.capacity}{t.capacity < s.people_count ? ' (needs 2 trips)' : ''}</div>
                  </td>
                  <td className="num">{t.distance_km} km<div className="muted">~{t.eta_minutes} min</div></td>
                  <td className="num">
                    {t.fits ? (
                      <button className="small accent" disabled={busy} onClick={() => dispatch(t)}>Send</button>
                    ) : (
                      <span className="muted">does not fit</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            {s.status === 'new' && <button className="small secondary" disabled={busy} onClick={() => status('triaged')}>Mark as verified</button>}
            <button
              className="small danger"
              disabled={busy}
              onClick={() => {
                const note = prompt('Why is this request being cancelled?', 'Family reached safety on their own');
                if (note) status('cancel', note);
              }}
            >
              Cancel request
            </button>
          </div>
        </>
      )}

      {data.dispatches.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Teams sent</h3>
          <table className="small">
            <tbody>
              {data.dispatches.map((d) => (
                <tr key={d.dispatch_id}>
                  <td>{TEAM_ICON[d.kind]} {d.team}<div className="muted">by {d.assigned_by || 'auto'} · {fmtDateTime(d.assigned_at)}</div></td>
                  <td>
                    <span className="badge blue">{label(d.status)}</span>
                    {d.people_rescued != null && <div className="muted">{d.people_rescued} rescued</div>}
                    {d.notes && <div className="muted">{d.notes}</div>}
                  </td>
                  <td>
                    {['assigned', 'en_route', 'on_scene'].includes(d.status) && (
                      <DispatchButtons dispatch={d} onDone={() => { reload(); onChanged(); }} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ marginTop: 14 }}>History</h3>
      <ul className="timeline">
        {data.history.map((h, i) => (
          <li key={i}>
            <b>{label(h.to_status)}</b> <span className="muted">{fmtDateTime(h.changed_at)}{h.by_name ? ` · ${h.by_name}` : ''}</span>
            {h.note && <div className="muted">{h.note}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// a coordinator updating a job after a radio call
function DispatchButtons({ dispatch, onDone }) {
  const next = { assigned: 'en_route', en_route: 'on_scene', on_scene: 'completed' }[dispatch.status];
  async function go(status) {
    const body = { status };
    if (status === 'completed') {
      const n = prompt('How many people were rescued / helped?', '0');
      if (n === null) return;
      body.peopleRescued = n;
    }
    if (status === 'aborted') {
      const note = prompt('Why is the job aborted?');
      if (!note) return;
      body.note = note;
    }
    try {
      await api(`/api/dispatches/${dispatch.dispatch_id}`, { method: 'PATCH', body });
      onDone();
    } catch (err) {
      alert(err.message);
    }
  }
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="small" onClick={() => go(next)}>{label(next)}</button>
      <button className="small danger" onClick={() => go('aborted')}>abort</button>
    </div>
  );
}
