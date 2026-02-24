-- ============================================================
-- 004: Auto-create team, membership, preferences, and inbox
--      project when a new user signs up.
--
-- Replaces the existing handle_new_user() from 001_schema.sql
-- which only created a profile row.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _team_id UUID;
  _display_name TEXT;
  _project_id UUID;
BEGIN
  -- Derive display name
  _display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  -- 1. Create profile
  INSERT INTO profiles (id, display_name, email)
  VALUES (NEW.id, _display_name, NEW.email);

  -- 2. Create a personal team
  _team_id := gen_random_uuid();
  INSERT INTO teams (id, name, slug)
  VALUES (_team_id, 'Personal', 'personal-' || substr(NEW.id::text, 1, 8));

  -- 3. Add user as team owner
  INSERT INTO team_members (team_id, user_id, role)
  VALUES (_team_id, NEW.id, 'owner');

  -- 4. Create default user preferences
  INSERT INTO user_preferences (user_id, team_id)
  VALUES (NEW.id, _team_id);

  -- 5. Create default Inbox project
  _project_id := gen_random_uuid();
  INSERT INTO projects (id, team_id, name, color, is_inbox)
  VALUES (_project_id, _team_id, 'Inbox', '#6366f1', true);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The trigger on_auth_user_created already exists from 001_schema.sql
-- and points to handle_new_user(), so it will pick up this new version
-- automatically. No need to re-create the trigger.
