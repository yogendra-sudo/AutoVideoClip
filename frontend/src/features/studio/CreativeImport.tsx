import { trackExperience } from '../../analytics/experience'
import { useTranslation } from 'react-i18next'
import { getLocale, t } from '../../i18n'
import { useEffect, useRef, useState, type DragEvent, type Ref } from 'react'
import { Select } from 'antd'
import { useNavigate } from 'react-router-dom'
import { Btn, Segmented, Dialog, StatusDot } from '../../ui'
import PlatformPicker from './PlatformPicker'
import { studioApi, errorText, errorCode } from './api'
import { trackAsrReadiness, trackAutoChoiceOverridden, trackImportPreviewShown, trackOneClickStarted, trackOneClickUndone, trackQuickOutputPlatforms } from '../../analytics/studio'
import { telemetryId } from '../../analytics/workflow'
import { featureSnapshot, flagAssigned, flagEnabled, flagValue, useFlag } from '../../analytics/flags'
import TemplatePicker, { templateImportFields, type HtmlTemplateChoice } from './TemplatePicker'
import { OutputCaptionsSwitch } from '../settings/OutputCaptionsSetting'
import StyleProbeLine from './StyleProbeLine'
import { readStyle } from './editingStyleSession'
import { defaultImportOptions, FIRST_WINDOW_END_SEC, ImportOptions } from './types'
import ImportPreferences from './ImportPreferences'
import { speechApi } from '../../services/api'
import { analysisNeedsSetup, asrReadinessProperties, durationBucket, probeReadiness, repairDestination, submissionBlock, transcriptionRoute, visibleIssues, type ImportReadiness, type PreviewRouteKind, type ReadinessIssue, type ReadinessLineItem } from './importReadiness'
import ReadinessLine from './ReadinessLine'
import ImportSetupCard from './ImportSetupCard'
import { platformLabel } from './platformLabel'
import { hasSuccessHistory, readRememberedPlatforms, resolvePlatforms, samePlatforms, takeReuseImport, writeRememberedPlatforms, type PlatformSource } from './platformMemory'
import { claimBackgroundWhisperInstall, importUrlKind, isVideoFile, shouldArmAutostart, shouldAutoStart, shouldBackgroundInstallWhisper, UNDO_MS } from './pasteStart'
import { readImportPreferences } from './importPreferencesStore'
import TranscriptionGatePrompt from './TranscriptionGatePrompt'
import { isRecoveryCode, probeConfig, type RecoveryController } from './transcriptionRecovery'
import { browserCookieRecovery, cookieAssistFromLocation, stageBrowserCookieRecovery, stagedRecoveryUrl } from './browserCookieRecovery'
import { SETTINGS_SAVED_EVENT } from './settingsReturn'
import { useTranscriptionRecovery } from './useTranscriptionRecovery'
import UrlPreview, { shouldSuggestFirstWindow, type UrlInspectPreview } from './UrlPreview'
import './studio.css'
import './quick-output.css'

function issueCopy(item: ReadinessIssue) {
  if (item.key === 'analysis' && item.code === 'validation_failed') return t('The model connection failed the check. Update the key or endpoint in Settings → Providers and models, then generate.')
  if (item.key === 'analysis') return t('The analysis model is not ready. Connect an AI service before generating.')
  if (item.code === 'whisper_installing') return t('Installing local transcription…')
  if (item.code === 'whisper_not_installed') return t('Local transcription is not installed. You can continue if you already have subtitles.')
  if (item.code === 'whisper_model_missing') return t('The transcription model is not downloaded yet. You can continue if you already have subtitles.')
  if (item.code === 'whisper_model_downloading') return t('Downloading the transcription model…')
  if (item.code === 'whisper_model_failed') return t('The transcription model failed to download. Please try again. You can continue if you already have subtitles.')
  if (item.code === 'sensevoice_not_ready') return t('SenseVoice is not ready. You can continue if you already have subtitles.')
  if (item.code === 'cloud_not_configured') return t('Cloud transcription is not configured. You can continue if you already have subtitles.')
  if (item.key === 'visual' && item.code === 'vision_unsupported') return t('The model used for visual understanding cannot see images. In Settings → Providers and models, switch to a vision-capable model, then generate.')
  if (item.key === 'visual') return t('Visual analysis needs a vision model.')
  if (item.key === 'ffmpeg') return t('FFmpeg was not found, so video cannot be processed yet.')
  return t('Import requirements are not ready yet.')
}

function repairLabel(item: ReadinessIssue) {
  if (item.repair === 'settings_ai') return item.code === 'validation_failed' ? t('Fix in settings') : t('Connect AI service')
  if (item.repair === 'install_whisper') return item.model ? t('Download transcription model') : t('Install Whisper')
  if (item.repair === 'settings_transcription') return t('Transcription')
  if (item.repair === 'settings_vision') return t('Vision settings')
  return ''
}


