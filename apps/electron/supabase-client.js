/**
 * Supabase client for Electron main process.
 * Uses file-based storage for auth session persistence.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Hardcoded — anon key is safe (RLS protects data)
const SUPABASE_URL = 'https://xteoofowswtvtxgroxog.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0ZW9vZm93c3d0dnR4Z3JveG9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4OTY2MjcsImV4cCI6MjA4NzQ3MjYyN30.oc3yun0DeG9XLjhFXql6blZZqNSJfm3vowIwKgyT1K0';

let supabase = null;

/**
 * File-based storage adapter for Supabase auth session.
 * Replaces localStorage which doesn't exist in Node.js.
 */
class FileAuthStorage {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'supabase-auth.json');
    this.cache = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      this.cache = {};
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
    } catch (err) {
      console.error('Failed to persist auth session:', err.message);
    }
  }

  getItem(key) {
    return this.cache[key] ?? null;
  }

  setItem(key, value) {
    this.cache[key] = value;
    this._save();
  }

  removeItem(key) {
    delete this.cache[key];
    this._save();
  }
}

/**
 * Get or create the Supabase client singleton.
 * Must be called after app.whenReady() since it needs userData path.
 */
async function getClient() {
  if (supabase) return supabase;

  const { createClient } = require('@supabase/supabase-js');

  const storage = new FileAuthStorage();

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // Not applicable in Electron
    },
  });

  return supabase;
}

/**
 * Sign in with email/password.
 */
async function signIn(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Sign up with email/password.
 */
async function signUp(email, password, displayName) {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split('@')[0] },
    },
  });
  if (error) throw error;
  return data;
}

/**
 * Sign out and clear session.
 */
async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/**
 * Get current session (refreshes if needed).
 */
async function getSession() {
  const client = await getClient();
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  return session;
}

/**
 * Get the current user from the session.
 */
async function getUser() {
  const client = await getClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error) throw error;
  return user;
}

module.exports = {
  getClient,
  signIn,
  signUp,
  signOut,
  getSession,
  getUser,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
};
