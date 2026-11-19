import { t } from '../../i18n'
import {
  hintKeyForUpstreamError,
  hostnameOfBaseUrl,
  UPSTREAM_ERROR_TYPES,
} from '../../analytics/successRateContract'
import { PROVIDERS, type ProviderKey } from './providers'
import { getCatalog } from './providerPresets'
import { cleanupBaseUrl, normalizeProviderUrl } from './providerUrl'

const catalog = getCatalog()
export const ADDRESS_LOCKED = Object.values(catalog.providers).filter(row => row.locked && row.base_url).map(row => row.id)

export const VALIDATION_ERROR_TYPES = UPSTREAM_ERROR_TYPES
export type ValidationErrorType = (typeof VALIDATION_ERROR_TYPES)[number]
export type ValidationStatus = 'ok' | 'failed' | 'unchecked' | 'transient'

export interface ValidationResult {
  success?: boolean
  ok?: boolean
  result?: 'ok' | 'failed' | 'success' | 'transient'
  error_type?: string
  hint_key?: string
  key_hint?: string | null
  normalized_base_url?: string
  base_url_host?: string
  models?: string[]
  recommended?: Record<string, string[]>
  truncated?: boolean
  message_key?: string
  /** Non-blocking. Set when a custom/local list succeeded but the chosen name is absent. */
  warning?: string
  /** 1.5.7 telemetry: closed-set connection-test code and integer upstream status. */
  error_code?: string
  http_status?: number | null
  config_source?: 'preset' | 'customized'
  /** F2: quick chat probe or full trial run. */
  probe_kind?: 'quick' | 'trial'
  trial_context_ok?: boolean | null
  trial_rate_limited?: boolean | null
  trial_json_ok?: boolean | null
  trial_avg_ms?: number | null
  trial_estimate_requests?: number | null
  trial_estimate_minutes?: number | null
  trial_passed?: boolean | null
}

const KEY_HINTS: Array<[RegExp, ProviderKey]> = [
  [/^AIza/, 'gemini'],
  [/^xai-/, 'grok'],
  [/^sk-proj-/, 'openai'],
  [/^sk-svcacct-/, 'openai'],
  [/^sk-or-/, 'compatible'],
  [/^sk-ant-/, 'compatible'],
]

const CONSOLE_COPY = 'This is a console or website URL, not the model API. Choose the matching provider, or use Custom compatible and enter an endpoint that includes /v1.'
export const VISION_UNSUPPORTED = 'vision_unsupported'
export const VISION_HINT_KEY = 'The model used for visual understanding cannot see images. Settings are saved, but generation will be blocked. In Settings → Providers and models, switch to a vision-capable model.'
export const VISION_BLOCK_MESSAGE = 'The model used for visual understanding cannot see images. In Settings → Providers and models, switch to a vision-capable model, then generate.'

/** Locked presets still show the official default and allow overrides (API endpoint). */
export const canEditAddress = (key?: string) => {
  if (!key) return false
  if (key === 'compatible') return true
  const preset = catalog.providers[key]
  if (!preset) return false
  if (preset.protocol === 'local' && !preset.base_url) return false
  return true
}

export function hintProviderForKey(apiKey?: string | null): ProviderKey | null {
  const key = (apiKey || '').trim()
  for (const [pattern, provider] of KEY_HINTS) {
    if (pattern.test(key)) return provider
  }
  return null
}

export function isConsoleHost(host?: string) {
  const value = (host || '').toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!value) return false
  const current = getCatalog()
  // Match the backend: catalog API and accepted legacy hosts take precedence.
  for (const preset of Object.values(current.providers)) {
    if (preset.accepted_hosts.includes(value)) return false
    try { if (new URL(preset.base_url).hostname.toLowerCase() === value) return false } catch { /* No API host. */ }
  }
  return current.console_hosts.includes(value) || current.console_suffixes.some(suffix => value.endsWith(suffix))
}

export function normalizeCompatibleUrl(raw: string, provider = 'compatible'): { url: string; warnings: string[] } {
  const warnings: string[] = []
  const cleaned = cleanupBaseUrl(raw)
  if (!cleaned) return { url: '', warnings }
  let host = ''
  try { host = new URL(cleaned).hostname.toLowerCase() } catch { return { url: cleaned, warnings } }
  if (isConsoleHost(host)) return { url: cleaned, warnings: ['console_host'] }
  return normalizeProviderUrl(cleaned, provider)
}

export function telemetryHost(url?: string) {
  return hostnameOfBaseUrl(url) || 'unknown'
}

export function validationCopy(errorType?: string, hintKey?: string) {
  if (errorType === 'console_host') return t(CONSOLE_COPY)
  if (errorType === VISION_UNSUPPORTED) return t(hintKey || VISION_HINT_KEY)
  return t(hintKey || hintKeyForUpstreamError(errorType || 'unknown'))
}

export function keyHintCopy(hint: ProviderKey) {
  return t('This key looks like it belongs to {{name}}. We’ll keep the provider you selected and won’t switch automatically.', { name: PROVIDERS[hint]?.name || hint })
}

export function sponsorKeyLink(provider?: string): { label: string; href: string } | null {
  if (provider === 'api88') return { label: t('Get a 88API key'), href: PROVIDERS.api88.keyUrl }
  if (provider === 'infistar') return { label: t('Get an Infistar key'), href: PROVIDERS.infistar.keyUrl }
  if (provider === 'apimart') return { label: t('Get an APIMart key'), href: PROVIDERS.apimart.keyUrl }
  return null
}

export function passed(result?: ValidationResult | null) {
  return !!(result && (result.success || result.ok || result.result === 'ok' || result.result === 'success'))
}
