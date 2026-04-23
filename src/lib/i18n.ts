import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from '../locales/en/common.json'
import enOnboarding from '../locales/en/onboarding.json'
import enAdmin from '../locales/en/admin.json'
import enSheet from '../locales/en/sheet.json'
import esCommon from '../locales/es/common.json'
import esOnboarding from '../locales/es/onboarding.json'
import esAdmin from '../locales/es/admin.json'
import esSheet from '../locales/es/sheet.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        onboarding: enOnboarding,
        admin: enAdmin,
        sheet: enSheet,
      },
      es: {
        common: esCommon,
        onboarding: esOnboarding,
        admin: esAdmin,
        sheet: esSheet,
      },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'es'],
    ns: ['common', 'onboarding', 'admin', 'sheet'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

export default i18n
