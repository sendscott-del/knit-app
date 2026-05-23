import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { AdminProfile } from '@/lib/useAdmin'
import { canSendInvitations } from '@/lib/roles'

type Ctx = { profile: AdminProfile }

type MemberRow = {
  id: string
  ward_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  phone: string | null
  opted_out_at: string | null
  ward: { id: string; name: string } | null
}

type InvitationRow = {
  id: string
  member_id: string
  ward_id: string
  sent_by_admin_id: string | null
  sent_by_label: string | null
  source: 'admin_app' | 'missionary_sheet'
  channel: 'email' | 'sms'
  recipient: string
  outcome: 'sent' | 'failed'
  outcome_detail: string | null
  created_at: string
  member: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null
  ward: { id: string; name: string } | null
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}

function memberDisplayName(m: Pick<MemberRow, 'first_name' | 'last_name' | 'preferred_name'>): string {
  if (m.preferred_name) return m.preferred_name
  const full = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
  return full || '—'
}

export default function AdminInvitations() {
  const { profile } = useOutletContext<Ctx>()
  const allowed = canSendInvitations(profile)

  const [history, setHistory] = useState<InvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [matches, setMatches] = useState<MemberRow[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<MemberRow | null>(null)
  const [sending, setSending] = useState<'email' | 'sms' | null>(null)
  const [outcome, setOutcome] = useState<
    | { kind: 'ok'; text: string }
    | { kind: 'err'; text: string }
    | null
  >(null)

  async function loadHistory() {
    setLoading(true)
    setError(null)
    const { data, error: historyErr } = await supabase
      .from('knit_member_invitations')
      .select(
        'id, member_id, ward_id, sent_by_admin_id, sent_by_label, source, channel, recipient, outcome, outcome_detail, created_at, member:knit_members(id, first_name, last_name, preferred_name), ward:knit_wards(id, name)',
      )
      .order('created_at', { ascending: false })
      .limit(100)
    if (historyErr) setError(historyErr.message)
    else setHistory((data ?? []) as unknown as InvitationRow[])
    setLoading(false)
  }

  useEffect(() => {
    if (allowed) void loadHistory()
    else setLoading(false)
  }, [allowed])

  // Debounce the search query so we hit the DB once after the user pauses
  // typing instead of on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  // Server-side search. Critical because there are thousands of members
  // across the stake — a client-side filter over a single LIMIT-capped fetch
  // misses anyone whose name sorts past the cutoff.
  useEffect(() => {
    if (!debouncedQuery) {
      setMatches([])
      setSearching(false)
      return
    }
    // Strip PostgREST .or() syntax characters that would break the query.
    const safe = debouncedQuery.replace(/[%,()]/g, ' ').trim()
    if (!safe) {
      setMatches([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const pattern = `%${safe}%`
    ;(async () => {
      const { data, error: searchErr } = await supabase
        .from('knit_members')
        .select(
          'id, ward_id, first_name, last_name, preferred_name, phone, opted_out_at, ward:knit_wards(id, name)',
        )
        .is('opted_out_at', null)
        .or(
          [
            `first_name.ilike.${pattern}`,
            `last_name.ilike.${pattern}`,
            `preferred_name.ilike.${pattern}`,
            `phone.ilike.${pattern}`,
          ].join(','),
        )
        .order('last_name', { ascending: true })
        .limit(20)
      if (cancelled) return
      if (searchErr) {
        setError(searchErr.message)
        setMatches([])
      } else {
        setMatches((data ?? []) as unknown as MemberRow[])
      }
      setSearching(false)
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  async function send() {
    if (!selected) return
    setOutcome(null)
    setSending('sms')
    try {
      const res = await authorizedFetch('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify({ action: 'send', member_id: selected.id, channel: 'sms' }),
      })
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; outcome?: string; recipient?: string; error?: string }
        | null
      if (!res.ok || !body?.ok) {
        setOutcome({
          kind: 'err',
          text: body?.error ?? `Send failed (${res.status})`,
        })
      } else {
        setOutcome({
          kind: 'ok',
          text: `Texted ${memberDisplayName(selected)} at ${body.recipient ?? selected.phone}`,
        })
        await loadHistory()
      }
    } catch (e) {
      setOutcome({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSending(null)
    }
  }

  if (!allowed) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Invitations</h1>
        <p className="text-sm text-gray-600">
          You don't have permission to send Knit invitations. Ask your stake president, stake clerk, the high
          councilor over missionary work, or a ward mission leader.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Invitations</h1>
        <p className="text-sm text-gray-600 mt-1">
          Send a member the Knit availability survey by text. Search by name or phone, pick the member, and Knit
          texts the personalized link — no copy-paste needed.
        </p>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-5 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Search members</span>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
              setOutcome(null)
            }}
            placeholder="Start typing a name or phone"
            className="form-input mt-1"
            autoFocus
          />
        </label>

        {query && !selected ? (
          <div className="rounded-md border border-gray-200 overflow-hidden">
            {searching ? (
              <div className="p-4 text-sm text-gray-500">Searching…</div>
            ) : matches.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No matching members.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => {
                        setSelected(m)
                        setQuery(memberDisplayName(m))
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm text-gray-900">{memberDisplayName(m)}</div>
                        <div className="text-xs text-gray-500">
                          {m.ward?.name ?? '—'} · {m.phone ?? 'no phone'}
                        </div>
                      </div>
                      <span className="text-xs text-knit-primary">Choose</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {selected ? (
          <div className="rounded-md border-[1.5px] border-knit-primary/30 bg-knit-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{memberDisplayName(selected)}</div>
                <div className="text-xs text-gray-600">
                  {selected.ward?.name ?? '—'} · {selected.phone ?? 'no phone'}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelected(null)
                  setQuery('')
                  setOutcome(null)
                }}
                className="text-xs text-gray-600 hover:text-gray-900"
              >
                Change
              </button>
            </div>
            <button
              onClick={() => void send()}
              disabled={!selected.phone || sending !== null}
              className="w-full sm:w-auto rounded-md border-[1.5px] border-knit-primary text-knit-primary px-4 py-2 text-sm font-medium hover:bg-knit-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending === 'sms'
                ? 'Sending text…'
                : selected.phone
                  ? 'Send by text'
                  : 'Send by text (no phone)'}
            </button>
            {outcome ? (
              <div
                className={`text-sm ${outcome.kind === 'ok' ? 'text-emerald-700' : 'text-error'}`}
              >
                {outcome.text}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Recent invitations</h2>
          <span className="text-xs text-gray-500">Last 100 across your scope</span>
        </header>
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : error ? (
          <div className="p-6 text-sm text-error">{error}</div>
        ) : history.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No invitations yet. Send the first above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-4 py-2 font-medium hidden sm:table-cell">Ward</th>
                  <th className="px-4 py-2 font-medium hidden md:table-cell">Sent by</th>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-4 py-2 font-medium hidden md:table-cell">Recipient</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-gray-900">
                      {row.member ? memberDisplayName(row.member) : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600 hidden sm:table-cell">
                      {row.ward?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600 hidden md:table-cell">
                      {row.source === 'missionary_sheet'
                        ? 'Missionary sheet'
                        : row.sent_by_label ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{row.channel === 'sms' ? 'Text' : 'Email'}</td>
                    <td className="px-4 py-2 text-gray-600 hidden md:table-cell">{row.recipient}</td>
                    <td className="px-4 py-2">
                      {row.outcome === 'sent' ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs font-medium">
                          Sent
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-xs font-medium"
                          title={row.outcome_detail ?? ''}
                        >
                          Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
