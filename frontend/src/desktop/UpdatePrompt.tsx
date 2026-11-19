import { useTranslation } from 'react-i18next'
import { t } from '../i18n'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Dialog, ProgressLine } from '../ui'
import { isDesktopMode } from '../utils/desktopMode'
import {
  type AppUpdate,
  checkForUpdate,
  emptyProgress,
  getAppVersion,
  maybeCheckForUpdate,
} from './updater'
import {
  applyDownloadEvent,
  areRemindersEnabled,
  displayError,
  previewNotes,
  rememberReminder,
  SNOOZE_KEY,
  writeRemindersEnabled,
} from './updateSchedule'

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'failed' | 'restarting'

export type AppUpdateController = {
  phase: UpdatePhase
  desktop: boolean
  preview: boolean
  version: string
  currentVersion: string
  notes: string
  percent: number | null
  error: string
  toastVisible: boolean
  reminderVisible: boolean
  remindersEnabled: boolean
  checkNow: () => Promise<'current' | 'available'>
  snooze: () => void
  showToast: () => void
  openUpdate: () => void
  restart: () => Promise<void>
  retry: () => Promise<void>
  setRemindersEnabled: (enabled: boolean) => void
  dismissReminder: () => void
  acceptReminder: () => Promise<void>
  disableReminders: () => void
}

const UpdateContext = createContext<AppUpdateController | null>(null)

type PreviewKind = 'downloading' | 'ready' | 'failed' | 'available'

function readPreview(): PreviewKind | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const query = window.location.hash.split('?')[1] || ''
  const value = new URLSearchParams(query).get('previewUpdate')
  if (value === 'downloading' || value === 'ready' || value === 'failed' || value === 'available') return value
  return null
}

function localStore(): Storage | null {
  try { return localStorage } catch { return null }
}

function readRemindersEnabled(): boolean {
  const storage = localStore()
  return storage ? areRemindersEnabled(storage) : true
}

function readSnooze(): string {
  try { return sessionStorage.getItem(SNOOZE_KEY) || '' } catch { return '' }
}

function writeSnooze(version: string) {
  try {
    if (version) sessionStorage.setItem(SNOOZE_KEY, version)
  } catch { /* Privacy Mode */ }
}

