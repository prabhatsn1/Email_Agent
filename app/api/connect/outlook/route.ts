import { NextRequest, NextResponse } from 'next/server';
import { getVisitorId, hasVisitorCookie, VISITOR_COOKIE_NAME } from '@/lib/auth/visitor';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const SCOPES = [
  'openid',
  'email',
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/User.Read',
].join(' ');

export async function GET(request: NextRequest) {
  if (!process.env.MICROSOFT_CLIENT_ID) {
    return Response.json({ error: 'MICROSOFT_CLIENT_ID not configured' }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/connect/outlook/callback`;
  const state = crypto.randomUUID();
  const visitorId = getVisitorId(request);

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    response_mode: 'query',
    state,
  });

  const response = NextResponse.redirect(`${MS_AUTH_URL}?${params}`);
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  response.cookies.set('oauth_owner', visitorId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  if (!hasVisitorCookie(request)) {
    response.cookies.set(VISITOR_COOKIE_NAME, visitorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  return response;
}
