import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { Btn, Icon, Row, Section, StatusDot } from '../../ui'
import api, { speechApi } from '../../services/api'
import { useModelSettings, type ModelSettingsStore } from './useModelSettings'
import { mainConnection, validationTargets, visionFollowLacksCapability, VISION_HINT_KEY, type SaveIssue } from './modelSettingsLogic'
import TrialRunPanel from './TrialRunPanel'
import type { Connection, ModelSettings } from './modelSettingsApi'
import ProviderFields from './ProviderFields'
import ModelPicker from './ModelPicker'
import ProviderCatalog from './ProviderCatalog'
import ProviderDetail from './ProviderDetail'
import {
  catalogPreset, customConnectionId, sensevoiceAsrReady, whisperAsrReady,
  type CapabilityFilter, type LocalAsrReady,
} from './providerCatalogView'
import DefaultModels from './DefaultModels'
import {
  applyRequestedCloudTranscription, cloudTranscriptionDiscoverTargets, cloudTranscriptionSavePatch,
  cloudTranscriptionWaitExpired, CLOUD_TRANSCRIPTION_WAIT_MS,
} from './defaultModelSlots'
import AddCustomProviderDialog from './AddCustomProviderDialog'
import { requestClipboardScan, takePendingSelect } from './keyGuideBus'

