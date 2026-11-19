import { trackExperience } from '../../analytics/experience'
import { trackSponsorLinkOpened } from '../../analytics/events'
import { telemetryId } from '../../analytics/workflow'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import { t } from '../../i18n'
import { Btn, Dialog, Icon, StatusDot } from '../../ui'
import { openExternalLink } from '../../utils/externalLinks'
import { useQuickConnect } from './useQuickConnect'
import { PROVIDERS } from './providers'
import ProviderFields from './ProviderFields'
import { connectionReady, mainConnection, needsSetup } from './modelSettingsLogic'
import {
  FIRST_RUN_CHOICES,
  FIRST_RUN_DEFAULT,
  firstRunOtherDefault,
  firstRunPrimaryAction,
  firstRunPrimaryLabel,
  firstRunSponsor,
  type FirstRunChoice,
} from './firstRunGuidance'

const DISMISSED_KEY = 'autovideoclip.firstRunSetup.dismissed'

const OPTION_COPY: Record<FirstRunChoice, { title: () => string; detail: (name?: string) => string; badge?: () => string }> = {
  api88: {
    title: () => PROVIDERS.api88.short,
    detail: () => PROVIDERS.api88.sponsor?.description || PROVIDERS.api88.hint,
    badge: () => t('Recommended · starter credit'),
  },
  infistar: {
    title: () => PROVIDERS.infistar.short,
    detail: () => PROVIDERS.infistar.sponsor?.description || PROVIDERS.infistar.hint,
    badge: () => PROVIDERS.infistar.sponsor ? `${t('Sponsor')} · ${PROVIDERS.infistar.sponsor.offer}` : t('Sponsor'),
  },
  other: {
    title: () => t('Other providers'),
    detail: (name?: string) => t('Start by connecting {{name}}', { name: name || '' }),
  },
}

/**
 * First-launch chooser: 88API / Infistar / other providers. "Later" hides it for the session;
 * a blocked import can reopen it. One-click opens the sponsor site; deeplink write is L1.
 */
