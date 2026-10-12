import NextAuth from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'
import type { JWT } from 'next-auth/jwt'

/** Refresh slightly early so a token never expires between our check and apps/api's. */
const EXPIRY_SKEW_MS = 30_000

/**
 * Keycloak access tokens are short-lived (5 minutes by default) but the Auth.js session lasts much
 * longer, so the stored access token must be renewed with the refresh token or every call to
 * apps/api starts failing with 401 once the first token expires.
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) throw new Error('No refresh token')
    const res = await fetch(`${process.env.AUTH_KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.AUTH_KEYCLOAK_ID ?? '',
        client_secret: process.env.AUTH_KEYCLOAK_SECRET ?? '',
        refresh_token: token.refreshToken,
      }),
    })
    const data = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string }
    if (!res.ok || !data.access_token) throw new Error(`Refresh rejected (${res.status})`)
    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + (data.expires_in ?? 300) * 1000,
      // Keycloak may rotate the refresh token; keep the old one when it doesn't.
      refreshToken: data.refresh_token ?? token.refreshToken,
      error: undefined,
    }
  } catch {
    // The SSO session ended (idle timeout, logout elsewhere, revoked): the user must sign in again.
    return { ...token, error: 'RefreshAccessTokenError' }
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account }) {
      // apps/api verifies the access token locally against the realm's JWKS
      // (packages/auth/jwt-verify.ts) — it is never sent back to Keycloak for validation.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : undefined,
          refreshToken: account.refresh_token,
          error: undefined,
        }
      }
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires - EXPIRY_SKEW_MS) return token
      return refreshAccessToken(token)
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined
      session.userId = token.sub as string
      session.error = token.error
      return session
    },
  },
})
