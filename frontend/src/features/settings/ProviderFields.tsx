import { useState } from 'react'
import { Input, Select } from 'antd'
import { t } from '../../i18n'
import { Btn, Row } from '../../ui'
import { openExternalLink } from '../../utils/externalLinks'
import { trackSponsorLinkOpened } from '../../analytics/events'
import { PROVIDERS, contextHintFor, providerPickerOptions, type ProviderKey } from './providers'
import type { Connection } from './modelSettingsApi'
import { presetKey } from './modelSettingsLogic'
import {
  canEditAddress, hintProviderForKey, keyHintCopy, normalizeCompatibleUrl,
  sponsorKeyLink, validationCopy,
} from './providerAccess'
import { offerPastedKey } from './keyGuideWatch'
import { collapseSpaces, normalizeProviderBaseUrl } from './providerUrl'

const ENDPOINT_ERRORS = new Set(['bad_endpoint', 'connection', 'timeout'])
const KEY_ERRORS = new Set(['invalid_key', 'insufficient_quota', 'permission_denied'])

/**
 * Provider picker + credentials for one connection. Local presets need no key.
 * 「API endpoint」is always editable when the preset has (or needs) a Base URL.
 */
export default function ProviderFields({ connection, ariaPrefix = '', hideProvider, sharedKey, placement, keyHint, onChoose, onEdit }: {
  connection?: Connection
  ariaPrefix?: string
  hideProvider?: boolean
  /** The key is reused from the main AI service; offer an explicit "edit" instead of a second field. */
  sharedKey?: boolean
  placement: 'settings_model' | 'home_setup'
  keyHint?: string | null
  onChoose: (provider: ProviderKey) => void
  onEdit: (patch: Partial<Connection>) => void
}) {
  const [editShared, setEditShared] = useState(false)
  const key = connection ? presetKey(connection) : undefined
  const preset = key ? PROVIDERS[key] : undefined
  const label = (text: string) => ariaPrefix ? `${ariaPrefix} · ${text}` : text
  const picker = !hideProvider && <Row wide label={t('Provider')} hint={preset?.hint || t('Mainland-direct, international and free local models are all available; if unsure, start with “Recommended”.')}>
    <Select aria-label={label(t('Provider'))} value={key} placeholder={t('Choose an AI service')} showSearch optionFilterProp="search" style={{ width: '100%' }} options={providerPickerOptions()}
      onChange={onChoose}
      optionRender={option => { const p = PROVIDERS[option.value as ProviderKey]; return <span>{p.name}{p.sponsor && <small style={{ marginLeft: 8, color: 'var(--sub)', fontWeight: 400 }}>{t('Sponsor')} · {p.sponsor.offer}</small>}</span> }} />
  </Row>
  if (!connection) return <>{picker}</>
  const failed = connection.validation_status === 'failed'
  const transient = connection.validation_status === 'transient'
  const errorType = connection.validation_error_type || ''
  const urlInfo = key === 'compatible' ? normalizeCompatibleUrl(connection.base_url) : null
  const liveHint = hintProviderForKey(connection.api_key) || (keyHint as ProviderKey | undefined)
  const showHint = liveHint && liveHint !== key
  const shownError = (urlInfo?.warnings.includes('console_host') && 'console_host') || ((failed || transient) && errorType) || ''
  const keyLink = sponsorKeyLink(key)
  const addressEditable = canEditAddress(key)
  return <>
    {picker}
    {!preset?.local && (sharedKey && !editShared
      ? <Row wide label={t('API key')} hint={t('Shared with the AI service above; usually no need to change.')}>
          <span className="ac-hint">{t('Reusing shared key')}</span>
          <Btn variant="text" size="sm" onClick={() => setEditShared(true)}>{t('Edit key')}</Btn>
        </Row>
      : <Row wide label={t('API key')} hint={
          preset?.sponsor
            ? undefined
            : preset?.keyUrl
              ? <>{t('Create one on the provider’s site and paste it here.')} <a className="ac-link" href={preset.keyUrl} onClick={e => { e.preventDefault(); openExternalLink(preset.keyUrl) }}>{t('Get an API key')} ↗</a>
                {keyLink && keyLink.href !== preset.keyUrl && <> · <a className="ac-link" href={keyLink.href} onClick={e => { e.preventDefault(); openExternalLink(keyLink.href) }}>{keyLink.label} ↗</a></>}
                {preset.referralUrl && <> · <a className="ac-link" data-author-referral="1" href={preset.referralUrl} onClick={e => { e.preventDefault(); openExternalLink(preset.referralUrl!) }}>{t("Author's referral link")} ↗</a></>}</>
              : t('Optional for self-hosted services')
        }>
          <Input.Password aria-label={label(t('API key'))} autoComplete="new-password" value={connection.api_key ?? ''}
            status={failed && KEY_ERRORS.has(errorType) ? 'error' : undefined}
            placeholder={connection.has_key ? t('Saved; leave blank to keep it') : preset?.placeholder || 'sk-…'}
            onPaste={event => {
              const text = event.clipboardData?.getData('text') || ''
              if (text && offerPastedKey(text, key || connection.provider)) event.preventDefault()
            }}
            onChange={e => onEdit({ api_key: e.target.value.trim() || (connection.has_key ? undefined : '') })}
            onBlur={e => onEdit({ api_key: e.target.value.trim() || (connection.has_key ? undefined : '') })} />
          {preset?.sponsor && (
            <span className="ac-sponsor-inline" data-sponsor={preset.sponsor.id}>
              <Btn
                size="sm"
                className="ac-btn--pill"
                onClick={() => {
                  trackSponsorLinkOpened({ sponsor: preset.sponsor!.id, target: 'register', placement })
                  openExternalLink(preset.sponsor!.registerUrl)
                }}
              >
                {t('Get key')}<span aria-hidden>↗</span>
              </Btn>
            </span>
          )}
        </Row>)}
    {addressEditable && <Row wide label={t('API endpoint')} hint={[
      preset?.local ? t('Local services can use the default endpoint.')
        : connection.base_url ? t('Default filled in; you can change it.')
        : t('Required; usually ends in /v1.'),
      contextHintFor(key, connection.base_url),
    ].filter(Boolean).join(' ') || undefined}>
      <Input aria-label={label(t('API endpoint'))} value={connection.base_url}
        status={(urlInfo?.warnings.includes('console_host') || (failed && ENDPOINT_ERRORS.has(errorType))) ? 'error' : undefined}
        placeholder={preset?.local?.baseUrl || (key === 'dashscope' ? 'https://dashscope.aliyuncs.com/api/v1' : 'https://example.com/v1')}
        onChange={e => onEdit({ base_url: collapseSpaces(e.target.value) })}
        onBlur={() => {
          const stripped = key === 'compatible' ? normalizeCompatibleUrl(connection.base_url).url : connection.base_url
          const url = normalizeProviderBaseUrl(stripped, key)
          if (url !== connection.base_url) onEdit({ base_url: url })
        }} />
    </Row>}
    {showHint && <p className="ac-note">{keyHintCopy(liveHint)}</p>}
    {shownError && <p className={transient ? 'ac-note' : 'ac-note ac-note--error'} role={transient ? 'status' : 'alert'}>{validationCopy(shownError)}</p>}
    {failed && keyLink && KEY_ERRORS.has(errorType) && <p className="ac-note">
      <a className="ac-link" href={keyLink.href} onClick={e => { e.preventDefault(); openExternalLink(keyLink.href) }}>{keyLink.label} ↗</a>
    </p>}
  </>
}
