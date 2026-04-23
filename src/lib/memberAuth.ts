const KEY = 'knit.memberAuth.v1'

export type MemberAuth = { memberId: string; token: string }

export function readMemberAuth(): MemberAuth | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.memberId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function writeMemberAuth(auth: MemberAuth) {
  window.localStorage.setItem(KEY, JSON.stringify(auth))
}

export function clearMemberAuth() {
  window.localStorage.removeItem(KEY)
}

export function memberInviteUrl(origin: string, memberId: string, token: string) {
  return `${origin}/m/${memberId}/${token}`
}