function BrowserCookieControl({ browser, busy, onChange, assist, selectRef }: {
  browser: string
  busy: boolean
  onChange: (value: string) => void
  assist: boolean
  selectRef?: Ref<HTMLSelectElement>
}) {
  return <>
    <label className="studio-field" htmlFor={assist ? 'studio-browser-cookie' : undefined}>{t("Use browser sign-in")}
      <select id={assist ? 'studio-browser-cookie' : undefined} ref={selectRef} value={browser} onChange={event => onChange(event.target.value)} disabled={busy}>
        <option value="">{t("Do not use")}</option>
        {['chrome', 'edge', 'safari', 'firefox'].map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    <p className="studio-muted">{assist ? t("No browser is selected yet. Choose a signed-in browser, then generate again. If that browser is open, quit it completely or try a different browser.") : t("Select only if downloading requires sign-in. Browser cookies are not read automatically.")}</p>
  </>
}

function uiLocale() {
  try { return getLocale() } catch { return 'en' }
}

const YOUTUBE_LONG_MIN_SEC = 180

function longFormNotice(durationSec: number | null, platforms: string[]) {
  const others = platforms.some(platform => platform !== 'youtube_long')
  if (durationSec != null && durationSec < YOUTUBE_LONG_MIN_SEC) {
    return others
      ? `${t('This source is too short for YouTube landscape.')} ${t('YouTube landscape will be skipped. The other platforms still generate.')}`
      : t('This source is too short for YouTube landscape.')
  }
  return others
    ? t("YouTube landscape needs at least one clip of 3 minutes or more. If the source can't yield one, that version will be skipped. Other platforms still generate.")
    : t("YouTube landscape needs at least one clip of 3 minutes or more. If the source can't yield one, that version will be skipped.")
}

function blockMessage(reason: string, readiness?: ImportReadiness | null) {
  if (reason === 'pending') return t('Checking import requirements…')
  if (reason === 'analysis') return readiness?.checks?.analysis?.code === 'validation_failed'
    ? t('The model connection failed the check. Update the key or endpoint in Settings → Providers and models, then generate.')
    : t('Connect an AI service before importing a video.')
  if (reason === 'transcription') return t('Transcription is not ready. Attach an SRT file, or set up transcription first.')
  if (reason === 'visual') return readiness?.checks?.visual?.code === 'vision_unsupported'
    ? t('The model used for visual understanding cannot see images. In Settings → Providers and models, switch to a vision-capable model, then generate.')
    : t('Set up a vision model before generating.')
  if (reason === 'ffmpeg') return t('FFmpeg was not found, so a video cannot be generated.')
  return ''
}

export default function CreativeImport({ onImported, blocked = false, onBlocked, onExample, exampleBusy = false }: {
  onImported: () => Promise<void>
  blocked?: boolean
  onBlocked?: () => void
  onExample?: () => void
  exampleBusy?: boolean
}) {
  useTranslation()
  const navigate = useNavigate()
  const remembered = flagEnabled('remember_platforms')
  const reuse = useRef(takeReuseImport())
  const initialPlatforms = useRef(
    reuse.current?.platforms?.length
      ? { platforms: reuse.current.platforms, source: 'user' as PlatformSource }
      : resolvePlatforms(remembered, uiLocale(), readRememberedPlatforms()),
  )
  const [source, setSource] = useState<'link' | 'file'>('link')
  const [url, setUrl] = useState(() => {
    const incoming = reuse.current?.sourceUrl || reuse.current?.sourceMeta?.source_url
    return typeof incoming === 'string' ? incoming : ''
  })
  const [file, setFile] = useState<File | null>(null)
  const [subtitle, setSubtitle] = useState<File | null>(null)
  const [options, setOptions] = useState<ImportOptions>({...defaultImportOptions})
  const templatesOn = useFlag('pkg_templates_v1') === true
  const visualOn = useFlag('pkg_template_picker_visual') === true
  const [browser, setBrowser] = useState('')
  const [cookieAssistLocal, setCookieAssistLocal] = useState(false)
  const assist = cookieAssistLocal || cookieAssistFromLocation(typeof window === 'undefined' ? '' : (window.location?.search || ''))
  const browserRef = useRef<HTMLSelectElement | null>(null)
  useEffect(() => {
    if (!assist) return
    setSource('link')
    const incoming = stagedRecoveryUrl()
    if (incoming) { setUrl(incoming); setFile(null) }
    const node = browserRef.current
    if (!node) return
    try { node.focus() } catch { /* focus is optional */ }
    try { node.scrollIntoView({ block: 'center' }) } catch { /* not a browser */ }
  }, [assist])
  const [platforms, setPlatforms] = useState<string[]>(initialPlatforms.current.platforms)
  const [preferences, setPreferences] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readiness, setReadiness] = useState<ImportReadiness | null>(null)
  const currentReadiness = readiness
  const [settled, setSettled] = useState(false)
  const [platformOpen, setPlatformOpen] = useState(!!reuse.current?.platforms?.length)
  const [pending, setPending] = useState<{ trigger: 'paste' | 'drop' } | null>(null)
  const [urlPreview, setUrlPreview] = useState<UrlInspectPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewTicket = useRef(0)
  const previewUrlRef = useRef('')

  const [dragging, setDragging] = useState(false)
  const [longGate, setLongGate] = useState<{ open: boolean; durationSec: number | null; trigger: 'paste' | 'drop' | 'button' }>({ open: false, durationSec: null, trigger: 'button' })
  const [firstWindowGate, setFirstWindowGate] = useState<{ open: boolean; trigger: 'paste' | 'drop' | 'button' }>({ open: false, trigger: 'button' })
  const firstWindowDecided = useRef(false)
  /** Synchronous override so FormData sees the choice before setState flushes (T2). */
  const sourceWindowOverride = useRef<ImportOptions['source_window'] | undefined>(undefined)
  useEffect(() => {
    if (source !== 'file' || !file) {
      setLongGate(prev => prev.durationSec == null ? prev : { ...prev, durationSec: null })
      return
    }
    let cancel = false
    let objectUrl = ''
    try { objectUrl = URL.createObjectURL(file) } catch { return }
    const video = document.createElement('video')
    video.preload = 'metadata'
    const finish = (durationSec: number | null) => {
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = '' }
      if (!cancel) setLongGate(prev => ({ ...prev, durationSec }))
    }
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => finish(null)
    video.src = objectUrl
    return () => { cancel = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [file, source])
  const platformSource = useRef<PlatformSource>(initialPlatforms.current.source)
  const overridden = useRef(false)
  const starting = useRef(false)
  const recoverRef = useRef<RecoveryController>(null as unknown as RecoveryController)
  const submitRef = useRef<(trigger: 'paste' | 'drop' | 'button', fresh?: ImportReadiness | null, confirmed?: boolean) => Promise<void>>(async () => {})
  const allowLink = flagEnabled('link_import_without_whisper')
  const dropZone = flagEnabled('import_drop_zone')
  const hidePreferences = flagEnabled('hide_legacy_entrypoints')
  const pasteFlag = String(flagValue('one_click_paste_start'))
  const blockOptions = { source, allowLinkWithoutWhisper: allowLink }
  useEffect(() => {
    // The first-run dialog and the settings page save through the same notification.
    // This page stays mounted across that save, so the mount probe would stay stale until reload.
    let ticket = 0
    const load = () => {
      const current = ++ticket
      studioApi.readiness()
        .then(value => {
          if (current !== ticket) return
          setReadiness(value)
          trackAsrReadiness(asrReadinessProperties(value, false))
        })
        .catch(() => { if (current === ticket) setReadiness(null) })
        .finally(() => { if (current === ticket) setSettled(true) })
    }
    load()
    window.addEventListener(SETTINGS_SAVED_EVENT, load)
    return () => { ticket += 1; window.removeEventListener(SETTINGS_SAVED_EVENT, load) }
  }, [])
  useEffect(() => {
    if (!hidePreferences) return
    const stored = readImportPreferences()
    if (stored) setOptions(current => ({ ...stored, instruction: current.instruction }))
  }, [hidePreferences])
  useEffect(() => {
    if (!shouldBackgroundInstallWhisper(allowLink, readiness?.checks?.transcription?.code)) return
    if (recoverRef.current.state.phase !== 'idle') return
    if (!claimBackgroundWhisperInstall()) return
    // #371: the background install is the controller's install too, so its polls refresh readiness and the page
    // never stays on PositiveGet it from theInstallLocalTranscription; the dialog stays closed unless a submit is blocked on it.
    void recoverRef.current.install({ background: true })
  }, [allowLink, readiness?.checks?.transcription?.code])
  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(() => {
      const trigger = pending.trigger
      setPending(null)
      void submitRef.current(trigger)
    }, UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [pending])
  const analysisBlocked = analysisNeedsSetup(readiness)
  useEffect(() => {
    if (pasteFlag !== 'autostart' && !dropZone) return
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.ac-import-setup')) return
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]') && !target.closest('.ac-creative-import')) return
      const text = event.clipboardData?.getData('text') || ''
      if (!importUrlKind(text) || !shouldAutoStart(pasteFlag, 'paste')) return
      event.preventDefault()
      arm('paste', { url: text.trim() })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [pasteFlag, dropZone, busy, settled, allowLink, source, analysisBlocked])
  const issues = visibleIssues(readiness, !!subtitle, blockOptions)
  const repair = async (item: ReadinessIssue | ReadinessLineItem) => {
    // #353: the readiness list's install button goes through the one recovery controller (no second install flow).
    const code = 'code' in item ? item.code : undefined
    const model = 'model' in item ? item.model : undefined
    if (item.repair === 'install_whisper') {
      resumeSubmit.current = false
      setError('')
      recover.open(code || readiness?.checks?.transcription?.code || 'whisper_not_installed', model || readiness?.checks?.transcription?.model)
      await recover.install()
      return
    }
    if (item.repair === 'settings_ai' && blocked) { onBlocked?.(); return }
    const destination = repairDestination(item.repair)
    if (destination) navigate(destination)
  }
  // #418 rewrite: the one install-recovery controller (shared with the confirm page): install -> download ->
  // ready (continues by itself) / failed / timeout (retry or transcription settings).
  // Done waiting -> the same import continues by itself (#232); the Continue import button is the manual exit.
  // #349: continue with the report the controller just read, never the page's cached readiness.
  // #370: only a submit that was blocked on the install continues by itself; a download started from the list
  // (or in the background) just refreshes readiness when it finishes.
  const resumeSubmit = useRef(false)
  const recoveryDone = (report: ImportReadiness | null) => {
    if (resumeSubmit.current) { continueAfterRecovery(report); return }
    recover.close(); if (report) setReadiness(report)
  }
  const continueAfterRecovery = (report: ImportReadiness | null) => { resumeSubmit.current = false; recover.close(); setError(''); if (report) setReadiness(report); void submitRef.current?.('button', report) }
  const [recovery, recover] = useTranscriptionRecovery({ readiness: signal => studioApi.readinessProbe(signal), getRuntimeStatus: signal => speechApi.getRuntimeStatus(probeConfig(signal)), getModels: signal => speechApi.getModels(probeConfig(signal)), installRuntime: signal => speechApi.installRuntime({ signal }), downloadModel: (model, signal) => speechApi.downloadModel(model, { signal }) }, { onReady: report => recoveryDone(report), onReport: report => setReadiness(report) })
  recoverRef.current = recover
  const repairing = recovery.phase === 'installing' || recovery.phase === 'downloading'
  const changePlatforms = (next: string[]) => {
    setPlatforms(next)
    if (!next.includes('youtube_long')) setLongGate(prev => prev.open ? { ...prev, open: false } : prev)
    if (remembered) writeRememberedPlatforms(next)
    else platformSource.current = 'user'
    if (samePlatforms(next, initialPlatforms.current.platforms)) return
    platformSource.current = 'user'
    if (overridden.current) return
    // One event if either flag is assigned, so remembering and override tracking do not double count.
    if (!(flagAssigned('remember_platforms') || flagAssigned('track_overrides'))) return
    overridden.current = true
    trackAutoChoiceOverridden({ field: 'platform', stage: 'pre_import' }, true)
  }
  const readyToStart = (trigger: 'paste' | 'drop' | 'button', next?: { url?: string; file?: File | null }, readiness: ImportReadiness | null = currentReadiness) => {
    if (blocked) { trackExperience('import_blocked', { reason: 'setup_required', placement: 'home_setup' }); setError(t("Connect an AI service before importing a video.")); onBlocked?.(); return false }
    const nextFile = next && 'file' in next ? next.file : file
    const nextUrl = next?.url ?? url
    const nextSource = next?.file ? 'file' : next?.url ? 'link' : source
    if (nextSource === 'file' ? !nextFile : !nextUrl.trim()) { setError(t("Add a video file or link first")); return false }
    const reason = submissionBlock(readiness, !!subtitle, settled, { source: nextSource, allowLinkWithoutWhisper: allowLink })
    if (reason === 'pending') { setError(blockMessage(reason, readiness)); return false }
    trackAsrReadiness(asrReadinessProperties(readiness, !!subtitle))
    const check = readiness?.checks?.transcription
    if (reason === 'transcription' && nextSource === 'file' && !subtitle && !check?.skippable && isRecoveryCode(check?.code)) {
      setError(''); resumeSubmit.current = true; recover.open(check!.code, check!.model); return false
    }
    if (reason) { setError(blockMessage(reason, readiness)); return false }
    if (trigger !== 'button') setError('')
    return true
  }
  const clearPreview = () => {
    previewTicket.current += 1
    previewUrlRef.current = ''
    setUrlPreview(null)
    setPreviewLoading(false)
  }
  const runInspect = async (nextUrl: string, _trigger: 'paste' | 'drop' | 'blur' = 'paste') => {
    const trimmed = nextUrl.trim()
    if (!importUrlKind(trimmed)) { clearPreview(); return null }
    if (previewUrlRef.current === trimmed && urlPreview) return urlPreview
    const ticket = ++previewTicket.current
    previewUrlRef.current = trimmed
    setPreviewLoading(true)
    setPending(null)
    try {
      const result = await studioApi.inspectUrl({
        url: trimmed,
        ...(browser ? { browser } : {}),
      })
      if (ticket !== previewTicket.current) return null
      const preview = result as UrlInspectPreview
      setUrlPreview(preview)
      setLongGate(prev => ({ ...prev, durationSec: typeof preview.duration === 'number' ? preview.duration : null }))
      trackImportPreviewShown({
        route: preview.preview_route,
        duration_bucket: durationBucket(preview.duration),
        has_platform_subtitle: !!preview.has_manual_subtitle,
      })
      return preview
    } catch (e) {
      if (ticket !== previewTicket.current) return null
      setUrlPreview(null)
      const code = errorCode(e)
      const message = t(errorText(e))
      if (browserCookieRecovery(code, errorText(e))) {
        stageBrowserCookieRecovery(trimmed)
        setCookieAssistLocal(true)
      }
      setError(message)
      return null
    } finally {
      if (ticket === previewTicket.current) setPreviewLoading(false)
    }
  }
  const needsPreviewTranscriptionInstall = !!(
    urlPreview?.preview_route === 'local_transcription'
    && readiness?.checks?.transcription?.ok === false
    && !subtitle
    && !readiness?.checks?.transcription?.skippable
    && isRecoveryCode(readiness?.checks?.transcription?.code)
  )
  const arm = (trigger: 'paste' | 'drop', next: { url?: string; file?: File }) => {
    // drop, global paste and the file picker all come through here; while a submit is running
    // (including its readiness re-check) the source is locked, so what is shown is what gets uploaded.
    if (starting.current) return
    if (next.file) {
      setFile(next.file); setUrl(''); setSource('file'); clearPreview()
      if (analysisBlocked) return
      if (!shouldAutoStart(pasteFlag, trigger)) return
      if (!readyToStart(trigger, next)) return
      setPending({ trigger })
      return
    }
    if (next.url) { setUrl(next.url); setFile(null); setSource('link') }
    // The setup card owns the zone. Keep the material, but do not start or reopen the overlay.
    if (analysisBlocked) return
    // F4: inspect first; autostart countdown begins only after the preview card is ready.
    void (async () => {
      const preview = await runInspect(next.url || '', trigger)
      if (!preview) return
      if (!shouldArmAutostart(pasteFlag, trigger, true)) return
      const needsInstall = preview.preview_route === 'local_transcription'
        && readiness?.checks?.transcription?.ok === false
        && !subtitle
        && !readiness?.checks?.transcription?.skippable
        && isRecoveryCode(readiness?.checks?.transcription?.code)
      if (needsInstall) return
      if (!readyToStart(trigger, next)) return
      setPending({ trigger })
    })()
  }
  const undo = () => {
    const trigger = pending?.trigger
    setPending(null)
    if (trigger) trackOneClickUndone({ trigger }, flagAssigned('one_click_paste_start'))
  }
  const submit = async (trigger: 'paste' | 'drop' | 'button' = 'button', fresh?: ImportReadiness | null, confirmed = false) => {
    if (starting.current) return
    if (trigger === 'button') setPending(null)
    if (source === 'link' && url.trim() && !urlPreview && !previewLoading) {
      const preview = await runInspect(url.trim(), 'blur')
      if (!preview) return
      if (preview.preview_route === 'local_transcription'
        && readiness?.checks?.transcription?.ok === false
        && !subtitle
        && !readiness?.checks?.transcription?.skippable
        && isRecoveryCode(readiness?.checks?.transcription?.code)) {
        const check = readiness?.checks?.transcription
        resumeSubmit.current = true
        recover.open(check!.code, check!.model)
        return
      }
    }
    if (platforms.includes('youtube_long') && !confirmed) {
      if (!readyToStart(trigger, undefined, fresh ?? readiness)) return
      setLongGate(prev => ({ ...prev, open: true, trigger }))
      return
    }
    // T2: file import (or link without UrlPreview dual buttons) — ask before spending ASR on a long first source.
    const durationForWindow = source === 'link'
      ? (typeof urlPreview?.duration === 'number' ? urlPreview.duration : null)
      : longGate.durationSec
    if (
      !confirmed
      && !firstWindowDecided.current
      && shouldSuggestFirstWindow(hasSuccessHistory(), durationForWindow)
    ) {
      if (!readyToStart(trigger, undefined, fresh ?? readiness)) return
      setFirstWindowGate({ open: true, trigger })
      return
    }
    // one busy state from the click on. The re-probe below can wait, and the inputs stay locked
    // (busy disables them) so the request carries exactly what the user saw when they clicked.
    starting.current = true
    setBusy(true)
    try {
      let report = fresh ?? readiness
      if (settled && !report) {
        // (PM): re-check up to 3 times; still unknown -> send the import and let the backend gate answer (422).
        report = await probeReadiness(() => studioApi.readiness())
        if (report) setReadiness(report)
      }
      if (!readyToStart(trigger, undefined, report)) return
      setError('')
      const flowId = telemetryId()
      const body = new FormData()
      body.append('goal', options.goal); body.append('language', options.language); body.append('instruction', options.instruction)
      platforms.forEach(platform => body.append('platforms', platform))
      body.append('auto_start', 'true')
      body.append('portrait_style', options.portrait_style || 'auto')
      const portraitChosen = platforms.some(platform => !['bilibili', 'youtube_long', 'original'].includes(platform))
      const styleKey = templatesOn && visualOn && portraitChosen ? (source === 'file' ? (file ? `file:${file.name}:${file.size}:${file.lastModified}` : null) : (url.trim() ? `url:${url.trim()}` : null)) : null
      const recommendation = visualOn && styleKey && readStyle().key === styleKey ? readStyle().result?.template : undefined
      const templateFields = templateImportFields(templatesOn, options.html_template, recommendation)
      if (templateFields.html_template) body.append('html_template', templateFields.html_template)
      if (templateFields.recommended_template) body.append('recommended_template', templateFields.recommended_template)
      body.append('features', JSON.stringify(featureSnapshot()))
      if (options.aspect) body.append('aspect', options.aspect)
      if (options.duration) body.append('duration', String(options.duration))
      const windowChoice = sourceWindowOverride.current !== undefined ? sourceWindowOverride.current : options.source_window
      if (windowChoice && typeof windowChoice.end === 'number') {
        body.append('source_window_start', String(windowChoice.start ?? 0))
        body.append('source_window_end', String(windowChoice.end))
      }
      if (subtitle) body.append('subtitle', subtitle)
      body.append('name', file && source === 'file' ? file.name.replace(/\.[^.]+$/, '') : t("Smart editing"))
      if (source === 'file' && file) body.append('video', file)
      else { body.append('url', url.trim()); if (browser) body.append('browser', browser) }
      body.append('features', JSON.stringify(featureSnapshot()))
      body.append('flow_id', flowId)
      const skippedWhisper = allowLink && source !== 'file' && !!readiness && !readiness?.checks?.transcription?.ok && !subtitle
      const result = await studioApi.import(body)
      trackOneClickStarted({
        trigger, flow_id: flowId, platform_count: platforms.length, platform_source: platformSource.current,
        has_subtitle: !!subtitle, transcription_route: transcriptionRoute({
          hasSubtitle: !!subtitle,
          code: readiness?.checks?.transcription?.code,
          skippedWhisper,
          previewRoute: source === 'link' ? (urlPreview?.preview_route as PreviewRouteKind | undefined) : undefined,
        }),
      }, flagAssigned('one_click_paste_start') || flagAssigned('remember_platforms') || flagAssigned('link_import_without_whisper') || flagAssigned('import_drop_zone'))
      trackQuickOutputPlatforms({ platform_count: platforms.length, portrait_style: options.portrait_style || 'auto' })
      if (remembered) writeRememberedPlatforms(platforms)
      // Project refresh should never make a successful import look like an upload failure.
      void onImported().catch(() => undefined)
      navigate(`/project/${result.project_id}`)
    } catch (e) {
      // the backend gate sends a stable code; the prompt is chosen from it, never from the text.
      const code = errorCode(e)
      if (isRecoveryCode(code)) { setError(''); resumeSubmit.current = true; recover.open(code as string, readiness?.checks?.transcription?.model) }
      else setError(t(errorText(e)))  // includes coded source refusals (source_unreadable ...): shown at once
    } finally { starting.current = false; setBusy(false) }
  }
  submitRef.current = submit
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const dropped = [...event.dataTransfer.files].find(item => isVideoFile(item))
    if (dropped) { arm('drop', { file: dropped }); return }
    const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
    if (importUrlKind(text)) arm('paste', { url: text.trim() })
  }
  const names = platforms.map(platformLabel).join(uiLocale().toLowerCase().startsWith('zh') ? '、' : ', ')
  const youtubeLongOnlyTooShort = longGate.durationSec != null && longGate.durationSec < YOUTUBE_LONG_MIN_SEC && platforms.length > 0 && platforms.every(platform => platform === 'youtube_long')
  if (analysisBlocked) {
    return <section className="ac-creative-import">
      <div className="studio-import-box">
        <ImportSetupCard onExample={onExample} exampleBusy={exampleBusy} keptMaterial={Boolean(url.trim() || file)} />
      </div>
    </section>
  }
  return <section className="ac-creative-import">
    <h1 className="ac-title">{t("Drop in a video and get ready-to-publish cuts.")}</h1>
    <p className="studio-muted">{t("Pick where you will post. AI selects the moments, edits and renders them. Download right away or keep editing.")}</p>
    <div className="studio-import-box">
      {dropZone ? <div className={`ac-dropzone${dragging ? ' is-hot' : ''}`} onDragEnter={event => { event.preventDefault(); setDragging(true) }} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <p className="ac-dropzone-title">{t('Drop a link or a video here')}</p>
        <p className="ac-dropzone-hint">{t('Paste a link, or drop a video file.')}</p>
        <label className="studio-field ac-dropzone-field"><span className="studio-sr">{t("Video link")}</span><textarea placeholder={t("Paste a Bilibili or YouTube video link")} value={url} onChange={event => { setPending(null); clearPreview(); setUrl(event.target.value); if (event.target.value) { setFile(null); setSource('link') } }} onBlur={event => { const value = event.target.value.trim(); if (importUrlKind(value)) void runInspect(value, 'blur') }} disabled={busy}/></label>
        {file && <p className="ac-dropzone-file"><span>{file.name}</span><button type="button" className="studio-link" disabled={busy} onClick={() => setFile(null)}>{t('Remove')}</button></p>}
        <label className="studio-link ac-dropzone-file-label">{t('Choose a video file')}<input type="file" aria-label={t("Video file")} accept="video/mp4,video/webm,video/quicktime,.mkv,.avi" disabled={busy} onChange={event => { const picked = event.target.files?.[0] || null; if (picked) arm('drop', { file: picked }) }}/></label>
      </div> : <>
        <div className="studio-row"><Segmented ariaLabel={t("Import source")} value={source} onChange={v=>!busy&&setSource(v)} options={[{value:'link',label:t("Import link")},{value:'file',label:t("Import file")}]}/></div>
        {source==='link'?<label className="studio-field"><span className="studio-sr">{t("Video link")}</span><textarea placeholder={t("Paste a Bilibili or YouTube video link")} value={url} onChange={e=>{ setPending(null); clearPreview(); setUrl(e.target.value) }} onBlur={e => { const value = e.target.value.trim(); if (importUrlKind(value)) void runInspect(value, 'blur') }} onPaste={event => { const text = event.clipboardData.getData('text'); if (importUrlKind(text) && shouldAutoStart(pasteFlag, 'paste')) { event.preventDefault(); arm('paste', { url: text.trim() }) } }} disabled={busy}/></label>:<label className="studio-file"><span>{file?.name || t("Choose a video")}</span><input type="file" aria-label={t("Video file")} accept="video/mp4,video/webm,video/quicktime,.mkv,.avi" disabled={busy} onChange={e=>{ const picked = e.target.files?.[0] || null; setFile(picked); if (picked) arm('drop', { file: picked }) }}/><small>MP4 / MOV / MKV / WEBM / AVI</small></label>}
      </>}
      {templatesOn && visualOn && platforms.some(platform => !['bilibili', 'youtube_long', 'original'].includes(platform)) && <StyleProbeLine sourceKey={source === 'file' ? (file ? `file:${file.name}:${file.size}:${file.lastModified}` : null) : (url.trim() ? `url:${url.trim()}` : null)} />}
      {remembered ? <div className="ac-platform-line"><p>{t('Making this for {{names}}', { names })}</p><button type="button" className="studio-link" disabled={busy} onClick={() => setPlatformOpen(open => !open)}>{t('Change')}</button></div> : null}
      {(!remembered || platformOpen) && <PlatformPicker value={platforms} onChange={changePlatforms} disabled={busy}/>}
      {templatesOn && platforms.some(platform => !['bilibili', 'youtube_long', 'original'].includes(platform)) && <TemplatePicker visual={visualOn} disabled={busy} value={options.html_template} sourceKey={source === 'file' ? (file ? `file:${file.name}:${file.size}:${file.lastModified}` : null) : (url.trim() ? `url:${url.trim()}` : null)} url={url} file={file} sourceKind={source === 'file' ? (file ? 'file' : 'none') : (url.trim() ? 'link' : 'none')} onChange={(html_template: HtmlTemplateChoice) => setOptions({...options, html_template})}/>}
      {!templatesOn && platforms.some(platform => !['bilibili', 'youtube_long', 'original'].includes(platform)) && <div className="studio-field"><span>{t('Portrait layout')}</span><Select aria-label={t('Portrait layout')} disabled={busy} value={options.portrait_style || 'auto'} options={[{value:'auto',label:t('Platform default')},{value:'interview',label:t('Interview (speaker window)')},{value:'podcast',label:t('Podcast (full screen)')}]} onChange={portrait_style=>setOptions({...options,portrait_style})}/><small>{t('Changes portrait layout only. Caption and post language still follow the platform.')}</small></div>}
      {templatesOn && options.html_template === 'classic' && platforms.some(platform => !['bilibili', 'youtube_long', 'original'].includes(platform)) && <div className="studio-field"><span>{t('Portrait layout')}</span><Select aria-label={t('Portrait layout')} disabled={busy} value={options.portrait_style || 'auto'} options={[{value:'auto',label:t('Platform default')},{value:'interview',label:t('Interview (speaker window)')},{value:'podcast',label:t('Podcast (full screen)')}]} onChange={portrait_style=>setOptions({...options,portrait_style})}/><small>{t('Changes portrait layout only. Caption and post language still follow the platform.')}</small></div>}
      <OutputCaptionsSwitch label={t('Subtitles')} hint={t('Off: the finished video has no captions. The title is only on the cover, not burned into the video.')} />
      <details className="studio-details"><summary>{t("Any special requests? (Optional)")}</summary><label className="studio-field"><span className="studio-sr">{t("Production instructions")}</span><input aria-label={t("Production instructions")} placeholder={t("e.g. keep full arguments or the whole challenge")} maxLength={1000} value={options.instruction} disabled={busy} onChange={e=>setOptions({...options,instruction:e.target.value})}/></label></details>
      {issues.length > 0 && <div className="studio-readiness" role="status">
        {issues.map(item => <div className="studio-readiness-row" key={item.key}>
          <StatusDot tone={item.code === 'whisper_installing' || item.code === 'whisper_model_downloading' ? 'accent' : 'muted'} label={issueCopy(item)} />
          {item.repair !== 'none' && <Btn size="sm" disabled={busy || repairing} loading={repairing && item.repair === 'install_whisper'} onClick={() => void repair(item)}>{repairLabel(item)}</Btn>}
        </div>)}
      </div>}
      <ReadinessLine report={readiness} busy={busy} repairing={repairing} onFix={item => void repair(item)} />
      {(source === 'link' && (previewLoading || urlPreview)) && <UrlPreview
        preview={urlPreview}
        loading={previewLoading}
        needsTranscriptionInstall={needsPreviewTranscriptionInstall}
        installing={repairing}
        suggestFirstWindow={shouldSuggestFirstWindow(hasSuccessHistory(), urlPreview?.duration ?? null)}
        onInstallTranscription={() => {
          const check = readiness?.checks?.transcription
          resumeSubmit.current = false
          setError('')
          recover.open(check?.code || 'whisper_not_installed', check?.model)
          void recover.install()
        }}
        onConfirm={() => { setPending(null); void submit('button') }}
        onConfirmFirstWindow={() => {
          firstWindowDecided.current = true
          sourceWindowOverride.current = { start: 0, end: FIRST_WINDOW_END_SEC }
          setOptions(prev => ({ ...prev, source_window: { start: 0, end: FIRST_WINDOW_END_SEC } }))
          setPending(null)
          void submit('button', undefined, true)
        }}
        onConfirmFull={() => {
          firstWindowDecided.current = true
          sourceWindowOverride.current = null
          setOptions(prev => ({ ...prev, source_window: null }))
          setPending(null)
          void submit('button', undefined, true)
        }}
        onDismiss={() => { clearPreview(); setUrl(''); setPending(null); firstWindowDecided.current = false }}
      />}
      {platforms.includes('youtube_long') && <p className="studio-muted" role="note">{longFormNotice(longGate.durationSec, platforms)}</p>}
      {assist && <details className="studio-details" open><summary>{t("If downloading requires sign-in")}</summary><BrowserCookieControl assist browser={browser} busy={busy} onChange={setBrowser} selectRef={browserRef} /></details>}
      {pending && <div className="ac-undo" role="status"><span>{t('Starting shortly.')}</span><button type="button" className="ac-undo-action" onClick={undo}>{t('Undo')}</button></div>}
      <div className="studio-row studio-import-bottom"><div><span className="studio-muted">{t('Cuts are made for each platform you chose. How many depends on the source.')}</span>{!hidePreferences && <button className="studio-link studio-preferences-link" disabled={busy} onClick={()=>setPreferences(true)}>{t("Advanced preferences")}</button>}</div><Btn variant="cta" loading={busy} onClick={() => submit('button')}>{busy?t("Generating"):t("Generate videos")}</Btn></div>
      <TranscriptionGatePrompt state={recovery} busy={busy} onInstall={() => recover.install()} onRetry={() => recover.retry()} onContinue={() => continueAfterRecovery(null)} navigate={navigate}/>
      {error&&<p className="studio-error" role="alert">{error}</p>}
    </div>
    <Dialog open={preferences} onClose={()=>setPreferences(false)} title={t("Production preferences")} description={t("AI matches settings by default. Your choices take priority and remain editable.")} footer={<div className="studio-actions"><Btn onClick={()=>{setOptions({...defaultImportOptions,instruction:options.instruction});setSubtitle(null);setBrowser('')}}>{t("Reset to automatic")}</Btn><Btn variant="cta" onClick={()=>setPreferences(false)}>{t("Done")}</Btn></div>}>
      <ImportPreferences value={options} onChange={setOptions}/>
      <label className="studio-field">{t("Existing subtitles (optional)")}<input type="file" accept=".srt" aria-label={t("Existing subtitles")} onChange={e=>setSubtitle(e.target.files?.[0] || null)}/>{subtitle&&<small>{subtitle.name}<button className="studio-link" onClick={()=>setSubtitle(null)}>{t("Remove")}</button></small>}</label>
      {source==='link'&&<details className="studio-details"><summary>{t("If downloading requires sign-in")}</summary><BrowserCookieControl browser={browser} busy={busy} onChange={setBrowser} assist={false} /></details>}
    </Dialog>
    <Dialog open={longGate.open} onClose={() => setLongGate(prev => ({ ...prev, open: false }))} title={t('YouTube landscape')} description={youtubeLongOnlyTooShort ? <>{longFormNotice(longGate.durationSec, platforms)} {t('Pick another platform as well.')}</> : longFormNotice(longGate.durationSec, platforms)} footer={youtubeLongOnlyTooShort ? <div className="studio-actions"><Btn onClick={() => setLongGate(prev => ({ ...prev, open: false }))}>{t('Got it')}</Btn></div> : <div className="studio-actions"><Btn onClick={() => setLongGate(prev => ({ ...prev, open: false }))}>{t('Cancel')}</Btn><Btn variant="cta" onClick={() => { const trigger = longGate.trigger || 'button'; setLongGate(prev => ({ ...prev, open: false })); void submit(trigger, undefined, true) }}>{t('Confirm and start')}</Btn></div>} />
    <Dialog open={firstWindowGate.open} onClose={() => setFirstWindowGate(prev => ({ ...prev, open: false }))} title={t('First-material tip')} description={t('For the first run, try up to 30 minutes to confirm the model setup')} footer={<div className="studio-actions" data-testid="t2-first-window-dialog"><Btn onClick={() => setFirstWindowGate(prev => ({ ...prev, open: false }))}>{t('Cancel')}</Btn><Btn onClick={() => { firstWindowDecided.current = true; sourceWindowOverride.current = null; setOptions(prev => ({ ...prev, source_window: null })); setFirstWindowGate(prev => ({ ...prev, open: false })); void submit(firstWindowGate.trigger || 'button', undefined, true) }}>{t('Process full video')}</Btn><Btn variant="cta" onClick={() => { firstWindowDecided.current = true; sourceWindowOverride.current = { start: 0, end: FIRST_WINDOW_END_SEC }; setOptions(prev => ({ ...prev, source_window: { start: 0, end: FIRST_WINDOW_END_SEC } })); setFirstWindowGate(prev => ({ ...prev, open: false })); void submit(firstWindowGate.trigger || 'button', undefined, true) }}>{t('Only first 30 minutes')}</Btn></div>} />
  </section>
}
