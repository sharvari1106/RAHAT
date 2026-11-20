'use client';
import { useEffect, useState } from 'react';
import { api, fmtDateTime, label, useApi } from '@/lib/client';

export default function MissingPage() {
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState(null);
  const list = useApi(`/api/missing?status=${status}`);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const people = useApi(search ? `/api/people?q=${encodeURIComponent(search)}` : null);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('report');
    if (r) setSelected(Number(r));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Missing persons</h1>
          <p>Reports are matched against everyone registered in a camp: name similarity (pg_trgm) + description similarity (pgvector).</p>
        </div>
      </div>
      <div className="grid side">
        <div className="card">
          <div className="tabs">
            {['open', 'matched', 'reunited', 'all'].map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{label(s)}</button>
            ))}
          </div>
          {list.error && <div className="alert error">{list.error}</div>}
          <table>
            <thead>
              <tr><th>Report</th><th>Missing person</th><th>Best candidate</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(list.data?.rows || []).map((r) => (
                <tr key={r.report_id} className={`clickable ${selected === r.report_id ? 'sel' : ''}`} onClick={() => setSelected(r.report_id)}>
                  <td><span className="ticket">{r.ticket}</span><div className="small muted">{fmtDateTime(r.created_at)}</div></td>
                  <td>
                    <b>{r.full_name}</b> {r.age != null && <span className="muted">({r.age})</span>}
                    <div className="small muted">{r.home_village} · last seen {r.last_seen_place || '?'}</div>
                  </td>
                  <td className="small">
                    {r.matched_name ? (
                      <>✅ {r.matched_name} · {r.matched_camp}</>
                    ) : r.best_name ? (
                      <>
                        <span className="score"><i style={{ width: `${Math.round(r.best_score * 100)}%` }} /></span>
                        {r.best_name} · {r.best_camp || 'not in a camp'} ({r.best_score})
                      </>
                    ) : '-'}
                  </td>
                  <td><span className="badge blue">{label(r.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && !list.data.rows.length && <p className="empty">No reports.</p>}

          <h2 style={{ marginTop: 20 }}>Search the camp registers</h2>
          <form className="row" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A name, or a description like 'old man white beard'" style={{ flex: 1 }} />
            <button className="secondary">Search</button>
          </form>
          {people.data && (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {people.data.rows.map((p) => (
                  <tr key={p.person_id}>
                    <td><b>{p.full_name}</b> <span className="muted">{p.age} · {p.gender}</span><div className="small muted">{p.marks}</div></td>
                    <td className="small">{p.home_village}</td>
                    <td className="small">{p.camp || 'checked out'}</td>
                    <td className="small muted">name sim {p.name_sim}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="detail">
          {selected ? <ReportDetail key={selected} id={selected} onChanged={list.reload} /> : <div className="card muted">Select a report.</div>}
        </div>
      </div>
    </>
  );
}

function ReportDetail({ id, onChanged }) {
  const { data, error, reload } = useApi(`/api/missing/${id}`);
  const [msg, setMsg] = useState(null);
  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="card muted">Loading...</div>;
  const r = data.report;

  async function act(body, text) {
    try {
      await api(`/api/missing/${id}`, { method: 'POST', body });
      setMsg({ ok: true, text });
      reload();
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <div className="card">
      <div className="row">
        <span className="ticket" style={{ fontSize: '1.2rem' }}>{r.ticket}</span>
        <span className="badge blue">{label(r.status)}</span>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      <h2 style={{ marginTop: 10 }}>{r.full_name}</h2>
      <p className="small">
        {r.age != null ? `${r.age} years` : 'age unknown'} · {r.gender} · from {r.home_village || '?'}
        <br />
        Last seen: {r.last_seen_place || '?'} {r.last_seen_at ? `at ${fmtDateTime(r.last_seen_at)}` : ''}
      </p>
      <p>{r.description}</p>
      <p className="small muted">
        Reported by {r.reporter_name} · <a href={`tel:${r.reporter_phone}`}>{r.reporter_phone}</a>
        {!r.has_embedding && ' · no embedding yet (run npm run db:embed)'}
      </p>

      {r.matched_name && (
        <div className="alert ok">
          Matched to <b>{r.matched_name}</b>{r.matched_camp ? ` at ${r.matched_camp}` : ''} by {r.matched_by_name} ({fmtDateTime(r.matched_at)}).
          {r.status === 'matched' && (
            <div style={{ marginTop: 6 }}>
              <button className="small green" onClick={() => act({ action: 'reunited' }, 'Marked as reunited.')}>Family reunited</button>
            </div>
          )}
        </div>
      )}

      {r.status === 'open' && (
        <>
          <h3 style={{ marginTop: 14 }}>Candidates</h3>
          <table className="small">
            <thead>
              <tr><th>Person</th><th>Why</th><th className="num">Score</th><th /></tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.person_id}>
                  <td>
                    <b>{c.full_name}</b> <span className="muted">{c.age ?? '?'} · {c.gender}</span>
                    <div className="muted">{c.home_village} · {c.camp_name || 'checked out'}</div>
                    {c.marks && <div className="muted">“{c.marks}”</div>}
                  </td>
                  <td className="muted">
                    name {c.name_similarity}
                    <br />
                    text {c.text_similarity ?? '-'}
                  </td>
                  <td className="num">
                    <span className="score"><i style={{ width: `${Math.round(c.score * 100)}%` }} /></span>
                    <b>{c.score}</b>
                  </td>
                  <td>
                    <button className="small accent" onClick={() => confirm(`Confirm that ${c.full_name} is ${r.full_name}?`) && act({ action: 'confirm', personId: c.person_id }, 'Match confirmed - call the family.')}>
                      Confirm
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">score = 0.45 × name similarity + 0.30 × description similarity + 0.15 × age closeness + 0.10 × gender</p>
          <button className="small danger" onClick={() => act({ action: 'close' }, 'Report closed.')}>Close report</button>
        </>
      )}
    </div>
  );
}
