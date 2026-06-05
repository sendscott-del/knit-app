import { Link, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AdminProfile } from '@/lib/useAdmin'
import { roleLabel, isWardScoped, canManageStake, canEdit } from '@/lib/roles'

type Ctx = { profile: AdminProfile }

export default function AdminDashboard() {
  const { profile } = useOutletContext<Ctx>()
  const { t } = useTranslation('common')
  const wardScope = isWardScoped(profile.role) && !profile.is_super_admin
  const scopeName = wardScope ? profile.ward?.name ?? t('dash') : profile.stake?.name ?? t('dash')
  const editor = canEdit(profile)
  const stakeAdmin = canManageStake(profile)
  const showInsights = Boolean(profile.is_super_admin || profile.is_app_super_admin)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
          {greeting(profile.name ?? profile.email, t)}
        </h1>
        <p className="text-base text-gray-600 mt-1">
          {roleLabel(profile.role, t)} · {scopeName}
          {profile.is_super_admin ? t('dashboard.super_admin_suffix') : ''}
        </p>
        {!editor ? (
          <p className="text-sm text-gray-500 mt-2 italic">
            {t('dashboard.read_only_note')}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showInsights ? (
          <LinkCard
            to="/admin/insights"
            title={t('dashboard.card_insights_title')}
            body={t('dashboard.card_insights_body')}
          />
        ) : null}
        <LinkCard
          to="/admin/members"
          title={t('dashboard.card_members_title')}
          body={wardScope ? t('dashboard.card_members_ward') : t('dashboard.card_members_stake')}
        />
        <LinkCard
          to="/admin/friends"
          title={t('dashboard.card_friends_title')}
          body={t('dashboard.card_friends_body')}
        />
        <LinkCard
          to="/admin/outings"
          title={t('dashboard.card_outings_title')}
          body={t('dashboard.card_outings_body')}
        />
        <LinkCard
          to="/admin/suggest"
          title={t('dashboard.card_suggest_title')}
          body={t('dashboard.card_suggest_body')}
        />
        <LinkCard
          to="/admin/sheet"
          title={t('dashboard.card_sheet_title')}
          body={t('dashboard.card_sheet_body')}
        />
        <LinkCard
          to="/admin/settings"
          title={t('dashboard.card_settings_title')}
          body={stakeAdmin ? t('dashboard.card_settings_stake') : t('dashboard.card_settings_view')}
        />
        {stakeAdmin ? (
          <LinkCard
            to="/admin/users"
            title={t('dashboard.card_users_title')}
            body={t('dashboard.card_users_body')}
          />
        ) : null}
      </div>
    </div>
  )
}

function greeting(label: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  const hour = new Date().getHours()
  const first = label.split('@')[0].split(/[\s.]/)[0]
  const name = first.charAt(0).toUpperCase() + first.slice(1)
  if (hour < 12) return t('dashboard.greet_morning', { name })
  if (hour < 18) return t('dashboard.greet_afternoon', { name })
  return t('dashboard.greet_evening', { name })
}

function LinkCard({ to, title, body }: { to: string; title: string; body: string }) {
  const { t } = useTranslation('common')
  return (
    <Link
      to={to}
      className="suite-card p-5 space-y-2 hover:border-knit-primary hover:shadow-lg transition group"
    >
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-600">{body}</p>
      <p className="text-xs font-semibold text-knit-primary pt-2 group-hover:translate-x-0.5 transition">
        {t('open_arrow')}
      </p>
    </Link>
  )
}
