'use client';
// SOS form shared by the public help page and the control room (helpline calls).
import { useState } from 'react';
import MapView from '@/components/MapView';
import { NEEDS, NEED_ICON } from '@/lib/client';

const EMPTY = { name: '', phone: '', people: 1, children: 0, elderly: 0, injured: 0, needs: [], description: '', landmark: '' };

export default function SosForm({ incident, onSubmit, submitLabel = 'Send SOS', compact = false }) {
  const [f, setF] = useState(EMPTY);
  const [pos, setPos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locMsg, setLocMsg] = useState('');

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleNeed = (n) => setF({ ...f, needs: f.needs.includes(n) ? f.needs.filter((x) => x !== n) : [...f.needs, n] });

  function useMyLocation() {
    if (!navigator.geolocation) return setLocMsg('This browser cannot share location. Tap the map instead.');
    setLocMsg('Finding you...');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) });
        setLocMsg(`Location found (accuracy about ${Math.round(p.coords.accuracy)} m).`);
      },
      () => setLocMsg('Could not get your location. Tap your position on the map instead.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!pos) return setError('Mark where you are: use "Use my location" or tap the map.');
    if (!f.needs.length) return setError('Choose at least one kind of help.');
    setBusy(true);
    try {
      await onSubmit({ ...f, incidentId: incident.incident_id, lat: pos.lat, lng: pos.lng });
      setF(EMPTY);
      setPos(null);
      setLocMsg('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
      <div className="chips">
        {NEEDS.map(([k, text]) => (
          <label key={k} className={`chip ${f.needs.includes(k) ? 'on' : ''}`}>
            <input type="checkbox" checked={f.needs.includes(k)} onChange={() => toggleNeed(k)} />
            {NEED_ICON[k]} {text}
          </label>
        ))}
      </div>
      <label>
        What is happening? (any language)
        <textarea rows={compact ? 2 : 3} value={f.description} onChange={set('description')} required minLength={5} maxLength={1000}
          placeholder="e.g. Water has entered the house, 4 of us are on the roof / ಮನೆಗೆ ನೀರು ನುಗ್ಗಿದೆ / ghar mein paani" />
      </label>
      <div className="form-grid">
        <label>
          Your name
          <input value={f.name} onChange={set('name')} required minLength={2} maxLength={80} />
        </label>
        <label>
          Mobile number
          <input value={f.phone} onChange={set('phone')} inputMode="numeric" required placeholder="10 digits" />
        </label>
        <label>
          People with you
          <input type="number" min={1} max={500} value={f.people} onChange={set('people')} required />
        </label>
        <label>
          Children (under 12)
          <input type="number" min={0} max={500} value={f.children} onChange={set('children')} />
        </label>
        <label>
          Elderly (60+)
          <input type="number" min={0} max={500} value={f.elderly} onChange={set('elderly')} />
        </label>
        <label>
          Injured
          <input type="number" min={0} max={500} value={f.injured} onChange={set('injured')} />
        </label>
        <label className="wide">
          Nearby landmark
          <input value={f.landmark} onChange={set('landmark')} maxLength={160} placeholder="e.g. behind the temple, near the river bridge" />
        </label>
      </div>
      <div>
        <div className="row" style={{ marginBottom: 6 }}>
          <button type="button" className="secondary small" onClick={useMyLocation}>
            📍 Use my location
          </button>
          <span className="small muted">{locMsg || 'or tap your position on the map'}</span>
          <span className="spacer" />
          {pos && (
            <span className="small mono">
              {pos.lat}, {pos.lng}
            </span>
          )}
        </div>
        <MapView
          className="map pick"
          center={[Number(incident.center_lat), Number(incident.center_lng)]}
          zoom={10}
          picked={pos}
          onPick={(lat, lng) => {
            setPos({ lat, lng });
            setLocMsg('Location set from the map.');
          }}
        />
      </div>
      {error && <div className="alert error">{error}</div>}
      <button className="accent big" disabled={busy}>
        {busy ? 'Sending...' : submitLabel}
      </button>
    </form>
  );
}
