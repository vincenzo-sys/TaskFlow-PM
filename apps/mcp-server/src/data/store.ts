export interface DataStore {
  /**
   * Optional async initialization (e.g., authenticate, fetch initial data).
   * Called once before any other methods.
   */
  init?(): Promise<void>;

  /**
   * Load all data in the nested local format (projects with tasks, etc.).
   * May be sync (LocalDataStore) or async (SupabaseDataStore).
   */
  loadData(): any | Promise<any>;

  /**
   * Persist the full nested data object.
   * Returns true on success, false on failure.
   */
  saveData(data: any): boolean | Promise<boolean>;

  /**
   * Alias for loadData — returns raw nested data.
   */
  getRawData(): any | Promise<any>;

  /**
   * Alias for saveData — persists raw nested data.
   */
  saveRawData(data: any): void | Promise<void>;
}
