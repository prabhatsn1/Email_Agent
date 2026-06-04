import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/mongo';
import { EmailAccountModel } from '@/lib/db/models/EmailAccount';
import { getVisitorId, hasVisitorCookie, VISITOR_COOKIE_NAME } from '@/lib/auth/visitor';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${origin}/dashboard?error=gmail_denied`);
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
    const redirectUri = `${origin}/api/connect/gmail/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
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

    // Get user info
    const userRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = (await userRes.json()) as { email?: string; name?: string };
    if (!user.email) throw new Error('Could not retrieve Gmail address');

    // Upsert EmailAccount
    await connectDB();
    await EmailAccountModel.findOneAndUpdate(
      { ownerId: visitorId, provider: 'gmail', email: user.email.toLowerCase() },
      {
        ownerId: visitorId,
        provider: 'gmail',
        email: user.email.toLowerCase(),
        name: user.name,
        accessToken: tokens.access_token,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
      { upsert: true, new: true }
    );

    const response = NextResponse.redirect(`${origin}/dashboard?connected=gmail`);
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
    console.error('[gmail/callback]', err);
    return NextResponse.redirect(
      `${origin}/dashboard?error=${encodeURIComponent(String(err))}`
    );
  }
}
