import { useState } from 'react'
import { t } from '../../i18n'
import { Section } from '../../ui'
import { useFlag } from '../../analytics/flags'
import ImportPreferences from '../studio/ImportPreferences'
import { readImportPreferences, writeImportPreferences } from '../studio/importPreferencesStore'
import { defaultImportOptions } from '../studio/types'

/** Advanced import preferences leave the home page while the legacy-entry flag is on. */
export default function ImportPreferenceSettings() {
  const enabled = useFlag('hide_legacy_entrypoints') === true
  const [value, setValue] = useState(() => readImportPreferences() || { ...defaultImportOptions })
  if (!enabled) return null
  return <Section title={t('Production preferences')} description={t('These preferences apply to the next import. The home page no longer opens them on its own.')}>
    <ImportPreferences value={value} onChange={next => { setValue(next); writeImportPreferences(next) }} />
  </Section>
}
