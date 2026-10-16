'use server'

import { signIn, signOut } from '@/auth'

export async function login(formData?: FormData) {
  const requested = formData?.get('callbackUrl')
  // Same-origin paths only — never an open redirect.
  const redirectTo = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard/chat'
  await signIn('keycloak', { redirectTo })
}

/** Same SSO flow, but Keycloak opens its registration form first (see the `keycloak-register` provider in auth.ts). */
export async function register(formData?: FormData) {
  const requested = formData?.get('callbackUrl')
  const redirectTo = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard/chat'
  await signIn('keycloak-register', { redirectTo })
}

export async function logout() {
  await signOut({ redirectTo: '/' })
}
