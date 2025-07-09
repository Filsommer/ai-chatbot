import { signInAsGuest } from '@/lib/auth/actions';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('redirectUrl') || '/';

  try {
    await signInAsGuest();
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  } catch (error) {
    console.error('Guest sign-in error:', error);
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
