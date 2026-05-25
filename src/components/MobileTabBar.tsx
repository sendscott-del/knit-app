import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/**
 * Bottom tab bar — mobile-only. Sticky, safe-area aware.
 *
 * The "More" tab is a button, not a NavLink — it opens the
 * MoreSheet rendered by AdminLayout. "More" lights up whenever
 * the active route isn't one of the four primary routes, so the
 * user always sees where they are.
 */
export default function MobileTabBar({
  onMoreClick,
}: {
  onMoreClick: () => void
}) {
  const { pathname } = useLocation()
  const { t } = useTranslation('common')
  const PRIMARY = ['/admin', '/admin/members', '/admin/friends', '/admin/suggest']
  const moreActive = !PRIMARY.some((p) =>
    p === '/admin' ? pathname === p : pathname.startsWith(p),
  )

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 grid grid-cols-5"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <TabLink to="/admin" end label={t('nav.home', 'Home')} icon="home" />
      <TabLink
        to="/admin/members"
        label={t('nav.members', 'Members')}
        icon="members"
      />
      <TabLink
        to="/admin/friends"
        label={t('nav.friends', 'Friends')}
        icon="friends"
      />
      <TabLink
        to="/admin/suggest"
        label={t('nav.suggest', 'Suggest')}
        icon="suggest"
      />
      <button
        type="button"
        onClick={onMoreClick}
        aria-label={t('nav.more', 'More')}
        className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[10px] font-semibold ${
          moreActive ? 'text-knit-primary' : 'text-gray-500'
        }`}
      >
        <Icon name="more" active={moreActive} />
        {t('nav.more', 'More')}
      </button>
    </nav>
  )
}

function TabLink({
  to,
  end,
  label,
  icon,
}: {
  to: string
  end?: boolean
  label: string
  icon: IconName
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[10px] font-semibold ${
          isActive ? 'text-knit-primary' : 'text-gray-500'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={icon} active={isActive} />
          {label}
        </>
      )}
    </NavLink>
  )
}

type IconName = 'home' | 'members' | 'friends' | 'suggest' | 'more'

const ICON_MAP: Record<IconName, [string, string]> = {
  home: ['home-outline', 'home'],
  members: ['people-outline', 'people'],
  friends: ['heart-outline', 'heart'],
  suggest: ['sparkles-outline', 'sparkles'],
  more: ['ellipsis-horizontal', 'ellipsis-horizontal'],
}

function Icon({ name, active }: { name: IconName; active?: boolean }) {
  const [outline, filled] = ICON_MAP[name]
  return (
    <ion-icon
      name={active ? filled : outline}
      style={{ fontSize: 22 }}
      aria-hidden="true"
    />
  )
}
