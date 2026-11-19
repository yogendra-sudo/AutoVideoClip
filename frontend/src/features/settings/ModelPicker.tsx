import { useState, type ReactNode } from 'react'
import { Select } from 'antd'
import { t } from '../../i18n'
import { Btn } from '../../ui'
import type { Capability, Connection, ModelEntry, ModelList, ModelSettings } from './modelSettingsApi'
import { analysisModels } from './modelDefaults'
import { endpointProviderReady } from './endpointProvider'
import { connectionReady, type Role } from './modelSettingsLogic'
import { isKnownWeakLocalTimelineModel } from './weakLocalTimeline'
import WeakLocalTimelineNote from './WeakLocalTimelineNote'
import LocalRecommendPull from './LocalRecommendPull'
import { belowLocalAnalysisGate, localAnalysisWarnCopy, localModelSizeLabel } from './localModelGate'

export function eligibleModels(role: Role, models: ModelEntry[], mode: ModelSettings['analysis_mode']) {
  if (role === 'cover') return models.filter(m => m.image)
  if (role === 'transcription') return models.filter(m => m.asr)
  return analysisModels(models, role === 'vision' ? 'visual' : mode)
}

/**
 * Searchable model list for one role. Custom IDs are allowed where the service cannot enumerate them.
 * Refresh appears only when the list is not the live account list; a discovery error sits next to the field.
 */
export default function ModelPicker({ role, model, capability, connection, list, busy, listError, mode, actions, invalid, onChange, onCapability, onRefresh }: {
  role: Role
  model: string
  capability?: Capability
  connection?: Connection
  list?: ModelList
  busy: boolean
  listError?: string
  mode: ModelSettings['analysis_mode']
  actions?: ReactNode
  invalid?: boolean
  onChange: (model: string) => void
  onCapability?: (capability: Capability) => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const endpointReady = !connection || endpointProviderReady(connection)
  const models = list && endpointReady ? eligibleModels(role, list.models, mode) : []
  const custom = search.trim()
  const allowCustom = endpointReady && (role !== 'transcription' || connection?.provider === 'compatible')
  const customOption = allowCustom && custom && !models.some(m => m.id === custom) ? [{ value: custom, label: `${t('Use custom model')}：${custom}` }] : []
  const localProvider = connection?.provider === 'ollama' || connection?.provider === 'lmstudio'
  const tag = (m: ModelEntry) => {
    if (role === 'transcription') return m.asr_note ? ` · ${t(m.asr_note)}` : ''
    const bits: string[] = []
    if ((role === 'analysis' || role === 'vision') && m.capability) {
      bits.push(m.capability === 'multimodal' ? t('Multimodal') : t('Text only'))
    }
    if (localProvider && (role === 'analysis' || role === 'vision')) {
      const size = localModelSizeLabel(m, connection?.provider)
      if (size) bits.push(size)
    }
    return bits.length ? ` · ${bits.join(' · ')}` : ''
  }
  const optionLabel = (m: ModelEntry) => {
    const base = `${m.id}${tag(m)}`
    if (role === 'analysis' && localProvider && belowLocalAnalysisGate(m)) {
      return `${base} ⚠`
    }
    return base
  }
  const selectedEntry = model ? models.find(m => m.id === model) || list?.models.find(m => m.id === model) : undefined
  const gateWarn = role === 'analysis' && localProvider && belowLocalAnalysisGate(selectedEntry || (model ? { id: model } : null))
  const unknownCapability = (role === 'analysis' || role === 'vision') && !!model && !!connection && !list?.models.find(m => m.id === model)?.capability
  const weakTimeline = role === 'analysis' && isKnownWeakLocalTimelineModel(connection?.provider, model, connection?.base_url)
  const stale = !!connection && connectionReady(connection) && !busy && (!!listError || !list || list.source !== 'live')
  // The generic preview warning is already covered by the row hint; account-specific warnings stay visible.
  const warning = list?.warning && list.warning !== 'Public catalog preview. Enter an API key to confirm models available to your account.' ? t(list.warning) : ''
  return <div style={{ width: '100%' }}>
    <Select aria-label={t(role === 'cover' ? 'Image model' : role === 'transcription' ? 'Transcription model' : 'Model')} disabled={!connection || !endpointReady} showSearch value={model || undefined} status={invalid ? 'error' : undefined} style={{ width: '100%' }}
      open={open} onDropdownVisibleChange={o => { setOpen(o); if (!o) setSearch('') }} onSearch={setSearch}
      placeholder={busy ? t('Fetching available models…') : t(role === 'transcription' && connection?.provider !== 'compatible' ? 'Select a transcription model' : 'Select or search models, or enter a model ID')}
      loading={busy} optionFilterProp="value"
      notFoundContent={t(role === 'cover' ? 'This service has no availableImage model。' : 'None at presentAvailable models，Please check API Key AfterRefresh。')}
      options={[...customOption, ...models.map(m => ({ value: m.id, label: optionLabel(m), disabled: role === 'transcription' && !m.asr_supported }))]}
      onChange={(value: string) => { onChange(value); setOpen(false) }} />
    {(actions || stale) && <div className="ac-model-control-action">
      {actions}
      {stale && <Btn variant="text" size="sm" onClick={onRefresh}>{t('Refresh')}</Btn>}
    </div>}
    {(listError || warning) && <p className="ac-note ac-note--error">{listError || warning}</p>}
    {unknownCapability && onCapability && <Select aria-label={t('Custom model type')} style={{ width: '100%', marginTop: 8 }} value={capability || 'auto'}
      options={[{ value: 'auto', label: t('Detect automatically') }, { value: 'multimodal', label: t('Multimodal') }, { value: 'text', label: t('Text only') }]} onChange={onCapability} />}
    {gateWarn && (
      <p className="ac-note ac-note--error" role="status" data-testid="local-model-gate-warn" style={{ color: '#b91c1c' }}>
        {t(localAnalysisWarnCopy())}
      </p>
    )}
    {role === 'analysis' && connection?.provider === 'ollama' && (
      <LocalRecommendPull
        provider={connection.provider}
        baseUrl={connection.base_url}
        onPulled={(id) => { onChange(id); onRefresh() }}
      />
    )}
    {weakTimeline && <WeakLocalTimelineNote />}
    {role === 'transcription' && models.length > 0 && !models.some(m => m.asr_supported) && <p className="ac-note">{t('Subtitle timestamps are not integrated for this provider yet. Choose Alibaba Cloud, OpenAI, or local Whisper.')}</p>}
    {role === 'transcription' && (list?.preview || models.some(m => m.asr_preview)) && !model && !(warning || listError) && <small className="ac-note">{t('Preview the model catalog. Actual availability depends on your account permissions and activated services.')}</small>}
  </div>
}
