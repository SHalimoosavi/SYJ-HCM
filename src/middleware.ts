import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// NOTE: This middleware runs on the Edge runtime, which cannot access
// node:sqlite. It only checks whether a session cookie is present, purely
// as a fast UX redirect for the common case. It is NOT the authorization
// boundary - the real, database-backed check happens in
// src/app/(app)/layout.tsx via requireUser(), and in every Server Action via
// requireUserForAction()/requireRoleForAction() in src/lib/auth.ts. Do not
// rely on this file alone for security.

const COOKIE_NAME = 'syj_session';
const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  const hasCookie = request.cookies.has(COOKIE_NAME);
  if (!hasCookie && pathname !== '/') {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
};
