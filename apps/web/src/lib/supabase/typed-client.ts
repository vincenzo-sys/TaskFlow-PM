/**
 * Typed query helpers for Supabase operations.
 *
 * The placeholder Database types don't perfectly match what Supabase v2 client
 * needs for full type inference. Once `supabase gen types typescript` generates
 * the real types, these wrappers can be removed and queries will infer correctly.
 */
import type { Database } from '@taskflow/shared/types';

type Tables = Database['public']['Tables'];

/**
 * Type-safe `from()` that bypasses the strict generic inference.
 * Accepts any Supabase client (browser, server, SSR) and returns untyped
 * query builder. Cast results at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function from<T extends keyof Tables>(client: any, table: T) {
  return client.from(table);
}
