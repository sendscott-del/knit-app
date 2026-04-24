import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_lib/supabaseAdmin.js'
import {
  exchangeCode,
  fetchUserEmail,
  SCOPES,
} from '../../_lib/googleOAuth.js'
import { readCookie, clearCookie } from '../../_lib/cookies.js'

/**
 * Google redirects here after the user grants (or denies) consent. We verify
 * the state cookie, exchange the code for tokens, and store the refresh token.
 *
 * No admin-session check here: at this point the browser is mid-OAuth dance
 * and may not have a fresh Supabase session header. We authenticate by the
 * state cookie we issued at /authorize time.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error: oauthError } = req.query as {
    code?: string
    state?: string
    error?: string
  }

  const cookieState = readCookie(req, 'knit_oauth_state')
  clearCookie(res, 'knit_oauth_state')

  if (oauthError) {
    return redirectToSheet(res, `error=${encodeURIComponent(oauthError)}`)
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectToSheet(res, 'error=state_mismatch')
  }

  try {
    const tokens = await exchangeCode(code)
    if (!tokens.refresh_token) {
      // Without a refresh token we can't do offline work — force re-consent next time.
      return redirectToSheet(
        res,
        'error=no_refresh_token',
      )
    }
    const email = tokens.access_token
      ? await fetchUserEmail(tokens.access_token)
      : null
    if (!email) {
      return redirectToSheet(res, 'error=no_user_email')
    }

    // We don't have a Supabase session at this callback — look up the admin
    // by email. Safe because we have a fresh Google sign-in proving identity.
    const sb = supabaseAdmin()
    const { data: admin } = await sb
      .from('knit_admin_users')
      .select('id, stake_id, email')
      .eq('email', email)
      .maybeSingle()

    const stakeId = admin?.stake_id ?? null
    if (!stakeId) {
      // Fallback: if the connecting Google email doesn't match a Knit admin,
      // associate by the admin email that initiated the flow is tricky without
      // state. Require the Google email to match an existing admin for now.
      return redirectToSheet(
        res,
        `error=no_admin_for_email&email=${encodeURIComponent(email)}`,
      )
    }

    const payload = {
      stake_id: stakeId,
      refresh_token: tokens.refresh_token,
      granted_by: admin!.id,
      granted_by_email: email,
      scopes: SCOPES,
      granted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await sb
      .from('knit_google_oauth')
      .select('id')
      .eq('stake_id', stakeId)
      .maybeSingle()
    if (existing) {
      await sb.from('knit_google_oauth').update(payload).eq('id', existing.id)
    } else {
      await sb.from('knit_google_oauth').insert(payload)
    }

    return redirectToSheet(res, `connected=1&email=${encodeURIComponent(email)}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return redirectToSheet(res, `error=${encodeURIComponent(message)}`)
  }
}

function redirectToSheet(res: VercelResponse, query: string) {
  res.setHeader('Location', `/admin/sheet?${query}`)
  res.status(302).end()
}
