/**
 * Browser Supabase client for Auth.
 * Uses VITE_* env vars (Vite exposes these to the client).
 * Server uses lib/supabase.ts with SUPABASE_* (process.env).
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
