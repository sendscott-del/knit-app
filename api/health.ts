import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const env = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ),
    NODE_VERSION: process.version,
  }
  res.status(200).json({ ok: true, env })
}
