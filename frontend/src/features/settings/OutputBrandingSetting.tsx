import { settingsApi } from '../../services/api'
import { t } from '../../i18n'
import { beginExperience } from '../../analytics/experience'
import AppSwitchRow from './AppSwitchRow'

export default function OutputBrandingSetting() {
  return <AppSwitchRow
    label={t('Automatically add a branded outro')}
    hint={t('Enabled by default. Adds a 1.8-second AutoClip animation to automatic outputs and their edited exports. Turning it off does not change existing videos.')}
    read={async () => (await settingsApi.getOutputBranding()).enabled}
    write={async (value) => {
      const finish = beginExperience('output_branding_save', { section: 'app', brand_outro_enabled: value })
      try {
        const settings = await settingsApi.setOutputBranding(value)
        finish('completed', { brand_outro_enabled: settings.enabled })
        return settings.enabled
      } catch (error) {
        finish('failed', {}, error)
        throw error
      }
    }}
  />
}
