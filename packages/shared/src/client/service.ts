import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';

let client: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Create a Supabase service-role client (bypasses RLS).
 * For use in MCP server and other trusted backend processes.
 */
export function createServiceClient(
  url?: string,
  serviceRoleKey?: string,
) {
  if (client) return client;

  const supabaseUrl = url ?? process.env.SUPABASE_URL!;
  const key = serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;

  client = createClient<Database>(supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return client;
}
