import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createUserFromSupabase, getUserBySupabaseId } from '@/lib/db/queries';
import { cache } from 'react';

export type UserType = 'guest' | 'regular';

export interface AuthUser {
  id: string;
  email?: string | null;
  type: UserType;
}

export interface AuthSession {
  user: AuthUser;
  expires: string;
}

export const getUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();

  try {
    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser();

    if (!supabaseUser) return null;

    // Check if this is an anonymous user (guest)
    const isAnonymous = supabaseUser.is_anonymous || false;

    if (isAnonymous) {
      return {
        id: supabaseUser.id,
        email: null,
        type: 'guest',
      };
    }

    // For regular users, get or create our internal user record
    let [internalUser] = await getUserBySupabaseId(supabaseUser.id);

    if (!internalUser && supabaseUser.email) {
      // Create internal user if it doesn't exist
      [internalUser] = await createUserFromSupabase(
        supabaseUser.id,
        supabaseUser.email,
      );
    }

    return {
      id: internalUser?.id || supabaseUser.id,
      email: supabaseUser.email || null,
      type: 'regular',
    };
  } catch (error) {
    return null;
  }
});

export const getSession = cache(async (): Promise<AuthSession | null> => {
  const user = await getUser();
  if (!user) return null;

  // Return a session compatible with existing tools
  return {
    user,
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
  };
});
