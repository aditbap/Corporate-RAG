import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export default auth((request) => {
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  // A session whose refresh token is dead (`error` set) is no better than no session: treating it as
  // signed-in would send the visitor to the dashboard, where the client signs them out to /login.
  const isLoggedIn = !!request.auth && !request.auth.error

  // Visitors who are not signed in land on the guest chat. Signing in is optional and only needed
  // for what is tied to an account (uploads, libraries, saved conversations).
  const path = request.nextUrl.pathname.replace(/\/+$/, '')
  if (!isLoggedIn && (path === '/dashboard' || path === '/dashboard/chat' || path === '/dashboard/chat/new')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (!isLoggedIn && !isAuthRoute && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    const target = request.nextUrl.pathname + request.nextUrl.search
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('callbackUrl', target)
    return NextResponse.redirect(url)
  }

  if (isLoggedIn && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard/chat'
    return NextResponse.redirect(url)
  }
})

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/auth (Auth.js routes themselves)
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
