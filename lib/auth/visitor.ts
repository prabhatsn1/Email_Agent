import { NextRequest } from 'next/server';

export const VISITOR_COOKIE_NAME = 'visitor_id';

export function getVisitorId(request: NextRequest): string {
  const existing = request.cookies.get(VISITOR_COOKIE_NAME)?.value;
  return existing && existing.trim().length > 0 ? existing : crypto.randomUUID();
}

export function hasVisitorCookie(request: NextRequest): boolean {
  return Boolean(request.cookies.get(VISITOR_COOKIE_NAME)?.value);
}
