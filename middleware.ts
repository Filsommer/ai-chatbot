import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 });
  }

  // Allow auth routes without authentication
  if (
    pathname.startsWith('/auth/') ||
    pathname === '/login' ||
    pathname === '/register'
  ) {
    const response = await updateSession(request);
    return response;
  }

  // Update the session
  const response = await updateSession(request);

  // Get the user
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: any) {
          cookiesToSet.forEach(({ name, value }: any) =>
            request.cookies.set(name, value),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // If no user and trying to access protected routes, redirect to guest login
    const redirectUrl = encodeURIComponent(request.url);
    return NextResponse.redirect(
      new URL(`/auth/guest?redirectUrl=${redirectUrl}`, request.url),
    );
  }

  const isAnonymous = user.is_anonymous || false;

  // If authenticated (non-anonymous) user tries to access login/register, redirect to home
  if (user && !isAnonymous && ['/login', '/register'].includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/api/:path*',
    '/login',
    '/register',

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
