import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types'

/**
 * Server-side Supabase client. Uses the service role key and bypasses RLS.
 * Never import this from src/ — it carries secret credentials.
 */
let cached: ReturnType<typeof createClient<Database>> | null = null

export function supabaseAdmin() {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
