import { Link } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'

/**
 * Knit user guide. Top-level prose explanation of what Knit does and how
 * the different roles use it. Updated alongside meaningful product changes;
 * for granular what-changed, point readers at /admin/release-notes.
 */
export default function AdminGuide() {
  const { t } = useTranslation('common')
  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('guide.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('guide.subtitle')}
        </p>
      </header>

      <Section title={t('guide.what_is_title')}>
        <p>{t('guide.what_is_body')}</p>
        <p>
          <Trans
            i18nKey="guide.what_is_name"
            ns="common"
            components={{ em: <em /> }}
          />
        </p>
      </Section>

      <Section title={t('guide.roles_title')}>
        <ul className="space-y-2">
          <li>
            <strong>{t('guide.role_stake_hc')}</strong>
            {t('guide.role_stake_hc_body')}
          </li>
          <li>
            <strong>{t('guide.role_wml')}</strong>
            {t('guide.role_wml_body')}
          </li>
          <li>
            <strong>{t('guide.role_aux')}</strong>
            {t('guide.role_aux_body')}
          </li>
          <li>
            <strong>{t('guide.role_super')}</strong>
            {t('guide.role_super_body')}
          </li>
        </ul>
      </Section>

      <Section title={t('guide.start_title')}>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <strong>{t('guide.start_members')}</strong>
            {t('guide.start_members_body')}
          </li>
          <li>
            <strong>{t('guide.start_invitations')}</strong>
            {t('guide.start_invitations_body')}
          </li>
          <li>
            <strong>{t('guide.start_friends')}</strong>
            {t('guide.start_friends_body')}
          </li>
          <li>
            <strong>{t('guide.start_suggest')}</strong>
            {t('guide.start_suggest_body')}
          </li>
          <li>
            <strong>{t('guide.start_outings')}</strong>
            {t('guide.start_outings_body')}
          </li>
        </ol>
      </Section>

      <Section title={t('guide.who_send_title')}>
        <p>
          <Trans
            i18nKey="guide.who_send_body"
            ns="common"
            components={{ em: <em /> }}
          />
        </p>
      </Section>

      <Section title={t('guide.settings_title')}>
        <p>{t('guide.settings_body')}</p>
      </Section>

      <Section title={t('guide.sheet_access_title')}>
        <p>
          <strong>{t('guide.sheet_access_auto')}</strong>
          {t('guide.sheet_access_auto_body')}
        </p>
        <p className="mt-2">
          <strong>{t('guide.sheet_access_miss_label')}</strong>
          {t('guide.sheet_access_miss_body')}
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>
            <strong>{t('guide.sheet_access_add')}</strong>
            {t('guide.sheet_access_add_body')}
            <em>{t('guide.sheet_access_share')}</em>
            {t('guide.sheet_access_share_body')}
          </li>
          <li>
            <strong>{t('guide.sheet_access_remove')}</strong>
            {t('guide.sheet_access_remove_body')}
          </li>
          <li>
            <strong>{t('guide.sheet_access_share_all')}</strong>
            {t('guide.sheet_access_share_all_body')}
          </li>
        </ul>
      </Section>

      <Section title={t('guide.suggest_enh_title')}>
        <p>
          {t('guide.suggest_enh_body_pre')}
          <strong>{t('guide.suggest_enh_bulb')}</strong>
          {t('guide.suggest_enh_body_mid')}
          <strong>{t('guide.suggest_enh_send')}</strong>
          {t('guide.suggest_enh_body_post')}
        </p>
      </Section>

      <Section title={t('guide.insights_title')}>
        <p>{t('guide.insights_body')}</p>
      </Section>

      <Section title={t('guide.language_title')}>
        <p>{t('guide.language_body')}</p>
      </Section>

      <footer className="pt-4 border-t border-gray-200 text-sm text-gray-500">
        {t('guide.footer_pre')}
        <Link to="/admin/release-notes" className="text-knit-primary font-medium hover:underline">
          {t('guide.footer_release')}
        </Link>
        {t('guide.footer_post')}
      </footer>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 text-sm text-gray-700 leading-relaxed">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}
