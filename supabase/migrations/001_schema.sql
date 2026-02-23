-- TaskFlow PM: Full database schema
-- Run against Supabase project via SQL Editor or supabase db push

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE task_status AS ENUM ('todo', 'in-progress', 'review', 'waiting', 'done');
CREATE TYPE task_priority AS ENUM ('none', 'low', 'medium', 'high', 'urgent');
CREATE TYPE execution_type AS ENUM ('ai', 'manual', 'hybrid');
CREATE TYPE project_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE recap_period AS ENUM ('daily', 'weekly', 'monthly');
CREATE TYPE recap_entry_type AS ENUM ('accomplishment', 'decision', 'note');
CREATE TYPE team_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE blocker_type AS ENUM ('person', 'external', 'technical', 'decision', 'other');

-- ============================================================
-- HELPER: auto-update updated_at trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. TEAMS
-- ============================================================

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. PROFILES (extends auth.users)
-- ============================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 3. TEAM_MEMBERS (junction: teams <-> profiles)
-- ============================================================

CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role team_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- ============================================================
-- 4. CATEGORIES (team-scoped)
-- ============================================================

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INT NOT NULL DEFAULT 0,
  collapsed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 5. TAGS (team-scoped)
-- ============================================================

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tags_team_name ON tags(team_id, name);

-- ============================================================
-- 6. PROJECTS (team-scoped, self-referencing for hierarchy)
-- ============================================================

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  parent_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_inbox BOOLEAN NOT NULL DEFAULT false,
  status project_status NOT NULL DEFAULT 'active',
  goal TEXT NOT NULL DEFAULT '',
  working_directory TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX projects_team_id ON projects(team_id);
CREATE INDEX projects_category_id ON projects(category_id);

-- ============================================================
-- 7. TASKS (the core entity)
-- ============================================================

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,

  -- Content
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  work_notes TEXT,

  -- Status
  status task_status NOT NULL DEFAULT 'todo',
  priority task_priority NOT NULL DEFAULT 'none',
  completed_at TIMESTAMPTZ,

  -- Dates & Scheduling
  due_date DATE,
  scheduled_date DATE,
  scheduled_time TIME,
  start_date DATE,
  end_date DATE,

  -- Effort
  estimated_minutes INT,
  complexity INT CHECK (complexity IS NULL OR (complexity >= 1 AND complexity <= 5)),

  -- Execution & Assignment
  execution_type execution_type NOT NULL DEFAULT 'manual',
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignee_name TEXT,  -- Denormalized for display (legacy team member names)

  -- Waiting/Blocking text (free-form)
  waiting_reason TEXT,

  -- Sort order within project/parent
  sort_order INT NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Key indexes for common queries
CREATE INDEX tasks_project_id_status ON tasks(project_id, status);
CREATE INDEX tasks_due_date_status ON tasks(due_date, status) WHERE status != 'done';
CREATE INDEX tasks_scheduled_date_status ON tasks(scheduled_date, status) WHERE status != 'done';
CREATE INDEX tasks_execution_type ON tasks(execution_type) WHERE status != 'done';
CREATE INDEX tasks_assigned_to ON tasks(assigned_to) WHERE status != 'done';
CREATE INDEX tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX tasks_status ON tasks(status);

-- ============================================================
-- 8. TASK_TAGS (junction: tasks <-> tags)
-- ============================================================

CREATE TABLE task_tags (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE INDEX task_tags_tag_id ON task_tags(tag_id);

-- ============================================================
-- 9. TASK_DEPENDENCIES (junction: blocking relationships)
-- ============================================================

CREATE TABLE task_dependencies (
  blocked_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocking_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocked_task_id, blocking_task_id),
  CHECK (blocked_task_id != blocking_task_id)
);

CREATE INDEX task_deps_blocking ON task_dependencies(blocking_task_id);

-- ============================================================
-- 10. BLOCKER_INFO (one-to-one with task, structured blocker data)
-- ============================================================

CREATE TABLE blocker_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  blocker_type blocker_type NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '',
  follow_up_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER blocker_info_updated_at
  BEFORE UPDATE ON blocker_info
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 11. BLOCKER_NOTES (follow-up notes on blockers)
-- ============================================================

CREATE TABLE blocker_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_info_id UUID NOT NULL REFERENCES blocker_info(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX blocker_notes_blocker_id ON blocker_notes(blocker_info_id);

-- ============================================================
-- 12. TIME_LOGS (per-task time tracking)
-- ============================================================

CREATE TABLE time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  minutes INT NOT NULL CHECK (minutes > 0),
  notes TEXT NOT NULL DEFAULT '',
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX time_logs_task_id ON time_logs(task_id);

-- ============================================================
-- 13. TASK_LEARNINGS (insights attached to tasks)
-- ============================================================

CREATE TABLE task_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  learning TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_learnings_task_id ON task_learnings(task_id);

-- ============================================================
-- 14. TASK_FILES (file path references)
-- ============================================================

CREATE TABLE task_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_files_task_id ON task_files(task_id);

-- ============================================================
-- 15. NOTEBOOKS (per-project notes)
-- ============================================================

CREATE TABLE notebooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER notebooks_updated_at
  BEFORE UPDATE ON notebooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX notebooks_project_id ON notebooks(project_id);

-- ============================================================
-- 16. LAUNCHERS (per-project Claude launcher configs)
-- ============================================================

CREATE TABLE launchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  memory TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  output_dir TEXT NOT NULL DEFAULT '',
  flags TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER launchers_updated_at
  BEFORE UPDATE ON launchers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX launchers_project_id ON launchers(project_id);

-- ============================================================
-- 17. RECAP_ENTRIES (daily accomplishments/decisions/notes)
-- ============================================================

CREATE TABLE recap_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entry_type recap_entry_type NOT NULL,
  content TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  related_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recap_entries_team_date ON recap_entries(team_id, date);

-- ============================================================
-- 18. RECAP_ENTRY_TAGS (simple text tags on recap entries)
-- ============================================================

CREATE TABLE recap_entry_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recap_entry_id UUID NOT NULL REFERENCES recap_entries(id) ON DELETE CASCADE,
  tag TEXT NOT NULL
);

CREATE INDEX recap_entry_tags_entry_id ON recap_entry_tags(recap_entry_id);

-- ============================================================
-- 19. SAVED_RECAPS (generated recap documents)
-- ============================================================

CREATE TABLE saved_recaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  period recap_period NOT NULL,
  period_label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX saved_recaps_team_period ON saved_recaps(team_id, period, start_date);

-- ============================================================
-- 20. USER_PREFERENCES (per-user, per-team settings)
-- ============================================================

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'light',
  default_view TEXT NOT NULL DEFAULT 'today',
  font_scale INT NOT NULL DEFAULT 100,
  working_on_task_ids UUID[] NOT NULL DEFAULT '{}',
  favorites UUID[] NOT NULL DEFAULT '{}',
  project_view_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, team_id)
);

CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
