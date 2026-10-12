import { getSession } from 'next-auth/react'

/**
 * Fetches the current Keycloak access token for calling apps/api, or null if
 * unauthenticated. Drop-in replacement for the old
 * `(await supabase.auth.getSession()).data.session?.access_token` pattern.
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession()
  // `next-auth/react`'s `getSession()` types `Session` via `@auth/core/types`
  // directly rather than through `next-auth`'s re-export, so our module
  // augmentation in src/types/next-auth.d.ts (which targets `next-auth`) doesn't
  // reach it here. The field is still there at runtime (set in auth.ts's
  // `session` callback) — this cast just tells TS about it at this call site.
  return (session as { accessToken?: string } | null)?.accessToken ?? null
}
