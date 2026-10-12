import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    accessToken?: string
    userId?: string
    /** Set when the access token could not be renewed and the user must sign in again. */
    error?: 'RefreshAccessTokenError'
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    accessTokenExpires?: number
    refreshToken?: string
    error?: 'RefreshAccessTokenError'
  }
}
