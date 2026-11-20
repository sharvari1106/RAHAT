'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import TrackTicket from '@/components/TrackTicket';

// /track?ticket=SOS-000012 - shareable status page
export default function TrackPage() {
  const [ticket, setTicket] = useState(null);
  useEffect(() => setTicket(new URLSearchParams(window.location.search).get('ticket') || ''), []);
  return (
    <div className="public">
      <div className="public-head">
        <span className="logo">RAHAT</span>
        <b>Track a request</b>
        <span className="spacer" />
        <Link href="/help" className="small">
          Report an emergency
        </Link>
      </div>
      <div className="card">{ticket !== null && <TrackTicket initialTicket={ticket} />}</div>
    </div>
  );
}