function clearSnooze() {
  try { sessionStorage.removeItem(SNOOZE_KEY) } catch { /* Privacy Mode */ }
}

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const previewKind = useMemo(readPreview, [])
  const [phase, setPhase] = useState<UpdatePhase>(
    previewKind === 'downloading' ? 'downloading' : previewKind === 'ready' ? 'ready' : previewKind === 'failed' ? 'failed' : 'idle',
  )
  const [desktop, setDesktop] = useState(Boolean(previewKind))
  const [version, setVersion] = useState(previewKind ? '1.4.0' : '')
  const [currentVersion, setCurrentVersion] = useState(previewKind ? '1.3.1' : '')
  const [notes, setNotes] = useState(previewKind === 'downloading' || previewKind === 'ready' ? 'BackendDownloadNewVersion，Prompt to restart when ready。' : '')
  const [percent, setPercent] = useState<number | null>(previewKind === 'downloading' ? 42 : previewKind === 'ready' ? 100 : null)
  const [error, setError] = useState(previewKind === 'failed' ? 'offline' : '')
  const [toastVisible, setToastVisible] = useState(previewKind === 'ready' || previewKind === 'failed')
  const [reminderVisible, setReminderVisible] = useState(previewKind === 'available')
  const [remindersEnabled, setRemindersEnabledState] = useState(readRemindersEnabled)
  const live = useRef<AppUpdate | null>(null)
  const generation = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const beginDownload = useCallback(async (found: AppUpdate) => {
    const token = ++generation.current
    const previous = live.current
    live.current = found
    if (previous && previous !== found) void previous.close().catch(() => undefined)
    setVersion(found.version)
    setNotes(previewNotes(found.body))
    setError('')
    setPercent(null)
    setPhase('downloading')
    setToastVisible(false)
    const snap = emptyProgress()
    let latest = snap
    let lastPaint = 0
    try {
      await found.download((event) => {
        if (token !== generation.current) return
        latest = applyDownloadEvent(latest, event)
        const now = Date.now()
        if (event.event === 'Finished' || now - lastPaint > 150) {
          lastPaint = now
          setPercent(latest.percent)
        }
      })
      if (token !== generation.current) return
      setPercent(100)
      setPhase('ready')
      if (readSnooze() !== found.version) setToastVisible(true)
    } catch (err) {
      if (token !== generation.current) return
      setError(displayError(err))
      setPhase('failed')
      setToastVisible(true)
    }
  }, [])

  const checkNow = useCallback(async (): Promise<'current' | 'available'> => {
    if (previewKind) {
      setToastVisible(true)
      return phase === 'idle' ? 'current' : 'available'
    }
    if (!(await isDesktopMode())) throw new Error('desktop-only')
    setPhase('checking')
    setError('')
    try {
      const found = await checkForUpdate()
      const current = await getAppVersion()
      setCurrentVersion(current)
      setDesktop(true)
      if (!found) {
        setPhase('idle')
        setVersion('')
        setNotes('')
        setToastVisible(false)
        setReminderVisible(false)
        const previous = live.current
        live.current = null
        if (previous) void previous.close().catch(() => undefined)
        return 'current'
      }
      clearSnooze()
      setReminderVisible(false)
      await beginDownload(found)
      return 'available'
    } catch (err) {
      setPhase('idle')
      throw err
    }
  }, [beginDownload, phase, previewKind])

  const restart = useCallback(async () => {
    if (previewKind) {
      setPhase('restarting')
      setToastVisible(true)
      return
    }
    const found = live.current
    if (!found) return
    setPhase('restarting')
    setToastVisible(true)
    try {
      await found.installAndRelaunch()
    } catch (err) {
      setError(displayError(err))
      setPhase('ready')
      setToastVisible(true)
    }
  }, [previewKind])

  const retry = useCallback(async () => {
    clearSnooze()
    await checkNow()
  }, [checkNow])

  const snooze = useCallback(() => {
    writeSnooze(version)
    setToastVisible(false)
  }, [version])

  const showToast = useCallback(() => setToastVisible(true), [])

  const openUpdate = useCallback(() => {
    clearSnooze()
    setToastVisible(true)
    if (phase === 'failed') void checkNow()
  }, [phase, checkNow])

  const persistReminders = useCallback((enabled: boolean) => {
    setRemindersEnabledState(enabled)
    const storage = localStore()
    if (storage) writeRemindersEnabled(storage, enabled)
  }, [])

  const releaseIdleUpdate = useCallback(() => {
    const current = phaseRef.current
    if (current === 'downloading' || current === 'ready' || current === 'restarting') return
    const previous = live.current
    live.current = null
    if (previous) void previous.close().catch(() => undefined)
  }, [])

  const offerReminder = useCallback((found: AppUpdate) => {
    const previous = live.current
    live.current = found
    if (previous && previous !== found) void previous.close().catch(() => undefined)
    setVersion(found.version)
    setNotes(previewNotes(found.body))
    setError('')
    setReminderVisible(true)
    const storage = localStore()
    if (storage) rememberReminder(storage, found.version, Date.now())
  }, [])

  const dismissReminder = useCallback(() => {
    setReminderVisible(false)
    releaseIdleUpdate()
  }, [releaseIdleUpdate])

  const acceptReminder = useCallback(async () => {
    setReminderVisible(false)
    if (previewKind === 'available') {
      setPhase('downloading')
      setToastVisible(false)
      return
    }
    const found = live.current
    if (!found) return
    await beginDownload(found)
  }, [beginDownload, previewKind])

  const setRemindersEnabled = useCallback((enabled: boolean) => {
    persistReminders(enabled)
    if (enabled) return
    setReminderVisible(false)
    setToastVisible(false)
    releaseIdleUpdate()
  }, [persistReminders, releaseIdleUpdate])

  const disableReminders = useCallback(() => {
    setRemindersEnabled(false)
  }, [setRemindersEnabled])

  useEffect(() => {
    if (previewKind) return
    let cancelled = false
    void (async () => {
      const isDesktop = await isDesktopMode()
      if (cancelled) return
      setDesktop(isDesktop)
      const current = await getAppVersion()
      if (cancelled) return
      setCurrentVersion(current)
      if (!isDesktop) return
      const found = await maybeCheckForUpdate()
      if (cancelled || !found) return
      offerReminder(found)
    })()
    return () => { cancelled = true }
  }, [offerReminder, previewKind])

  const value = useMemo<AppUpdateController>(() => ({
    phase, desktop, preview: Boolean(previewKind), version, currentVersion, notes, percent, error, toastVisible,
    reminderVisible, remindersEnabled,
    checkNow, snooze, showToast, openUpdate, restart, retry,
    setRemindersEnabled, dismissReminder, acceptReminder, disableReminders,
  }), [phase, desktop, previewKind, version, currentVersion, notes, percent, error, toastVisible, reminderVisible, remindersEnabled, checkNow, snooze, showToast, openUpdate, restart, retry, setRemindersEnabled, dismissReminder, acceptReminder, disableReminders])

  return (
    <UpdateContext.Provider value={value}>
      {children}
      <UpdateReminder />
    </UpdateContext.Provider>
  )
}

