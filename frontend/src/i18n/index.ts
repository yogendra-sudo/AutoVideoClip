import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en'],
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false }, // React escapes text and interpolated user content.
  react: { useSuspense: false },
})

export const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, values ?? {}) as string
export const getLocale = () => 'en'
document.documentElement.lang = 'en'

export default i18n
