'use client';
import { useState } from 'react';
import { api, fmtDateTime, label } from '@/lib/client';

const STEPS = ['new', 'assigned', 'in_progress', 'resolved'];
const STEP_TEXT = { new: 'Received', assigned: 'Team assigned', in_progress: 'Team on scene', resolved: 'Resolved' };

export default function TrackTicket({ initialTicket = '' }) {
  const [ticket, setTicket] = useState(initialTicket);
  const [last4, setLast4] = useState('');
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setRes(null);
    try {
      setRes(await api(`/api/public/track?ticket=${encodeURIComponent(ticket.trim())}&phone=${encodeURIComponent(last4.trim())}`));
    } catch (err) {
      setError(err.message);
    }
  }

  const step = res?.kind === 'sos' ? STEPS.indexOf(res.status === 'triaged' ? 'new' : res.status) : -1;

  return (
    <div className="grid" style={{ gap: 12 }}>
      <form className="row" onSubmit={submit}>
        <input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="SOS-000012 or MP-000003" style={{ width: 200 }} required />
        <input value={last4} onChange={(e) => setLast4(e.target.value)} placeholder="last 4 digits of phone" inputMode="numeric" maxLength={4} style={{ width: 190 }} required />
        <button className="accent">Check status</button>
      </form>
      {error && <div className="alert error">{error}</div>}
      {res?.kind === 'sos' && (
        <div className="card">
          <div className="row">
            <span className="big-ticket">{res.ticket}</span>
            <span className="spacer" />
            <span className="muted small">reported {fmtDateTime(res.created_at)}</span>
          </div>
          {res.status === 'duplicate' ? (
            <div className="alert info">This request was merged with another request for the same place. Help is coming under that request.</div>
          ) : res.status === 'cancelled' ? (
            <div className="alert info">This request was closed by the control room. If you still need help, send a new SOS or call 112.</div>
          ) : (
            <div className="steps">
              {STEPS.map((s, i) => (
                <span key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
                  {STEP_TEXT[s]}
                </span>
              ))}
            </div>
          )}
          {res.team && (
            <p>
              <b>{res.team}</b> ({label(res.team_kind)}) is {res.dispatch_status === 'on_scene' ? 'with you' : 'on the way'}
              {res.dispatch_status !== 'on_scene' && res.eta_minutes != null && <> - about {res.eta_minutes} minutes from when it was sent ({fmtDateTime(res.assigned_at)})</>}.
            </p>
          )}
          {res.queue_rank && !res.team && (
            <p className="muted">Your request is number {res.queue_rank} in the queue. The most urgent requests (injured, children, elderly) are served first.</p>
          )}
        </div>
      )}
      {res?.kind === 'missing' && (
        <div className="card">
          <div className="big-ticket">{res.ticket}</div>
          <p>
            Report for <b>{res.full_name}</b>: <span className="badge blue">{label(res.status)}</span>
          </p>
          {res.status === 'open' && <p className="muted">We are checking every new camp registration against this report.</p>}
          {(res.status === 'matched' || res.status === 'reunited') && (
            <div className="alert ok">A person matching this report has been confirmed{res.camp_name ? ` at ${res.camp_name}` : ''}. The control room will call you.</div>
          )}
        </div>
      )}
    </div>
  );
}
