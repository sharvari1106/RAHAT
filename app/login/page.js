'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/client';

const DEMO = [
  ['Admin', '9000000001'],
  ['Coordinator', '9000000002'],
  ['Responder (Boat Team Alpha)', '9000000101'],
  ['Camp manager (Madikeri)', '9000000201'],
];

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: { phone, password } });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : res.home;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <section className="login-art">
        <h1>
          RAHAT<span>.</span>
        </h1>
        <p style={{ fontSize: '1.15rem', margin: 0 }}>One operations picture for a disaster response.</p>
        <ul>
          <li>SOS triage queue ranked by urgency, with automatic duplicate detection in any language</li>
          <li>Send the nearest free rescue team - never two teams to one call, never one team to two</li>
          <li>Relief camps that refuse to overfill and warn before food or water runs out</li>
          <li>Supplies tracked depot to depot on an append-only ledger</li>
          <li>Missing-person reports matched against camp registers by name and description</li>
        </ul>
        <p className="note">
          Citizen in trouble? <Link href="/help" style={{ color: '#fff' }}>Report an emergency without logging in →</Link>
        </p>
      </section>
      <section className="login-form">
        <form className="card" onSubmit={submit}>
          <h2>Staff log in</h2>
          <label>
            Mobile number
            <input inputMode="numeric" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="accent big" disabled={busy}>
            {busy ? 'Checking...' : 'Log in'}
          </button>
          <div className="demo-logins muted">
            Demo accounts (password <span className="mono">password123</span>):
            <div>
              {DEMO.map(([text, ph]) => (
                <button
                  type="button"
                  key={ph}
                  className="small secondary"
                  onClick={() => {
                    setPhone(ph);
                    setPassword('password123');
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
