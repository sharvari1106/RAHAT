'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const CONTROL = [
  ['/dashboard', '🗺️', 'Situation room'],
  ['/sos', '🆘', 'SOS queue'],
  ['/teams', '🚤', 'Rescue teams'],
  ['/camps', '⛺', 'Relief camps'],
  ['/supplies', '📦', 'Supplies'],
  ['/missing', '🔎', 'Missing persons'],
  ['/reports', '📊', 'Reports'],
];

function navFor(user) {
  switch (user.role) {
    case 'admin':
      return [...CONTROL, ['/admin', '🛠️', 'Admin']];
    case 'coordinator':
      return CONTROL;
    case 'responder':
      return [['/my-task', '📍', 'My task']];
    case 'camp_manager':
      return [[`/camps/${user.campId}`, '⛺', 'My camp']];
    default:
      return [];
  }
}

export default function Shell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <b>RAHAT</b>
          <span>relief ops</span>
        </div>
        {user.unit && <div className="unit">{user.unit}</div>}
        <nav className="nav">
          {navFor(user).map(([href, icon, text]) => (
            <Link key={href} href={href} className={pathname === href || pathname.startsWith(href + '/') ? 'active' : ''}>
              <span aria-hidden>{icon}</span>
              {text}
            </Link>
          ))}
          <Link href="/help" target="_blank">
            <span aria-hidden>📣</span>Public SOS page
          </Link>
        </nav>
        <div className="who">
          <b>{user.name}</b>
          <span className="badge grey">{user.role.replace('_', ' ')}</span>
          <button className="small secondary" style={{ color: '#dfe6ef', borderColor: '#4d5d73', marginTop: 8 }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
