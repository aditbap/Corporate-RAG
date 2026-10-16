import { getSession, signOut } from 'next-auth/react'

/**
 * Fetches the current Keycloak access token for calling apps/api, or null if
 * unauthenticated. The token is stored in the Auth.js session (see src/auth.ts).
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession()
  // `next-auth/react`'s `getSession()` types `Session` via `@auth/core/types`
  // directly rather than through `next-auth`'s re-export, so our module
  // augmentation in src/types/next-auth.d.ts (which targets `next-auth`) doesn't
  // reach it here. The field is still there at runtime (set in auth.ts's
  // `session` callback) — this cast just tells TS about it at this call site.
  const current = session as { accessToken?: string; error?: string } | null
  if (current?.error === 'RefreshAccessTokenError') {
    // The Keycloak session is gone (idle timeout, logout elsewhere): clear it and fall back to the guest chat.
    void signOut({ callbackUrl: '/' })
    return null
  }
  return current?.accessToken ?? null
}
