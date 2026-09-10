import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This middleware runs on the Edge runtime, which cannot access node:sqlite.
// It is intentionally only a fast UX redirect. Real authentication and
// authorization are enforced by requireUser()/requireRole() and Server Actions.
const COOKIE_NAME = 'syj_session';
const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith('/_next')) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const hasCookie = request.cookies.has(COOKIE_NAME);
  if (!hasCookie && pathname !== '/') {
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
};
