'use client';
import { useState } from 'react';
import { api, label, useApi } from '@/lib/client';

export default function AdminPage() {
  const users = useApi('/api/users');
  const incidents = useApi('/api/incidents');
  const [u, setU] = useState({ name: '', phone: '', password: '', role: 'coordinator', teamId: '', campId: '' });
  const [inc, setInc] = useState({ code: 'INC-2026-002', name: '', disasterType: 'flood', severity: 3, lat: '', lng: '', radiusKm: 30 });
  const [team, setTeam] = useState({ name: '', kind: 'boat', members: 5, capacity: 10, lat: '', lng: '' });
  const [msg, setMsg] = useState(null);

  async function run(fn, text, after) {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text });
      after?.();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>Incidents, user accounts and teams.</p>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Incidents</h2>
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Type</th><th className="num">Severity</th><th className="num">SOS</th><th className="num">In camps</th><th>Status</th></tr>
          </thead>
          <tbody>
            {(incidents.data?.incidents || []).map((i) => (
              <tr key={i.incident_id}>
                <td className="mono">{i.code}</td>
                <td>{i.name}</td>
                <td>{label(i.disaster_type)}</td>
                <td className="num">{i.severity}</td>
                <td className="num">{i.sos_total}</td>
                <td className="num">{i.people_in_camps}</td>
                <td>
                  <select
                    value={i.status}
                    onChange={(e) =>
                      run(() => api(`/api/incidents/${i.incident_id}`, { method: 'PATCH', body: { status: e.target.value } }), 'Incident updated.', incidents.reload)
                    }
                  >
                    {['monitoring', 'active', 'recovery', 'closed'].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="form-grid"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('/api/incidents', { method: 'POST', body: inc }), 'Incident declared.', incidents.reload);
          }}
        >
          <label>Code<input value={inc.code} onChange={(e) => setInc({ ...inc, code: e.target.value })} placeholder="INC-2026-002" /></label>
          <label>Name<input value={inc.name} onChange={(e) => setInc({ ...inc, name: e.target.value })} required /></label>
          <label>
            Type
            <select value={inc.disasterType} onChange={(e) => setInc({ ...inc, disasterType: e.target.value })}>
              {['flood', 'cyclone', 'earthquake', 'landslide', 'fire', 'drought', 'other'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Severity (1-5)<input type="number" min={1} max={5} value={inc.severity} onChange={(e) => setInc({ ...inc, severity: e.target.value })} /></label>
          <label>Centre latitude<input value={inc.lat} onChange={(e) => setInc({ ...inc, lat: e.target.value })} required /></label>
          <label>Centre longitude<input value={inc.lng} onChange={(e) => setInc({ ...inc, lng: e.target.value })} required /></label>
          <label>Radius km<input type="number" value={inc.radiusKm} onChange={(e) => setInc({ ...inc, radiusKm: e.target.value })} /></label>
          <label>&nbsp;<button className="accent">Declare incident</button></label>
        </form>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Users</h2>
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>Unit</th><th /></tr></thead>
            <tbody>
              {(users.data?.users || []).map((x) => (
                <tr key={x.user_id} style={{ opacity: x.active ? 1 : 0.5 }}>
                  <td>{x.name}</td>
                  <td className="mono">{x.phone}</td>
                  <td><span className="badge grey">{label(x.role)}</span></td>
                  <td className="small">{x.team || x.camp || '-'}</td>
                  <td>
                    <button
                      className="small secondary"
                      onClick={() => run(() => api(`/api/users/${x.user_id}`, { method: 'PATCH', body: { active: !x.active } }), 'Updated.', users.reload)}
                    >
                      {x.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api('/api/users', { method: 'POST', body: u }), `Account created for ${u.name}.`, () => {
                setU({ ...u, name: '', phone: '', password: '' });
                users.reload();
              });
            }}
          >
            <h2>New account</h2>
            <div className="form-grid">
              <label>Name<input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} required /></label>
              <label>Mobile<input value={u.phone} onChange={(e) => setU({ ...u, phone: e.target.value })} required /></label>
              <label>Password (8+)<input type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} required minLength={8} /></label>
              <label>
                Role
                <select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}>
                  {['coordinator', 'responder', 'camp_manager', 'admin'].map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              </label>
              {u.role === 'responder' && (
                <label>
                  Team
                  <select value={u.teamId} onChange={(e) => setU({ ...u, teamId: e.target.value })} required>
                    <option value="">choose...</option>
                    {(users.data?.teams || []).map((t) => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
                  </select>
                </label>
              )}
              {u.role === 'camp_manager' && (
                <label>
                  Camp
                  <select value={u.campId} onChange={(e) => setU({ ...u, campId: e.target.value })} required>
                    <option value="">choose...</option>
                    {(users.data?.camps || []).map((c) => <option key={c.camp_id} value={c.camp_id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <button className="accent" style={{ marginTop: 10 }}>Create account</button>
          </form>
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api('/api/teams', { method: 'POST', body: team }), `${team.name} registered.`, users.reload);
            }}
          >
            <h2>New team</h2>
            <div className="form-grid">
              <label>Name<input value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} required /></label>
              <label>
                Kind
                <select value={team.kind} onChange={(e) => setTeam({ ...team, kind: e.target.value })}>
                  {['boat', 'search_rescue', 'medical', 'supply'].map((k) => <option key={k} value={k}>{label(k)}</option>)}
                </select>
              </label>
              <label>Members<input type="number" value={team.members} onChange={(e) => setTeam({ ...team, members: e.target.value })} /></label>
              <label>Carries (people)<input type="number" value={team.capacity} onChange={(e) => setTeam({ ...team, capacity: e.target.value })} /></label>
              <label>Base latitude<input value={team.lat} onChange={(e) => setTeam({ ...team, lat: e.target.value })} required /></label>
              <label>Base longitude<input value={team.lng} onChange={(e) => setTeam({ ...team, lng: e.target.value })} required /></label>
            </div>
            <button style={{ marginTop: 10 }}>Register team</button>
          </form>
        </div>
      </div>
    </>
  );
}
