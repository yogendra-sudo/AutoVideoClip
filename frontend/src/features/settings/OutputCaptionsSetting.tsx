import { settingsApi } from '../../services/api'
import { t } from '../../i18n'
import AppSwitchRow from './AppSwitchRow'

/** The one read/write of output-captions.json. The settings page and the main page both use it. */
export function readOutputCaptions(): Promise<boolean> {
  return settingsApi.getOutputCaptions().then(settings => settings.enabled)
}

export function writeOutputCaptions(enabled: boolean): Promise<boolean> {
  return settingsApi.setOutputCaptions(enabled).then(settings => settings.enabled)
}

export function OutputCaptionsSwitch({ label, hint }: { label: string; hint: string }) {
  return <AppSwitchRow label={label} hint={hint} read={readOutputCaptions} write={writeOutputCaptions} />
}

export default function OutputCaptionsSetting() {
  return <OutputCaptionsSwitch
    label={t('Burn captions on automatic videos')}
    hint={t('On by default. New automatic videos skip burned captions when this is off. The title stays on the cover and is not burned into the video. Existing projects are unchanged, and one clip can turn captions back on in the editor.')}
  />
}
