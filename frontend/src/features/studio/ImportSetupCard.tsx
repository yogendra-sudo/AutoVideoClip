import { trackExperience } from '../../analytics/experience'
import { trackSponsorLinkOpened } from '../../analytics/events'
import { telemetryProvider } from '../../analytics/successRateContract'
import { telemetryId } from '../../analytics/workflow'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'
import { Btn, Icon } from '../../ui'
import { openExternalLink } from '../../utils/externalLinks'
import { useQuickConnect } from '../settings/useQuickConnect'
import { PROVIDERS, recommendedSetupProviders, type ProviderKey } from '../settings/providers'

const STEPS = ['provider', 'key', 'connect'] as const
type Step = (typeof STEPS)[number]

const STEP_LABEL: Record<Step, () => string> = {
  provider: () => t('Choose a provider'),
  key: () => t('Enter the API key'),
  connect: () => t('Connect and save'),
}

/**
 * Replaces the import zone until an analysis model is saved.
 * Dismissing the first-run overlay does not unmount this card.
 */
export default function ImportSetupCard({ onExample, exampleBusy = false, keptMaterial = false }: {
  onExample?: () => void
  exampleBusy?: boolean
  keptMaterial?: boolean
}) {
  useTranslation()
  const navigate = useNavigate()
  const connect = useQuickConnect('import_card')
  const providers = recommendedSetupProviders()
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<ProviderKey>(providers[0] || 'api88')
  const [apiKey, setApiKey] = useState('')
  const presentation = useRef('')
  useEffect(() => {
    if (presentation.current) return
    presentation.current = telemetryId()
    trackExperience('setup_presented', {
      placement: 'import_card',
      presentation_id: presentation.current,
      trigger: 'initial',
    })
  }, [])
  const done = (name: Step) => {
    trackExperience('setup_step_done', {
      placement: 'import_card',
      step: name,
      presentation_id: presentation.current,
      provider: telemetryProvider(provider),
    })
  }
  const preset = PROVIDERS[provider]
  const index = STEPS.indexOf(step)
  const next = () => {
    if (step === 'provider') {
      connect.selectProvider(provider)
      done('provider')
      setStep('key')
      return
    }
    if (step === 'key') {
      const key = apiKey.trim()
      if (!key) return
      connect.setKey(key)
      done('key')
      setStep('connect')
    }
  }
  const save = async () => {
    const result = await connect.connect()
    if (result.ok && !result.validationFailed) done('connect')
  }
  const openKey = () => {
    const sponsor = preset.sponsor
    if (!sponsor) return
    trackSponsorLinkOpened({ sponsor: sponsor.id, target: 'register', placement: 'import_card' })
    openExternalLink(sponsor.registerUrl)
  }

  return <div className="ac-import-setup">
    <div>
      <h2>{t('Connect an AI service first')}</h2>
      <p className="studio-muted">{t('Pick a recommended provider, paste a key, and save. You can import a video after that.')}</p>
    </div>
    <ol className="ac-import-steps">
      {STEPS.map((name, at) => <li key={name} data-current={name === step ? 'true' : undefined} data-done={at < index ? 'true' : undefined}>{at + 1} {STEP_LABEL[name]()}</li>)}
    </ol>
    {step === 'provider' && <div className="ac-choice-list" role="radiogroup" aria-label={t('Choose a provider')}>
      {providers.map(id => {
        const row = PROVIDERS[id]
        return <button key={id} type="button" role="radio" className="ac-choice" aria-checked={provider === id} onClick={() => setProvider(id)}>
          <span className="ac-choice-text">
            <b>{row.short}{row.sponsor && <span className="ac-badge">{row.sponsor.offer}</span>}</b>
            <span>{row.sponsor?.description || row.hint}</span>
          </span>
          {provider === id && <Icon.Check />}
        </button>
      })}
    </div>}
    {step === 'key' && <label className="studio-field">
      {t('API key')}
      <input type="password" autoComplete="new-password" aria-label={t('API key')} placeholder={preset.placeholder || 'sk-…'} value={apiKey} onChange={event => setApiKey(event.target.value)} />
      {preset.sponsor && <button type="button" className="studio-link" onClick={openKey}>{t('Get an API key')}</button>}
    </label>}
    {step === 'connect' && <div>
      <p className="studio-muted">{t('This runs a quick connection check, then saves.')}</p>
      <p className="studio-muted">{preset.short}</p>
      {connect.error && <p className="studio-error" role="alert">{connect.error}</p>}
    </div>}
    {keptMaterial && <p className="studio-muted">{t('The link or file you already added stays. You can continue after connecting.')}</p>}
    <div className="ac-import-setup-foot">
      <div className="ac-import-setup-side">
        {index > 0 && <Btn variant="text" size="sm" onClick={() => setStep(STEPS[index - 1])}>{t('Back')}</Btn>}
        <button type="button" className="studio-link" disabled={exampleBusy} onClick={() => onExample?.()}>{t('Try the example video first')}</button>
        {step === 'provider' && <button type="button" className="studio-link" onClick={() => navigate('/settings?section=ai', { state: { settingsEntry: 'home_setup' } })}>{t('Choose another provider in Settings')}</button>}
      </div>
      {step === 'connect'
        ? <Btn variant="cta" size="sm" loading={connect.saving} disabled={!connect.settings} onClick={() => void save()}>{t('Connect and save')}</Btn>
        : <Btn variant="cta" size="sm" disabled={!connect.settings || (step === 'key' && !apiKey.trim())} onClick={next}>{t('Next')}</Btn>}
    </div>
  </div>
}
