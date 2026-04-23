import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    '[knit] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — Supabase calls will fail until these are configured in .env.local or Vercel.',
  )
}

export const supabase = createClient<Database>(url ?? '', anonKey ?? '')

export type { Database }
