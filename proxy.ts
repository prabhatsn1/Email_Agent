import { NextRequest, NextResponse } from 'next/server';
import { VISITOR_COOKIE_NAME } from '@/lib/auth/visitor';

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(VISITOR_COOKIE_NAME)?.value;
  if (existing) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(VISITOR_COOKIE_NAME, crypto.randomUUID(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
