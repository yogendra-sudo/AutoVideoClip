import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { Icon } from '../../ui'
import type { ModelList, ModelSettings } from './modelSettingsApi'
import {
  applyCoverOff, applyFixedSelection, applyLocalTranscription, applySmartSelection, applyVisionFollow,
  collectModelGroups, COMING_SOON, hiddenNonVisionCount, isFixedSelected, isSmartSelected,
  preferredOffer, PURPOSE_SLOTS, slotSummary, visionWarning, WHISPER_MODELS,
  type ModelGroup, type ModelOffer, type PurposeId, type SlotLine,
} from './defaultModelSlots'
import { analysisUsesWeakLocalTimelineModel } from './weakLocalTimeline'
import WeakLocalTimelineNote from './WeakLocalTimelineNote'

const SMART_HINT = 'Remembers this model and binds only this provider. To use another provider, pick a fixed option below.'

function lineText(line: SlotLine): string {
  if (line.kind === 'off') return t('Off · use a video frame')
  if (line.kind === 'empty') return t('No connected providers yet. Configure one below first.')
  if (line.kind === 'follow') return t('Same as highlight analysis')
  if (line.kind === 'local') return t('{{model}} · On this device', { model: line.model })
  if (line.kind === 'smart') return t('{{model}} · Smart selection', { model: line.model })
  return line.provider
    ? t('{{model}} · {{provider}}', { model: line.model, provider: line.provider })
    : (line.model || '')
}

function OptionButton({ selected, disabled, label, hint, onClick }: {
  selected: boolean; disabled?: boolean; label: string; hint?: string; onClick: () => void
}) {
  return (
    <button type="button" className="ac-purpose-option" aria-selected={selected} disabled={disabled} onClick={onClick}>
      <span className="ac-purpose-option-label">{label}</span>
      {hint && <span className="ac-purpose-option-hint">{hint}</span>}
      {selected && <Icon.Check size={14} />}
    </button>
  )
}

function ModelGroupBlock({ settings, purpose, group, onChange }: {
  settings: ModelSettings; purpose: PurposeId; group: ModelGroup; onChange: (next: ModelSettings) => void
}) {
  const preferred = preferredOffer(group.offers)
  const many = group.offers.length > 1
  return (
    <div className="ac-purpose-group">
      <div className="ac-purpose-group-head">
        <span className="ac-mono">{group.modelId}</span>
        {many && <span className="ac-purpose-count">{t('Offered by {{count}} providers', { count: group.offers.length })}</span>}
      </div>
      {preferred?.connectionId && (
        <div className="ac-purpose-smart">
          <OptionButton
            selected={isSmartSelected(settings, purpose, group.modelId, preferred)}
            label={t('Smart selection')}
            onClick={() => onChange(applySmartSelection(settings, purpose, group.modelId, preferred.connectionId!))}
          />
          <span className="ac-purpose-help" title={t(SMART_HINT)} aria-label={t('How smart selection works')}><Icon.Help size={14} /></span>
        </div>
      )}
      {group.offers.map(offer => (
        <OfferRow key={`${offer.provider}:${offer.connectionId || ''}`} settings={settings} purpose={purpose} group={group} offer={offer} onChange={onChange} />
      ))}
    </div>
  )
}

function OfferRow({ settings, purpose, group, offer, onChange }: {
  settings: ModelSettings; purpose: PurposeId; group: ModelGroup; offer: ModelOffer; onChange: (next: ModelSettings) => void
}) {
  const disabled = !offer.connected || !offer.connectionId
  return (
    <OptionButton
      selected={!disabled && isFixedSelected(settings, purpose, group.modelId, offer)}
      disabled={disabled}
      label={offer.displayName}
      hint={offer.connected ? t('Connected') : t('Not connected')}
      onClick={() => offer.connectionId && onChange(applyFixedSelection(settings, purpose, group.modelId, offer.connectionId))}
    />
  )
}

