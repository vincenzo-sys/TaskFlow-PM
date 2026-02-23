-- TaskFlow PM: Enable Supabase Realtime on key tables
-- These tables will broadcast INSERT/UPDATE/DELETE events to subscribed clients

ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
ALTER PUBLICATION supabase_realtime ADD TABLE notebooks;
ALTER PUBLICATION supabase_realtime ADD TABLE recap_entries;
