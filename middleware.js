// Page-level access control. API routes do their own checks with requireUser().
import { NextResponse } from 'next/server';
import { PAGE_ROLES, PUBLIC_PAGES, SESSION_COOKIE, roleHome, verifySessionToken } from './lib/session.js';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login' && session) {
    return NextResponse.redirect(new URL(roleHome(session), request.url));
  }
  // public pages: citizens report an emergency or track a ticket without an account
  if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  if (!session) {
    if (pathname === '/') return NextResponse.redirect(new URL('/help', request.url));
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL(roleHome(session), request.url));
  }

  const rule = PAGE_ROLES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.redirect(new URL(roleHome(session), request.url));
  }
  return NextResponse.next();
}

export const config = {
  // everything except API routes, Next.js internals and static files
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg)$).*)'],
};
