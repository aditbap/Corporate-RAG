import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    accessToken?: string
    userId?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    accessTokenExpires?: number
  }
}
