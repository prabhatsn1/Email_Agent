import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/mongo';
import { EmailAccountModel } from '@/lib/db/models/EmailAccount';
import { getVisitorId, hasVisitorCookie, VISITOR_COOKIE_NAME } from '@/lib/auth/visitor';

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/dashboard?error=outlook_denied`);
  }

  const savedState = request.cookies.get('oauth_state')?.value;
  const oauthOwner = request.cookies.get('oauth_owner')?.value;
  const visitorId = oauthOwner || getVisitorId(request);
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${origin}/dashboard?error=oauth_state_mismatch`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/dashboard?error=no_code`);
  }

  try {
    const redirectUri = `${origin}/api/connect/outlook/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'https://graph.microsoft.com/Mail.Read offline_access User.Read',
      }),
    });

    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (!tokenRes.ok || !tokens.access_token) {
      throw new Error(tokens.error ?? 'Token exchange failed');
    }

    // Get user info from Microsoft Graph
    const meRes = await fetch(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = (await meRes.json()) as {
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
    };

    const email = (me.mail ?? me.userPrincipalName ?? '').toLowerCase();
    if (!email) throw new Error('Could not retrieve Outlook address');

    // Upsert EmailAccount
    await connectDB();
    await EmailAccountModel.findOneAndUpdate(
      { ownerId: visitorId, provider: 'outlook', email },
      {
        ownerId: visitorId,
        provider: 'outlook',
        email,
        name: me.displayName,
        accessToken: tokens.access_token,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
      { upsert: true, new: true }
    );

    const response = NextResponse.redirect(`${origin}/dashboard?connected=outlook`);
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_owner');
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
  } catch (err) {
    console.error('[outlook/callback]', err);
    return NextResponse.redirect(
      `${origin}/dashboard?error=${encodeURIComponent(String(err))}`
    );
  }
}
