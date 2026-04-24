import { google } from 'googleapis'

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
]

export function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI — Knit admin must configure the OAuth client in Google Cloud.',
    )
  }
  return { clientId, clientSecret, redirectUri }
}

export function newOAuthClient() {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function authUrlFor(state: string) {
  const client = newOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
    state,
  })
}

/** Builds an OAuth2 client primed with a refresh token (auto-refreshes access tokens). */
export function userClientFrom(refreshToken: string) {
  const client = newOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

export async function exchangeCode(code: string) {
  const client = newOAuthClient()
  const { tokens } = await client.getToken(code)
  return tokens
}

export async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { email?: string }
  return body.email ?? null
}
