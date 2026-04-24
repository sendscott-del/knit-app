import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase client. Uses the service role key and bypasses RLS.
 * Never import this from src/ — it carries secret credentials.
 */
let cached: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
