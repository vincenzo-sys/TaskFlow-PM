import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';
import type { Database } from '../types/database.js';

let client: ReturnType<typeof createSupabaseBrowserClient<Database>> | null = null;

export function createBrowserClient() {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  client = createSupabaseBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  return client;
}
