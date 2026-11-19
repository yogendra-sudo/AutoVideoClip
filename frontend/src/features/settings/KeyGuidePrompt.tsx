import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select, Input } from 'antd'
import { t } from '../../i18n'
import { Btn, Dialog, Row } from '../../ui'
import { modelSettingsApi } from './modelSettingsApi'
import { getCatalog } from './providerPresets'
import { isLiveConnectable } from './providerCatalogView'
import {
  CUSTOM_PROVIDER_ID, hostOf, keyTail, needsOverwrite, normalizeGuideBaseUrl,
  type GuideEndpoint, type GuideTarget,
} from './keyGuide'
import { clearOffer, commitKeyGuide, currentOffer, onClipboardScanRequest, subscribeOffers, type KeyOffer } from './keyGuideBus'
import { dismissCurrentOffer, scanClipboard, setKeyGuideTargets } from './keyGuideWatch'

function guideTargets(): GuideTarget[] {
  return Object.values(getCatalog().providers)
    .filter(preset => isLiveConnectable(preset) && preset.auth === 'api_key' && preset.protocol !== 'local')
    .map(preset => ({
      id: preset.id,
      hosts: [...preset.accepted_hosts, hostOf(preset.base_url)].filter(Boolean),
    }))
}

function choiceLabel(id: string): string {
  if (id === CUSTOM_PROVIDER_ID) return t('Custom compatible endpoint')
  const preset = getCatalog().providers[id]
  return t(preset?.ui_name || preset?.display_name || id)
}

export default function KeyGuidePrompt() {
  const navigate = useNavigate()
  const [offer, setOffer] = useState<KeyOffer | null>(currentOffer())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [endpoints, setEndpoints] = useState<GuideEndpoint[]>([])
  const [busy, setBusy] = useState(false)
  const [emptyNote, setEmptyNote] = useState(false)
  const targets = useMemo(guideTargets, [])
  setKeyGuideTargets(targets)
  useEffect(() => onClipboardScanRequest(() => {
    void scanClipboard('button').then(result => { if (result === 'empty') setEmptyNote(true) })
  }), [])
  useEffect(() => subscribeOffers(next => {
    setOffer(next)
    setEmptyNote(false)
    if (next && (next.source === 'deeplink' || next.source === 'paste')) setDialogOpen(true)
  }), [])

  useEffect(() => {
    if (!offer) return
    setProviderId(offer.hintedProviderId || '')
    setBaseUrl(offer.baseUrl || '')
  }, [offer])

  useEffect(() => {
    if (!dialogOpen) return
    let alive = true
    void modelSettingsApi.get().then(value => {
      if (!alive) return
      setEndpoints((value.connections || []).map(connection => ({
        id: connection.id,
        providerId: connection.provider,
        baseUrl: connection.base_url || '',
        apiKey: connection.api_key,
        hasKey: !!connection.has_key,
      })))
    }).catch(() => { if (alive) setEndpoints([]) })
    return () => { alive = false }
  }, [dialogOpen])

  if (!offer && !emptyNote) return null

  const choices = [
    ...targets.map(target => ({ value: target.id, label: choiceLabel(target.id) })),
    { value: CUSTOM_PROVIDER_ID, label: choiceLabel(CUSTOM_PROVIDER_ID) },
  ]
  const selected = providerId || undefined
  const custom = providerId === CUSTOM_PROVIDER_ID
  const preset = !custom && providerId ? getCatalog().providers[providerId] : undefined
  const endpoint = endpoints.find(item => (
    custom
      ? item.providerId === 'compatible' && hostOf(item.baseUrl) === hostOf(baseUrl)
      : item.providerId === providerId
  ))
  const replace = !!offer && needsOverwrite(endpoint, offer.key)
  const urlReady = !custom || !!normalizeGuideBaseUrl(baseUrl)
  const canConfirm = !!offer && !!providerId && urlReady && !busy

  const close = () => {
    setDialogOpen(false)
    if (offer) void dismissCurrentOffer(offer.key)
    clearOffer()
    setEmptyNote(false)
  }

  const confirm = async () => {
    if (!offer || !canConfirm) return
    setBusy(true)
    try {
      const result = await commitKeyGuide({
        providerId,
        apiKey: offer.key,
        baseUrl: custom ? baseUrl : (preset?.base_url || baseUrl),
        overwrite: true,
      })
      if (result.blocked || (!result.ok && !result.deferred)) return
      void dismissCurrentOffer(offer.key)
      clearOffer()
      setDialogOpen(false)
      const presetQuery = custom ? '' : providerId
      navigate(presetQuery ? `/settings?section=ai&provider=${encodeURIComponent(presetQuery)}` : '/settings?section=ai')
    } finally {
      setBusy(false)
    }
  }

  const banner = offer && offer.source === 'clipboard' && !dialogOpen
  return <>
    {banner && (
      <div className="ac-key-guide" role="status">
        <p>{t('The clipboard has text that looks like an API key.')}</p>
        <Btn size="sm" onClick={() => setDialogOpen(true)}>{t('Add to provider')}</Btn>
        <Btn variant="text" size="sm" onClick={close}>{t('Ignore')}</Btn>
      </div>
    )}
    {emptyNote && !offer && (
      <div className="ac-key-guide" role="status">
        <p>{t('The clipboard does not contain a recognizable API key.')}</p>
        <Btn variant="text" size="sm" onClick={() => setEmptyNote(false)}>{t('Ignore')}</Btn>
      </div>
    )}
    <Dialog
      open={!!offer && dialogOpen}
      onClose={close}
      title={t('Add an API key')}
      description={offer?.source === 'deeplink' ? t('An external link brought an API key. It is saved only after you confirm.') : offer?.source === 'paste' ? t('This key looks like {{name}}. Move it there?', { name: choiceLabel(offer.hintedProviderId || '') }) : t('The clipboard has text that looks like an API key.')}
      footer={<>
        <Btn variant="text" size="sm" onClick={close}>{t('Ignore')}</Btn>
        <Btn variant="cta" size="sm" disabled={!canConfirm} loading={busy} onClick={() => void confirm()}>
          {replace ? t('Replace the saved key') : t('Add to provider')}
        </Btn>
      </>}
    >
      {offer && <div className="ac-rows ac-key-guide-fields">
        <p className="ac-note">{t('Key ending in {{tail}}', { tail: keyTail(offer.key) })}</p>
        {offer.conflict && <p className="ac-note" role="status">{t('The link address and the key prefix do not match. Choose the provider yourself.')}</p>}
        <Row stack wide label={t('Choose a provider')}>
          <Select
            aria-label={t('Choose a provider')}
            value={selected}
            placeholder={t('Choose a provider first. This key does not say which one.')}
            options={choices}
            onChange={value => setProviderId(value)}
          />
        </Row>
        {(custom || !preset?.base_url) && (
          <Row stack wide label={t('API base URL')}>
            <Input
              aria-label={t('API base URL')}
              value={baseUrl}
              placeholder="https://example.com/v1"
              onChange={event => setBaseUrl(event.target.value)}
            />
          </Row>
        )}
        {replace && <p className="ac-note" role="status">{t('A key is already saved. Confirm replaces it; cancel keeps the current one.')}</p>}
        {!providerId && <p className="ac-note">{t('Choose a provider first. This key does not say which one.')}</p>}
      </div>}
    </Dialog>
  </>
}