function PurposePanel({ settings, lists, purpose, onChange }: {
  settings: ModelSettings; lists: Record<string, ModelList>; purpose: PurposeId; onChange: (next: ModelSettings) => void
}) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const all = collectModelGroups(settings, lists, purpose)
    const needle = query.trim().toLowerCase()
    return needle ? all.filter(group => group.modelId.toLowerCase().includes(needle)) : all
  }, [settings, lists, purpose, query])
  const hidden = purpose === 'vision' ? hiddenNonVisionCount(lists) : 0
  const warning = purpose === 'vision' ? visionWarning(settings, lists) : null
  return (
    <div className="ac-purpose-panel" role="region" aria-label={t('Search models')}>
      {purpose === 'vision' && (
        <OptionButton selected={!settings.vision} label={t('Same as highlight analysis')} onClick={() => onChange(applyVisionFollow(settings))} />
      )}
      {purpose === 'cover' && (
        <OptionButton selected={!settings.cover_enabled} label={t('Off · use a video frame')} onClick={() => onChange(applyCoverOff(settings))} />
      )}
      {purpose === 'transcription' && (
        <>
          {WHISPER_MODELS.map(model => (
            <OptionButton
              key={model}
              selected={settings.transcription?.provider === 'whisper_local' && settings.transcription.model === model}
              label={`${t('Whisper on this device')} · ${model}`}
              onClick={() => onChange(applyLocalTranscription(settings, 'whisper_local', model))}
            />
          ))}
          <OptionButton
            selected={settings.transcription?.provider === 'sensevoice_local'}
            label={t('SenseVoice on this device')}
            onClick={() => onChange(applyLocalTranscription(settings, 'sensevoice_local', 'SenseVoiceSmall'))}
          />
        </>
      )}
      {groups.length > 0 && (
        <input className="ac-input ac-purpose-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search models')} aria-label={t('Search models')} />
      )}
      {groups.map(group => (
        <ModelGroupBlock key={group.modelId} settings={settings} purpose={purpose} group={group} onChange={onChange} />
      ))}
      {purpose !== 'transcription' && !groups.length && (
        <p className="ac-note">{t('No connected providers yet. Configure one below first.')}</p>
      )}
      {purpose === 'vision' && hidden > 0 && (
        <p className="ac-note">{t('{{count}} models without vision are hidden', { count: hidden })}</p>
      )}
      {warning && (
        <p className="ac-note ac-note--error" role="alert">
          {warning === 'follow'
            ? t('The followed model has no vision. You can save; generation will be blocked until this is fixed.')
            : t('The selected model has no vision. You can save; generation will be blocked until this is fixed.')}
        </p>
      )}
    </div>
  )
}

export default function DefaultModels({ settings, lists, onChange, transcriptionNote = null }: {
  settings: ModelSettings
  lists: Record<string, ModelList>
  onChange: (next: ModelSettings) => void
  transcriptionNote?: ReactNode
}) {
  useTranslation()
  const [open, setOpen] = useState<PurposeId | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(null)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  return (
    <div id="ai-defaults" className="ac-default-models" ref={root}>
      <h3 className="ac-model-section-title">{t('Default models')}</h3>
      <div className="ac-purpose-grid">
        {PURPOSE_SLOTS.map(slot => {
          const line = slotSummary(settings, lists, slot.id)
          const warning = slot.id === 'vision' ? visionWarning(settings, lists) : null
          return (
            <div key={slot.id} id={`ai-defaults-${slot.id}`} className="ac-purpose-slot">
              <button
                type="button"
                className="ac-purpose-card"
                aria-expanded={open === slot.id}
                aria-controls={`ai-defaults-panel-${slot.id}`}
                onClick={() => setOpen(current => current === slot.id ? null : slot.id)}
              >
                <span className="ac-purpose-title">{t(slot.titleKey)}</span>
                <span className="ac-purpose-kind">{t(slot.kindKey)}</span>
                <span className="ac-purpose-line ac-mono">{lineText(line)}</span>
              </button>
              {slot.id === 'transcription' && transcriptionNote}
              {warning && open !== slot.id && (
                <p className="ac-note ac-note--error" role="alert">
                  {warning === 'follow'
                    ? t('The followed model has no vision. You can save; generation will be blocked until this is fixed.')
                    : t('The selected model has no vision. You can save; generation will be blocked until this is fixed.')}
                </p>
              )}
              {slot.id === 'analysis' && analysisUsesWeakLocalTimelineModel(settings) && <WeakLocalTimelineNote />}
              {open === slot.id && (
                <div id={`ai-defaults-panel-${slot.id}`}>
                  <PurposePanel settings={settings} lists={lists} purpose={slot.id} onChange={next => { onChange(next) }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="ac-purpose-soon">
        <span>{t('Coming soon')}</span>
        {COMING_SOON.map(label => <span key={label}>{t(label)}</span>)}
      </p>
    </div>
  )
}
