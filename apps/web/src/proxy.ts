import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export default auth((request) => {
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  const isLoggedIn = !!request.auth

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
