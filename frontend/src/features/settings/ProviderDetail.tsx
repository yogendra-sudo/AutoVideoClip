import { t } from '../../i18n'
import { Btn, Icon, Row, StatusDot } from '../../ui'
import { openExternalLink } from '../../utils/externalLinks'
import SpeechRecognitionConfig from '../../components/SpeechRecognitionConfig'
import type { ProviderPreset } from './providerPresets'
import type { ModelSettingsStore } from './useModelSettings'
import ProviderFields from './ProviderFields'
import SenseVoiceConfig from './SenseVoiceConfig'
import { validationCopy } from './providerAccess'
import TrialRunPanel from './TrialRunPanel'
import {
  catalogDraftConnection, connectKind, displayNameOf, findCatalogConnection, isCatalogConfigured, isCatalogConnected,
  type LocalAsrReady,
} from './providerCatalogView'
import { providerIcon } from './providerIcons'
import ProviderQualityMarks from './providerQualityMarks'
import { enabledModelIds } from './modelVisibility'

const CAP_KEY: Record<string, string> = {
  language: 'Language',
  asr: 'Speech-to-text',
  tts: 'Text-to-speech',
  image: 'Image',
  music: 'Music',
  video: 'Video',
}

type DetailModel = { id: string; analysis?: boolean; image?: boolean; asr?: boolean; capability?: string | null; kind?: string }
type GroupKey = 'language' | 'image' | 'asr' | 'audio' | 'video' | 'other'
// Group by the backend `kind` (derived from the provider's /models type metadata); flags only for older backends.
export function modelGroupOf(m: DetailModel): GroupKey {
  if (m.kind && ['language', 'image', 'asr', 'audio', 'video', 'other'].includes(m.kind)) return m.kind as GroupKey
  if (m.asr) return 'asr'
  if (m.image) return 'image'
  if (m.analysis) return 'language'
  return 'other'
}
// Each model lands in exactly one group, so the header count equals the rows. No per-group limits.
const MODEL_GROUP: Array<{ key: GroupKey; title: string; open: boolean }> = [
  { key: 'language', title: 'Language', open: true },
  { key: 'image', title: 'Image generation', open: true },
  { key: 'asr', title: 'Speech recognition', open: true },
  { key: 'audio', title: 'Speech synthesis / Audio', open: false },
  { key: 'video', title: 'Video', open: false },
  { key: 'other', title: 'Other types', open: false },
]

