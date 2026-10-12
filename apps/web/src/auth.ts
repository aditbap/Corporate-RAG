import NextAuth from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'

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
      // Persist the Keycloak access token on first sign-in. apps/api verifies
      // this token locally against the realm's JWKS (packages/auth/jwt-verify.ts) —
      // it is never sent back to Keycloak for validation.
      if (account) {
        token.accessToken = account.access_token
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined
      session.userId = token.sub as string
      return session
    },
  },
})
