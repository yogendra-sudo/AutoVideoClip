import { useSyncExternalStore } from 'react'
import { t } from '../../i18n'
import { Row, Section } from '../../ui'
import {
  FLAG_DEFAULTS, FLAG_NAMES, FLAG_SPEC, flagOverride, setFlagOverride, subscribeFlags,
  type FlagName, type FlagValue,
} from '../../analytics/flags'

const LABELS: Record<FlagName, string> = {
  autovideoclip_safe_mode: 'Turn off every new feature',
  remember_platforms: 'Remember the last platforms',
  one_click_paste_start: 'Start when a link is pasted',
  link_import_without_whisper: 'Link import does not wait for local transcription',
  notify_on_done: 'Notify when a cut is ready',
  publish_pack_v2: 'Copy the caption and save the video and cover',
  render_top_first: 'Render the highest-scoring clips first',
  clip_reasons: 'Show why a clip was chosen',
  hide_legacy_entrypoints: 'Hide the legacy entry points',
  import_drop_zone: 'Use a centered drop zone on the home page',
  track_overrides: 'Record changes to automatic choices',
  qa_gate_blocking: 'Export quality check',
  pkg_templates_v1: 'Editing styles',
  pkg_template_picker_visual: 'Editing style cards',
  mcp_v2_tools: 'MCP New tools（CancelTask、Editing StyleList）',
}

const VARIANT_LABELS: Record<string, string> = {
  button: 'Keep the current button',
  autostart: 'Start automatically after paste',
  separate: 'Copy and export separately',
  combined: 'One combined action',
  limit10: 'Render the top 10 automatically',
  top3: 'Render the top 3 automatically',
  off: 'Close',
  shadow: 'Record only, do not block',
  block: 'Block (still records only)',
}

function choice(override: FlagValue | null): string {
  if (override === null) return ''
  return String(override)
}

/** The panel is a developer tool. `vite build` sets DEV to false, so release builds omit it. */
export function flagOverridesVisible(): boolean {
  return import.meta.env.DEV === true
}

/** Local overrides for internal checks. Remote flags are never requested from here. */
export default function FlagOverrides() {
  useSyncExternalStore(subscribeFlags, () => FLAG_NAMES.map(name => String(flagOverride(name))).join('|'), () => '')
  if (!flagOverridesVisible()) return null
  return <Section title={t('Experiments')} description={t('Override feature flags on this computer only. With anonymous analytics off, no flag request is sent, and anything without an override stays off.')}>
    <div className="ac-rows">
      {FLAG_NAMES.map(name => {
        const spec = FLAG_SPEC[name]
        const override = flagOverride(name)
        const options = spec.kind === 'boolean'
          ? [{ value: 'true', label: t('On') }, { value: 'false', label: t('Close') }]
          : spec.variants.map(value => ({ value, label: t(VARIANT_LABELS[value] || value) }))
        return <Row key={name} label={t(LABELS[name])} hint={name}>
          <select className="ac-input ac-flag-select" aria-label={t(LABELS[name])} value={choice(override)} onChange={event => {
            const next = event.target.value
            if (!next) setFlagOverride(name, null)
            else if (spec.kind === 'boolean') setFlagOverride(name, next === 'true')
            else setFlagOverride(name, next)
          }}>
            <option value="">{t('Follow default')} · {spec.kind === 'boolean' ? (FLAG_DEFAULTS[name] ? t('On') : t('Close')) : t(VARIANT_LABELS[String(FLAG_DEFAULTS[name])] || String(FLAG_DEFAULTS[name]))}</option>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Row>
      })}
    </div>
  </Section>
}