export default function ProviderDetail({
  preset, m, asrReady = {}, onBack,
}: {
  preset: ProviderPreset
  m: ModelSettingsStore
  asrReady?: LocalAsrReady
  onBack: () => void
}) {
  const { settings, lists, busy, listErrors } = m
  if (!settings) return null
  const kind = connectKind(preset)
  const persisted = findCatalogConnection(settings, preset)
  const draft = persisted || catalogDraftConnection(preset)
  const connection = draft && {
    ...draft,
    base_url: draft.base_url || preset.base_url || '',
  }
  const connected = isCatalogConnected(settings, preset, asrReady)
  const list = connection ? lists[connection.id] : undefined
  // Only a real (live/cache, non-preview) fetch shows models; catalog/preview reference IDs would mislead.
  const fetched = !!list && list.preview !== true && list.source !== 'catalog'
  const models = fetched ? list!.models : []
  const needsEndpoint = kind === 'needs_endpoint' || (kind === 'guide' && !preset.base_url)
  const canTest = kind === 'legacy' || kind === 'compatible' || needsEndpoint
  const isSponsor = !!preset.sponsor

  // Visibility only: no revalidation, no list reset. Only enabled IDs reach the default-model pickers.
  const enabledSet = persisted && list ? enabledModelIds(settings, persisted, list.models) : new Set<string>()
  const customized = Array.isArray(persisted?.enabled_model_ids)
  const toggleModels = (ids: string[], on: boolean) => {
    if (!persisted) return
    const next = new Set(enabledSet)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    m.update({ connections: settings.connections.map(c => c.id === persisted.id ? { ...c, enabled_model_ids: [...next] } : c) })
  }
  const resetRecommended = () => {
    if (!persisted) return
    m.update({ connections: settings.connections.map(c => c.id === persisted.id ? { ...c, enabled_model_ids: null } : c) })
  }

  const persistEdit = (patch: Parameters<typeof m.editConnection>[1]) => {
    if (persisted) m.editConnection(persisted, patch)
    else m.ensureCatalogProvider(preset.id, patch)
  }

  const onTest = () => {
    if (!connection) return
    void m.testCatalogProvider(preset.id, {
      api_key: connection.api_key,
      base_url: connection.base_url,
      has_key: connection.has_key,
    }, 'quick')
  }

  const showModels = kind !== 'local_asr' && kind !== 'guide'
  const showConnectPanel = kind !== 'local_asr'
  const name = t(displayNameOf(preset))
  const icon = providerIcon(preset.id)
  const testing = m.testing
  const listing = connection && busy[connection.id]
  const status = connection?.validation_status
  const testDisabled = !connection || testing || (
    preset.auth === 'api_key' && !(connection.api_key || '').trim() && !connection.has_key
  ) || (!connection.base_url.trim() && !preset.base_url && preset.protocol !== 'local')

  return (
    <div className="ac-provider-detail" data-provider-id={preset.id} data-connect-kind={kind} data-layout="v6-stack" data-sponsor={isSponsor ? '1' : undefined}>
      <button type="button" className="ac-back" onClick={onBack}>
        <Icon.Back />{t('Back to providers')}
      </button>
      <header className="ac-provider-detail-head">
        <h3 className="ac-model-section-title">
          {icon && (
            <span className={`ac-provider-mark has-icon is-${icon.tone} ac-provider-mark--title`} aria-hidden>
              <img src={icon.src} alt="" />
            </span>
          )}
          {name}
          {isSponsor && (
            <span className="ac-badge">
              {preset.sponsor!.offer
                ? t('Sponsor · {{offer}}', { offer: t(preset.sponsor!.offer) })
                : t('Sponsor')}
            </span>
          )}
          {connected && <StatusDot tone="ok" label={preset.auth === 'none' ? t('Available') : t('Connected')} />}
          {!connected && isCatalogConfigured(settings, preset) && <span className="ac-badge">{t('Configured')}</span>}
        </h3>
        {/* Sponsors: no long hint / marketing. Others keep one short line. */}
        {!isSponsor && <p className="ac-note">{t(preset.hint)}</p>}
        <ProviderQualityMarks preset={preset} />
        {!isSponsor && (
          <div className="ac-provider-caps">
            {preset.capabilities.map(capability => CAP_KEY[capability] && (
              <span key={capability} className="ac-provider-cap">{t(CAP_KEY[capability])}</span>
            ))}
          </div>
        )}
      </header>

      <div className="ac-provider-detail-stack">
        {showConnectPanel && (
          <section className="ac-provider-detail-card" data-panel="connect">
            {needsEndpoint && (
              <p className="ac-note">{t('Enter the API endpoint, then test the connection.')}</p>
            )}

            {(kind === 'legacy' || kind === 'compatible') && connection && (
              <ProviderFields
                connection={connection}
                hideProvider
                placement="settings_model"
                keyHint={persisted ? m.keyHints[persisted.id] : undefined}
                onChoose={() => undefined}
                onEdit={persistEdit}
              />
            )}

            {needsEndpoint && connection && (
              <ProviderFields
                connection={connection}
                hideProvider
                placement="settings_model"
                keyHint={persisted ? m.keyHints[persisted.id] : undefined}
                onChoose={() => undefined}
                onEdit={persistEdit}
              />
            )}

            {kind === 'guide' && !needsEndpoint && (
              <div className="ac-empty">
                <b>{t('This provider’s native protocol is not wired yet. Use a recommended, popular, or local provider in this version.')}</b>
                {preset.docs_url && (
                  <Btn variant="text" size="sm" onClick={() => openExternalLink(preset.docs_url)}>
                    {t('Setup guide')}<Icon.External size={12} />
                  </Btn>
                )}
              </div>
            )}

            {canTest && connection && (
              <div className="ac-provider-test-row">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Btn size="sm" className="ac-btn--pill" disabled={testDisabled} loading={(testing && m.testingKind === 'quick') || !!listing} onClick={onTest}>
                    {t('Quick test')}
                  </Btn>
                  <Btn size="sm" className="ac-btn--pill" disabled={testDisabled} loading={testing && m.testingKind === 'trial'} onClick={() => {
                    if (!connection) return
                    void m.testCatalogProvider(preset.id, {
                      api_key: connection.api_key,
                      base_url: connection.base_url,
                      has_key: connection.has_key,
                    }, 'trial')
                  }}>
                    {t('Trial run')}
                  </Btn>
                  {testing && m.testingKind === 'trial' && (
                    <Btn size="sm" variant="text" onClick={() => m.cancelTrial()}>{t('Cancel trial')}</Btn>
                  )}
                </div>
                {status === 'failed' && (
                  <p className="ac-note ac-note--error" role="alert">{validationCopy(connection.validation_error_type)}</p>
                )}
                {status === 'transient' && (
                  <p className="ac-note" role="status">{validationCopy(connection.validation_error_type)}</p>
                )}
                {m.testWarning?.id === connection.id && status !== 'failed' && (
                  <p className="ac-note" role="status">{m.testWarning.text}</p>
                )}
                <TrialRunPanel
                  result={(m.lastTrialByConnection || {})[connection.id]}
                  trialStatus={connection.trial_status}
                />
              </div>
            )}
          </section>
        )}

        {kind === 'local_asr' && (
          <section className="ac-provider-detail-card" data-panel="connect">
            <h4 className="ac-provider-models-title">{t('Configuration')}</h4>
            {preset.id === 'whisper' && (
              <>
                {settings.transcription?.provider !== 'whisper_local' && (
                  <Row label={t('Use Whisper')} hint={t(preset.hint)}>
                    <Btn size="sm" onClick={() => m.selectLocalAsrProvider('whisper')}>{t('Use Whisper')}</Btn>
                  </Row>
                )}
                <SpeechRecognitionConfig
                  hideProvider
                  selectedModel={settings.transcription?.provider === 'whisper_local' ? (settings.transcription.model || 'base') : 'base'}
                  onModelChange={m.setTranscriptionLocal}
                />
              </>
            )}
            {preset.id === 'sensevoice' && (
              <>
                {settings.transcription?.provider !== 'sensevoice_local' && (
                  <Row label={t('Use SenseVoice')} hint={t(preset.hint)}>
                    <Btn size="sm" onClick={() => m.selectLocalAsrProvider('sensevoice')}>{t('Use SenseVoice')}</Btn>
                  </Row>
                )}
                <SenseVoiceConfig />
              </>
            )}
          </section>
        )}

        {showModels && (
          <section className="ac-provider-detail-card" data-panel="models">
            <h4 className="ac-provider-models-title">
              {t('Available models')}
              <span className="count">{fetched ? (persisted ? `${t('Enabled')} ${models.filter(x => enabledSet.has(x.id)).length} / ${models.length}` : models.length) : t('Fetched after a successful test')}</span>
            </h4>
            {connection && busy[connection.id] && <p className="ac-note">{t('Fetching…')}</p>}
            {connection && listErrors[connection.id] && <p className="ac-note">{t('Models appear here after you connect.')}</p>}
            {fetched && models.length > 0 && persisted && (
              <p className="ac-note ac-provider-model-hint" data-visibility={customized ? 'custom' : 'recommended'}>
                {customized ? t('Using your selection; default models are chosen only from checked ones.') : t('Recommended models are checked for you; add or remove as you like. Default models are chosen only from checked ones.')}
                {customized && <button type="button" className="ac-link-button" onClick={resetRecommended}>{t('Restore recommended')}</button>}
              </p>
            )}
            {fetched && models.length > 0 && <ModelGroups models={models} enabled={enabledSet} onToggle={persisted ? toggleModels : undefined} />}
            {connection && !busy[connection.id] && !fetched && (
              <p className="ac-note" data-models-hint="pending">{t('Enter the API key and test it to fetch available models automatically.')}</p>
            )}
            {connection && !busy[connection.id] && fetched && !models.length && (
              <p className="ac-note">{t('Models appear here after you connect.')}</p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function ModelGroups({ models, enabled: on, onToggle }: {
  models: Array<DetailModel>
  enabled: Set<string>
  onToggle?: (ids: string[], enabled: boolean) => void
}) {
  return (
    <>
      {MODEL_GROUP.map(group => {
        const rows = models.filter(model => modelGroupOf(model) === group.key).sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)))
        if (!rows.length) return null
        const enabled = rows.filter(model => on.has(model.id)).length
        const renderRow = (model: DetailModel) => (
          <li key={model.id} className={`ac-mono${!on.has(model.id) && onToggle ? ' is-hidden' : ''}`} data-model-id={model.id}>
            {onToggle
              ? <label className="ac-provider-model-check">
                  <input type="checkbox" checked={on.has(model.id)} aria-label={`${t('Enable')} ${model.id}`} onChange={event => onToggle([model.id], event.target.checked)} />
                  <span>{model.id}</span>
                </label>
              : model.id}
            {group.key === 'language' && model.capability === 'multimodal' && (
              <span className="ac-provider-cap">{t('Vision')}</span>
            )}
          </li>
        )
        return (
          <details key={group.key} className="ac-provider-model-block" data-model-group={group.key} open={group.open || (!!onToggle && enabled > 0)}>
            <summary className="ac-provider-model-group">
              {t(group.title)}<span className="count">{onToggle ? `${enabled}/${rows.length}` : rows.length}</span>
              {onToggle && (
                <span className="ac-provider-model-bulk">
                  <button type="button" disabled={enabled === rows.length} onClick={event => { event.preventDefault(); onToggle(rows.map(m => m.id), true) }}>{t('Enable all')}</button>
                  <button type="button" disabled={enabled === 0} onClick={event => { event.preventDefault(); onToggle(rows.map(m => m.id), false) }}>{t('Disable all')}</button>
                </span>
              )}
            </summary>
            {(onToggle ? rows.filter(model => on.has(model.id)) : rows).length > 0 && (
              <ul className="ac-provider-model-list" data-model-rows="enabled">
                {(onToggle ? rows.filter(model => on.has(model.id)) : rows).map(model => renderRow(model))}
              </ul>
            )}
            {onToggle && rows.length > enabled && (
              <details className="ac-provider-model-off" data-model-rows="disabled">
                <summary>{t('Not enabled')}<span className="count">({rows.length - enabled})</span></summary>
                <ul className="ac-provider-model-list">
                  {rows.filter(model => !on.has(model.id)).map(model => renderRow(model))}
                </ul>
              </details>
            )}
          </details>
        )
      })}
    </>
  )
}