export function useAppUpdate(): AppUpdateController {
  const value = useContext(UpdateContext)
  if (!value) throw new Error('useAppUpdate must be used within UpdateProvider')
  return value
}

export const UpdateReminder: React.FC = () => {
  useTranslation()
  const update = useAppUpdate()
  if (!update.reminderVisible) return null
  const description = update.currentVersion
    ? t('Version {{version}} is available; you have {{current}}. The app will restart after installation.', { version: update.version, current: update.currentVersion })
    : t('Version {{version}} is available. The app will restart after installation.', { version: update.version })
  return (
    <Dialog
      open
      onClose={update.dismissReminder}
      title={t('Update available')}
      description={description}
      footer={(
        <>
          <Btn size="sm" variant="text" onClick={update.disableReminders}>{t("Don't remind me")}</Btn>
          <div className="right">
            <Btn size="sm" onClick={update.dismissReminder}>{t('Later')}</Btn>
            <Btn size="sm" variant="cta" onClick={() => void update.acceptReminder()}>{t('Download and install')}</Btn>
          </div>
        </>
      )}
    >
      {update.notes ? <p className="ac-update-notes">{update.notes}</p> : null}
    </Dialog>
  )
}

export const UpdateToast: React.FC = () => {
  useTranslation()
  const update = useAppUpdate()
  const { toastVisible, phase, snooze } = update
  useEffect(() => {
    if (!toastVisible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase !== 'restarting') snooze()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toastVisible, phase, snooze])

  if (!update.toastVisible) return null
  const title = update.phase === 'ready' || update.phase === 'restarting'
    ? t('Update ready')
    : update.phase === 'failed'
      ? t('Update did not finish')
      : t('Preparing update')
  const description = update.phase === 'failed'
    ? update.error
    : update.phase === 'downloading'
      ? t('Downloading {{version}}', { version: update.version })
      : t('Restart to finish installing AutoClip {{version}}. Work in progress stays as it is.', { version: update.version })

  return (
    <div className="ac-update-toast" role="status" aria-live="polite" data-phase={update.phase}>
      <h3>{title}</h3>
      <p>{description}</p>
      {update.notes && update.phase !== 'failed' && <p className="ac-update-notes">{update.notes}</p>}
      {update.phase === 'downloading' && (
        <div className="ac-update-progress">
          <ProgressLine percent={update.percent ?? 0} />
          {update.percent != null && <span className="ac-update-percent">{update.percent}%</span>}
        </div>
      )}
      <div className="ac-update-actions">
        {update.phase !== 'restarting' && (
          <Btn size="sm" variant="text" onClick={update.disableReminders}>{t("Don't remind me")}</Btn>
        )}
        {update.phase !== 'restarting' && (
          <Btn size="sm" onClick={update.snooze}>{t('Not now')}</Btn>
        )}
        {update.phase === 'ready' && (
          <Btn size="sm" variant="cta" onClick={() => void update.restart()}>{t('Update and restart')}</Btn>
        )}
        {update.phase === 'failed' && (
          <Btn size="sm" variant="cta" onClick={() => void update.retry()}>{t('Retry')}</Btn>
        )}
        {update.phase === 'restarting' && (
          <Btn size="sm" variant="cta" loading>{t('Restarting')}</Btn>
        )}
      </div>
    </div>
  )
}
