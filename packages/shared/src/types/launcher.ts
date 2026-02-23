import type { Database } from './database.js';

export type Launcher = Database['public']['Tables']['launchers']['Row'];
export type LauncherInsert = Database['public']['Tables']['launchers']['Insert'];
export type LauncherUpdate = Database['public']['Tables']['launchers']['Update'];
