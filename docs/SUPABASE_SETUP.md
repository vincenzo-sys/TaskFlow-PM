# Supabase Setup Guide

Follow these steps to set up the Supabase backend for the TaskFlow PM web app.

## 1. Create Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose your organization (or create one)
4. Fill in:
   - **Project name:** `taskflow-pm` (or whatever you prefer)
   - **Database password:** save this somewhere safe
   - **Region:** pick the closest to your users
5. Click **Create new project** and wait for it to provision (~2 min)

## 2. Run Database Migrations

Open the **SQL Editor** in your Supabase dashboard and run each migration file **in order**. Paste the full contents of each file and click **Run**.

| Order | File | What it does |
|-------|------|-------------|
| 1 | `supabase/migrations/001_schema.sql` | Creates all tables, enums, indexes, triggers |
| 2 | `supabase/migrations/002_rls_policies.sql` | Row-Level Security policies (team-scoped access) |
| 3 | `supabase/migrations/003_realtime.sql` | Enables realtime subscriptions on key tables |
| 4 | `supabase/migrations/004_auto_team_on_signup.sql` | Auto-creates team + inbox project for new users |

**Important:** Run them in order. Each migration depends on the previous ones.

## 3. Get Your API Keys

1. Go to **Settings > API** in the Supabase dashboard
2. Copy these values:
   - **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - **anon public** key (safe for browser use)
   - **service_role** key (server-only, never expose in browser)

## 4. Configure Auth Settings

In the Supabase dashboard:

1. Go to **Authentication > Providers**
2. Ensure **Email** provider is enabled
3. Go to **Authentication > URL Configuration**
4. Add these **Redirect URLs**:
   - `http://localhost:3000/callback` (local development)
   - `https://your-vercel-domain.vercel.app/callback` (production - add after deploying)

### For Testing Convenience

Go to **Authentication > Settings** and:
- **Disable** "Confirm email" (so testers don't need to verify email)
- You can re-enable this later for production

## 5. Set Up Environment Variables

### Web App (Next.js)

Copy the example env file:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Fill in your keys:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

## 6. Verify Setup

After running migrations and setting up auth:

1. Start the web app: `cd apps/web && npm run dev`
2. Go to `http://localhost:3000/signup`
3. Create an account with any email/password
4. You should be redirected to `/today` with an empty task list
5. In Supabase dashboard, check:
   - **Table Editor > profiles** — your user should appear
   - **Table Editor > teams** — a "Personal" team should exist
   - **Table Editor > team_members** — you should be the owner
   - **Table Editor > projects** — an "Inbox" project should exist
   - **Table Editor > user_preferences** — default prefs should exist

## Troubleshooting

### "No workspace found" after signup
The `004_auto_team_on_signup.sql` migration likely wasn't run. Run it and then either:
- Delete and re-create your test user, or
- Manually insert team + team_member + user_preferences + inbox project rows

### Auth redirect issues
Make sure `http://localhost:3000/callback` is in your Supabase redirect URLs.

### RLS permission errors
Check that the user has a `team_members` row linking them to a team. All data queries are team-scoped through RLS policies.
