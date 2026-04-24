import type { VercelRequest, VercelResponse } from '@vercel/node'

export function readCookie(req: VercelRequest, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function setCookie(
  res: VercelResponse,
  name: string,
  value: string,
  opts: { maxAgeSeconds?: number; httpOnly?: boolean } = {},
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    'Secure',
  ]
  if (opts.httpOnly !== false) parts.push('HttpOnly')
  if (opts.maxAgeSeconds != null) parts.push(`Max-Age=${opts.maxAgeSeconds}`)
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearCookie(res: VercelResponse, name: string) {
  res.setHeader(
    'Set-Cookie',
    `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  )
}
