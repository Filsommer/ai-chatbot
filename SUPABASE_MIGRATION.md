# Migration to Supabase Auth

This document outlines the migration from NextAuth to Supabase authentication.

## Environment Variables

Update your `.env.local` file with the following Supabase configuration:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Keep existing database and other configs
POSTGRES_URL=your_postgres_database_url
# ... other variables
```

## Database Schema Changes

A new column `supabaseId` has been added to the `User` table to map Supabase users to internal users.

Run the following migration:

```sql
ALTER TABLE "User" ADD COLUMN "supabaseId" VARCHAR(64) UNIQUE;
```

## Supabase Setup

1. **Create a Supabase project** at https://supabase.com
2. **Enable Anonymous Users**:
   - Go to Authentication > Settings
   - Enable "Allow anonymous sign-ins"
3. **Configure Authentication Providers** (optional):
   - Enable email/password authentication
   - Configure OAuth providers if needed

## Authentication Flow Changes

### Guest Users

- Now uses Supabase anonymous authentication
- Automatically signed in via `/auth/guest` route
- No longer stored in database until they become regular users

### Regular Users

- Uses Supabase email/password authentication
- Mapped to internal user records via `supabaseId`
- Automatic user creation on first Supabase sign-up

### Session Management

- Sessions are now managed by Supabase
- Compatible with existing chat tools and API routes
- Automatic session refresh handled by middleware

## Component Changes

### Client Components

- `useSession` replaced with custom `useAuth` hook
- `signOut` now uses Supabase auth
- AuthProvider wraps the entire application

### Server Components

- `auth()` replaced with `getSession()` from `/lib/auth/server`
- Middleware updated to use Supabase session management

## API Routes

All API routes have been updated to use the new `getSession()` function while maintaining the same interface.

## Installation

Run the following command to install the new dependencies:

```bash
npm install @supabase/supabase-js @supabase/ssr
npm uninstall next-auth
```

## Testing

1. Start the development server
2. Visit the app - you should be automatically signed in as a guest
3. Try registering a new account
4. Test login/logout functionality
5. Verify that chats are properly associated with users

## Notes

- Guest users are now truly anonymous (no database record)
- Regular users are created in the database when they first sign up
- All existing user data is preserved
- The migration maintains backward compatibility with existing features
