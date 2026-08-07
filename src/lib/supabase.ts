import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Replace these with your actual Supabase project values
const url = "https://ovnedexhysuaxhaupzgg.supabase.co";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92bmVkZXhoeXN1YXhoYXVwemdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NTYxNTYsImV4cCI6MjEwMTMzMjE1Nn0.12_yRp9v4YjNQsZYL_dr3y-9oVYCmPMf4wuYXVrYyec";

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
