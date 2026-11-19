import { isDesktopMode } from '../utils/desktopMode'
import {
  rememberSuccessfulCheck,
  shouldCheckAutomatically,
  shouldRemind,
  type ProgressSnap,
} from './updateSchedule'

export type DownloadEvent = {
  event: 'Started' | 'Progress' | 'Finished'
  data?: { contentLength?: number; chunkLength?: number }
}

export type AppUpdate = {
  version: string
  body?: string | null
  date?: string | Date | null
  download: (onEvent?: (progress: DownloadEvent) => void) => Promise<void>
  installAndRelaunch: () => Promise<void>
  close: () => Promise<void>
}

async function loadUpdater() {
  const { check } = await import('@tauri-apps/plugin-updater')
  return check
}

export async function getAppVersion(): Promise<string> {
  if (!(await isDesktopMode())) return import.meta.env.VITE_APP_VERSION || ''
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return import.meta.env.VITE_APP_VERSION || ''
  }
}

export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (!(await isDesktopMode())) return null
  const check = await loadUpdater()
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    body: update.body,
    date: update.date,
    download: (onEvent) => update.download(onEvent),
    installAndRelaunch: async () => {
      // Stop the backend first，Otherwise python.exe Still occupying resources\python\*.pyd，Windows CoverInstallWillFailed（#224）。
      // Continue even if it can't be stopped：Installof the tool PREINSTALL The hook will still be pressedInstallClear the directory again。
      const { invoke } = await import('@tauri-apps/api/core')
      try {
        await invoke('stop_backend_service', { reason: 'update' })
      } catch (error) {
        console.warn('Stop the backend before updatingFailed，Hand over toInstallDevice processing', error)
      }
      try {
        await update.install()
      } catch (error) {
        // Continue starting the backend after an installation failure so the app does not open without it.
        await invoke('start_backend_service').catch(() => undefined)
        throw error
      }
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    },
    close: () => update.close(),
  }
}

let automaticCheck: Promise<AppUpdate | null> | null = null

/** Desktop version for productionAutoCheck：CloseDo not check if a reminder is sent；When it is already the latest version 24 No further checks within hours。Discovered something newVersionor checkFailedNext timeOnI'll check again.，But the sameVersionRemind at most once a day。Offline/Rate limiting silenceFailed。 */
export function maybeCheckForUpdate(): Promise<AppUpdate | null> {
  if (automaticCheck) return automaticCheck
  automaticCheck = runAutomaticCheck().finally(() => { automaticCheck = null })
  return automaticCheck
}

async function runAutomaticCheck(): Promise<AppUpdate | null> {
  if (!import.meta.env.PROD) return null
  if (!(await isDesktopMode())) return null
  let storage: Storage | null = null
  try { storage = localStorage } catch { storage = null }
  if (storage && !shouldCheckAutomatically(storage, Date.now())) return null
  try {
    const update = await checkForUpdate()
    if (storage) rememberSuccessfulCheck(storage, Date.now(), update ? 'available' : 'current')
    if (update && storage && !shouldRemind(storage, update.version, Date.now())) {
      void update.close().catch(() => undefined)
      return null
    }
    return update
  } catch {
    return null
  }
}

export const emptyProgress = (): ProgressSnap => ({ received: 0, total: 0, percent: null })