function useLocalAsrReady(settings: ModelSettings | null): LocalAsrReady {
  const [ready, setReady] = useState<LocalAsrReady>({})
  useEffect(() => {
    if (!settings) return
    let alive = true
    const load = async () => {
      try {
        const [runtime, models] = await Promise.all([speechApi.getRuntimeStatus(), speechApi.getModels()])
        let sense: { status?: string } | null = null
        try { sense = await api.get('/sensevoice/status') } catch { sense = null }
        if (!alive) return
        const selected = settings.transcription?.provider === 'whisper_local' ? (settings.transcription.model || 'base') : 'base'
        setReady({
          whisper: whisperAsrReady(runtime, models, selected),
          sensevoice: sensevoiceAsrReady(sense),
        })
      } catch { /* keep last known readiness */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [settings?.transcription?.provider, settings?.transcription?.model])
  return ready
}

const ANCHORS: Record<string, string> = {
  model: 'ai-defaults', analysis: 'ai-defaults-analysis', vision: 'ai-defaults-vision',
  speech: 'ai-defaults-transcription', cover: 'ai-defaults-cover',
}
const issueAnchor = (issue: SaveIssue) => (
  `ai-defaults-${issue.role}`
)

function CustomGatewayRepair({ connection, m, onBack }: { connection: Connection; m: ModelSettingsStore; onBack: () => void }) {
  const { settings, lists, busy, listErrors } = m
  if (!settings) return null
  const main = mainConnection(settings)
  const isAnalysis = main?.id === connection.id
  const list = lists[connection.id]
  return (
    <div className="ac-provider-detail" data-provider-id="compatible" data-connect-kind="compatible">
      <button type="button" className="ac-back" onClick={onBack}>
        <Icon.Back />{t('Back to providers')}
      </button>
      <h3 className="ac-model-section-title">{connection.name || t('Custom OpenAI-compatible API')}</h3>
      <p className="ac-note">{t('This is a saved custom OpenAI-compatible gateway. You can change its address or key.')}</p>
      <ProviderFields
        connection={connection}
        placement="settings_model"
        keyHint={m.keyHints[connection.id]}
        onChoose={p => m.chooseProvider('analysis', p)}
        onEdit={patch => m.editConnection(connection, patch)}
      />
      {isAnalysis && settings.analysis
        ? <Row wide label={t('Currently used for highlight analysis')} hint={t('A recommended model is selected; change it any time.')}>
            <ModelPicker
              role="analysis"
              model={settings.analysis.model || ''}
              capability={settings.analysis.capability}
              connection={connection}
              list={list}
              busy={!!busy[connection.id]}
              listError={listErrors[connection.id]}
              mode={settings.analysis_mode}
              onChange={value => m.update({ analysis: { connection_id: connection.id, model: value, capability: 'auto', model_source: 'user' } })}
              onCapability={capability => settings.analysis && m.update({ analysis: { ...settings.analysis, capability } })}
              onRefresh={() => void m.discover(connection, true)}
              actions={(
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Btn variant="text" size="sm" disabled={!settings.analysis.model} loading={m.testing && m.testingKind === 'quick'} onClick={() => void m.test('analysis', 'quick')}>{t('Quick test')}</Btn>
                  <Btn variant="text" size="sm" disabled={!settings.analysis.model} loading={m.testing && m.testingKind === 'trial'} onClick={() => void m.test('analysis', 'trial')}>{t('Trial run')}</Btn>
                  {m.testing && m.testingKind === 'trial' && (
                    <Btn variant="text" size="sm" onClick={() => m.cancelTrial()}>{t('Cancel trial')}</Btn>
                  )}
                </span>
              )}
            />
            {m.testWarning?.id === connection.id && (
              <p className="ac-note" role="status">{m.testWarning.text}</p>
            )}
            <TrialRunPanel result={m.lastTrialByConnection[connection.id]} trialStatus={connection.trial_status} />
          </Row>
        : <Row label={t('Use for analysis')} hint={t('After you save, highlight analysis will use this connected provider.')}>
            <Btn size="sm" onClick={() => m.assignAnalysisConnection(connection)}>{t('Use for analysis')}</Btn>
          </Row>}
    </div>
  )
}

export default function AIModelSettings({ requestedSection, requestedProvider = '' }: { requestedSection: string; requestedProvider?: string }) {
  useTranslation()
  const m = useModelSettings()
  const { settings } = m
  const asrReady = useLocalAsrReady(settings)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CapabilityFilter>('all')
  const [moreOpen, setMoreOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() => catalogPreset(requestedProvider)?.id || null)
  const selected = catalogPreset(selectedId)
  const customSelected = settings?.connections.find(connection => connection.id === customConnectionId(selectedId))

  useEffect(() => {
    const preset = catalogPreset(requestedProvider)
    if (preset) setSelectedId(preset.id)
  }, [requestedProvider])
  useEffect(() => {
    const pending = takePendingSelect()
    if (pending) setSelectedId(pending)
  }, [settings])

  const cloudChoice = useRef(false)
  const cloudPending = useRef(false)
  const cloudDiscover = useRef(false)
  const cloudWaitStarted = useRef<number | null>(null)
  const [cloudTimedOut, setCloudTimedOut] = useState(false)
  const [cloudChecking, setCloudChecking] = useState(false)
  const [cloudNote, setCloudNote] = useState<{ provider: string; model: string } | null>(null)
  const lists = m.lists
  useEffect(() => {
    if (requestedProvider !== 'cloud' || !settings || cloudDiscover.current) return
    cloudDiscover.current = true
    for (const connection of cloudTranscriptionDiscoverTargets(settings)) {
      if (!lists[connection.id]) void m.discover(connection, false, 'manual')
    }
  }, [requestedProvider, settings, lists])
  useEffect(() => {
    if (!settings || cloudChoice.current) return
    const result = applyRequestedCloudTranscription(requestedProvider, settings, lists, { timedOut: cloudTimedOut })
    if (result.kind === 'idle') { setCloudChecking(false); return }
    if (result.kind === 'wait') {
      setCloudChecking(true)
      if (cloudWaitStarted.current == null) cloudWaitStarted.current = Date.now()
      const started = cloudWaitStarted.current
      if (cloudTranscriptionWaitExpired(started, Date.now())) { setCloudTimedOut(true); return }
      const timer = window.setTimeout(() => setCloudTimedOut(true), CLOUD_TRANSCRIPTION_WAIT_MS - (Date.now() - started))
      return () => window.clearTimeout(timer)
    }
    cloudChoice.current = true
    setCloudChecking(false)
    if (result.kind === 'selected') {
      const transcription = result.settings.transcription
      const note = { provider: result.providerLabel, model: result.model }
      m.update({ transcription })
      void m.save({ transcription }).then(saved => {
        if (saved.ok && !saved.validationFailed) setCloudNote(note)
      })
    } else {
      cloudPending.current = true
      setSelectedId('dashscope')
    }
  }, [requestedProvider, settings, lists, cloudTimedOut])

  const [customOpen, setCustomOpen] = useState(false)
  useEffect(() => {
    const anchor = ANCHORS[requestedSection]
    if (!settings || !anchor || selectedId) return
    const timer = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }), 0)
    return () => window.clearTimeout(timer)
  }, [requestedSection, !!settings, selectedId])

  const openProvider = (id: string) => {
    setSelectedId(id)
  }
  const closeProvider = () => setSelectedId(null)

  if (!settings) return <Section title={t('Providers & models')}><p className="ac-note">{m.error || t('Loading…')}</p>{m.error && <Btn onClick={() => void m.load()}>{t('Retry')}</Btn>}</Section>
  const save = async () => {
    const patch = cloudTranscriptionSavePatch(cloudPending.current, settings, m.lists)
    const result = await m.save(patch)
    if (result.ok && !result.validationFailed && patch?.transcription?.provider === 'cloud' && patch.transcription.model) {
      cloudPending.current = false
      const chosen = applyRequestedCloudTranscription('cloud', { ...settings, ...patch }, m.lists)
      if (chosen.kind === 'selected') setCloudNote({ provider: chosen.providerLabel, model: chosen.model })
    }
    if (result.issue) document.getElementById(issueAnchor(result.issue))?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else if (result.validationFailed) document.getElementById('ai-defaults')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const visionFailed = visionFollowLacksCapability(settings, m.lists)
  const failed = validationTargets(settings).some(({ connection }) => connection.validation_status === 'failed') || visionFailed
  return <div className="ac-ai-settings" data-layout="v6">
    {settings.migration_warnings?.includes('cover_configuration_invalid') && <p role="alert" className="ac-note">{t('The previous cover configuration is invalid. Select a service again in cover settings. The original configuration file has been preserved.')}</p>}
    {settings.migration_warnings?.includes('purpose_reset_to_recommended') && <p role="alert" className="ac-note">{t('Some purposes could not be migrated as-is. API keys were kept, and those models were reset to the recommended defaults. This notice appears only once.')}</p>}
    {settings.migration_warnings?.includes('preset_catalog_updated') && <p role="alert" className="ac-note">{t('Provider recommendations have been updated. Saved connections stay unchanged; new connections will use the new recommendations.')}</p>}
    {settings.migration_warnings?.some(code => ['settings_configuration_invalid', 'analysis_configuration_invalid', 'vision_configuration_invalid', 'transcription_configuration_invalid'].includes(code)) && <p role="alert" className="ac-note">{t('Some AI settings could not be read. Select the service and enter the key again. The original settings are preserved; damaged files are backed up when you save the corrections.')}</p>}
    <fieldset className="ac-model-fields" disabled={m.saving || m.testing}>
      {customSelected ? <CustomGatewayRepair connection={customSelected} m={m} onBack={closeProvider} />
        : selected ? <ProviderDetail preset={selected} m={m} asrReady={asrReady} onBack={closeProvider} /> : <>
        <header className="ac-settings-ai-head">
          <p className="ac-note">{t('Connect a provider, then pick a default model for each task')}</p>
          <Btn variant="text" size="sm" onClick={() => requestClipboardScan()}>{t('Recognize a key from the clipboard')}</Btn>
        </header>
        <div className="ac-model-section" data-section="default-models">
          <DefaultModels
            settings={settings}
            lists={m.lists}
            onChange={next => m.update(next)}
            transcriptionNote={<>
              {cloudChecking && <p className="ac-note" role="status">{t('Checking available cloud transcription…')}</p>}
              {cloudNote && <p className="ac-note" role="status">{t('Switched to {{provider}} · {{model}} for cloud transcription. Audio is uploaded to the cloud.', cloudNote)}</p>}
            </>}
          />
        </div>
        <ProviderCatalog
          settings={settings}
          query={query}
          filter={filter}
          moreOpen={moreOpen}
          selectedId={selectedId}
          asrReady={asrReady}
          onQuery={setQuery}
          onFilter={setFilter}
          onToggleMore={() => setMoreOpen(open => !open)}
          onOpen={openProvider}
          onAdd={() => setCustomOpen(true)}
        />
        <details className="ac-disclosure ac-model-section"><summary>{t('Advanced')}</summary>
          <Row label={t('Text chunk size')}><input aria-label={t('Text chunk size')} className="ac-input" type="number" min={1000} max={10000} step={500} value={settings.chunk_size} onChange={e => m.update({ chunk_size: Number(e.target.value) })} /></Row>
          <Row label={t('Minimum score')}><input aria-label={t('Minimum score')} className="ac-input" type="number" min={.1} max={1} step={.05} value={settings.min_score_threshold} onChange={e => m.update({ min_score_threshold: Number(e.target.value) })} /></Row>
          <Row label={t('Maximum clips per collection')}><input aria-label={t('Maximum clips per collection')} className="ac-input" type="number" min={1} max={20} value={settings.max_clips_per_collection} onChange={e => m.update({ max_clips_per_collection: Number(e.target.value) })} /></Row>
        </details>
      </>}
    </fieldset>
    {settings.analysis && settings.model_substitutions?.filter(item => item.purpose === 'analysis' && item.saved_model === settings.analysis?.model).map(item => (
      <p className="ac-note" role="status" key={item.replacement}>
        {t('Analysis model {{saved}} is unavailable right now. This run used {{replacement}}.', { saved: item.saved_model, replacement: item.replacement })}
        {' '}
        <Btn variant="text" size="sm" disabled={m.saving} onClick={() => void m.save({ analysis: { ...settings.analysis!, model: item.replacement } })}>{t('Save this model')}</Btn>
      </p>
    ))}
    {m.error && <p className="studio-error" role="alert">{m.error}</p>}
    <div className="ac-savebar">
      <StatusDot tone={failed ? 'error' : m.dirty ? 'muted' : 'ok'} label={failed ? (validationTargets(settings).some(({ connection }) => connection.validation_status === 'failed') ? t('The check failed. Settings are saved, but generation will be blocked until you fix this.') : t(VISION_HINT_KEY)) : m.dirty ? t('Unsaved changes') : settings.saved ? t('Settings saved') : t('First setup; save to apply')} />
      <Btn variant="cta" size="sm" className="ac-btn--pill" disabled={m.testing} loading={m.saving} onClick={() => void save()}>{t('Save settings')}</Btn>
    </div>
    <AddCustomProviderDialog open={customOpen} onClose={() => setCustomOpen(false)}
      onSubmit={draft => { m.addCustomProvider(draft); setCustomOpen(false) }} />
  </div>
}