export default function FirstRunSetup({ onStatus, openRequest = 0 }: { onStatus?: (needed: boolean) => void; openRequest?: number }) {
  const navigate = useNavigate()
  const m = useQuickConnect('home_setup')
  const { settings } = m
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<FirstRunChoice>(FIRST_RUN_DEFAULT)
  const [step, setStep] = useState<'choose' | 'connect'>('choose')
  const initial = useRef<boolean | null>(null)
  if (settings && initial.current === null) initial.current = needsSetup(settings)
  const needed = !!settings && !!initial.current && !settings.saved
  useEffect(() => { if (settings) onStatus?.(needed) }, [settings, needed])
  useEffect(() => {
    if (!needed) { setOpen(false); return }
    let dismissed = false
    try { dismissed = sessionStorage.getItem(DISMISSED_KEY) === '1' } catch { /* restricted storage: just show it */ }
    if (!dismissed) setOpen(true)
  }, [needed])
  useEffect(() => { if (openRequest > 0 && needed) setOpen(true) }, [openRequest])
  const presentation = useRef('')
  const showing = open && needed && !!settings
  useEffect(() => {
    if (!showing) {
      presentation.current = ''
      setStep('choose')
      setChoice(FIRST_RUN_DEFAULT)
      return
    }
    if (!presentation.current) {
      presentation.current = telemetryId()
      trackExperience('setup_presented', { placement: 'home_setup', presentation_id: presentation.current, trigger: openRequest > 0 ? 'import_blocked' : 'initial' })
    }
  }, [showing, openRequest])
  const translation = useTranslation() as { i18n?: { language?: string } } | void
  const language = translation && translation.i18n ? translation.i18n.language : undefined
  const otherDefault = firstRunOtherDefault(language)
  const otherName = PROVIDERS[otherDefault].short
  const action = (value: 'later' | 'open_settings' | 'one_click' | 'connect_recommended', provider?: string) =>
    trackExperience('setup_action', { placement: 'home_setup', presentation_id: presentation.current, action: value, ...(provider ? { provider } : {}) })
  if (!settings || !needed) return null

  // Only the overlay closes. The import zone stays on the setup card until analysis is actually saved.
  const later = () => { action('later'); try { sessionStorage.setItem(DISMISSED_KEY, '1') } catch { /* ignore */ } setOpen(false) }
  const goSettings = () => {
    action('open_settings')
    setOpen(false)
    navigate('/settings?section=ai', { state: { settingsEntry: 'home_setup' } })
  }
  const primary = () => {
    const next = firstRunPrimaryAction(choice)
    if (next === 'open_settings') { goSettings(); return }
    if (next === 'connect_recommended') {
      action('connect_recommended', otherDefault)
      m.chooseProvider('analysis', otherDefault)
      setStep('connect')
      return
    }
    const sponsor = firstRunSponsor(choice)
    if (!sponsor) return
    const preset = PROVIDERS[sponsor]
    action('one_click', sponsor)
    if (preset.sponsor) {
      trackSponsorLinkOpened({ sponsor, target: 'register', placement: 'home_setup' })
      openExternalLink(preset.sponsor.registerUrl)
    }
    m.chooseProvider('analysis', sponsor)
    setStep('connect')
  }
  const main = mainConnection(settings)
  const model = settings.analysis?.model
  const fetching = !!main && !!m.busy[main.id] && !model
  const status = fetching ? t('Fetching available models…')
    : model ? t('Model selected: {{model}}', { model })
    : main && connectionReady(main) ? t('Check the API key, or type a model name')
    : t('Waiting for an API key')
  const label = firstRunPrimaryLabel(choice, choice === 'other' ? otherName : (firstRunSponsor(choice) ? PROVIDERS[firstRunSponsor(choice)!].short : ''))
  const connecting = step === 'connect' && !!main

  return <Dialog open={open} onClose={later} title={t('Choose an AI provider')}
    description={connecting ? (choice === 'other' ? t('Paste the API key below.') : t('After you finish signing up in the browser, paste the API key below.')) : undefined}
    footer={<div className="ac-setup-foot">
      {connecting
        ? <Btn variant="text" size="sm" onClick={() => setStep('choose')}>{t('Back')}</Btn>
        : <Btn variant="text" size="sm" onClick={later}>{t('Set up later')}</Btn>}
      {connecting
        ? <Btn variant="cta" size="sm" loading={m.saving} disabled={fetching} onClick={() => void m.save()}>{t('Connect and save')}</Btn>
        : <Btn variant="cta" size="sm" onClick={primary}>{t(label.key, label.values)}</Btn>}
    </div>}>
    <ConfigProvider theme={{ token: { zIndexPopupBase: 1300 } }}>
      <div className="ac-setup-dialog ac-ai-settings">
        {connecting && main ? <>
          <div className="ac-rows">
            <ProviderFields connection={main} hideProvider placement="home_setup"
              keyHint={m.keyHints[main.id]}
              onChoose={p => m.chooseProvider('analysis', p)} onEdit={patch => m.editConnection(main, patch)} />
          </div>
          {m.error && <p className="studio-error" role="alert">{m.error}</p>}
          <div className="ac-setup-status"><StatusDot tone={fetching ? 'accent' : model ? 'ok' : 'muted'} label={status} /></div>
        </> : <>
          <div className="ac-choice-list" role="radiogroup" aria-label={t('Choose an AI provider')}>
            {FIRST_RUN_CHOICES.map(id => {
              const copy = OPTION_COPY[id]
              return <button key={id} type="button" role="radio" className="ac-choice" aria-checked={choice === id}
                onClick={() => setChoice(id)}>
                <span className="ac-choice-text">
                  <b>{copy.title()}{copy.badge && <span className="ac-badge">{copy.badge()}</span>}</b>
                  <span>{copy.detail(id === 'other' ? otherName : undefined)}</span>
                </span>
                {choice === id && <Icon.Check />}
              </button>
            })}
          </div>
          <p className="ac-note">{t('You can change this later in Settings')}</p>
          {choice === 'other' && <p className="ac-note"><button type="button" className="ac-link-button" onClick={goSettings}>{t('Choose another provider in Settings')}</button></p>}
        </>}
      </div>
    </ConfigProvider>
  </Dialog>
}
