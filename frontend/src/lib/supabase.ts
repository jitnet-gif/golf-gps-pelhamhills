import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The one signed-in client, for accounts and scorecards.
 *
 * Course, hole and banner reads stay on plain fetch (courseData, promotions):
 * they are public, and a map that opens on a fairway must not wait on an auth
 * library. This client exists for the part that needs a session - see
 * lib/scorecardSync and migration 0006.
 *
 * Null when the build carries no Supabase settings, so a local build without
 * .env still opens and keeps score on the device.
 */
const URL_BASE = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Where the session is kept on the phone - lib/auth reads it without the network. */
export const AUTH_STORAGE_KEY = 'golf-gps.auth';

export const supabase: SupabaseClient | null =
  URL_BASE && KEY
    ? createClient(URL_BASE, KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Email and password only - no redirect comes back with a token.
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY,
        },
      })
    : null;
