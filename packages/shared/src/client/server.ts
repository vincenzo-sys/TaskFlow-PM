import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import type { Database } from '../types/database.js';

/**
 * Create a Supabase server client for Next.js server components / route handlers.
 * Requires cookie getter/setter functions from the calling context.
 */
export function createServerClient(cookieStore: {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createSupabaseServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        cookieStore.setAll(cookiesToSet);
      },
    },
  });
}
