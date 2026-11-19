/**
 * ApplicationLifecycle tracking points + Global attributes（super properties）。
 *
 * - Global attributes：app_version / os / arch / locale，Every  after registrationclipsEventAutoCarry，
 *   Convenient to press"Version / System / Architecture"ClipsAnalysis（Troubleshooting"SomeoneVersionGet it from theA certain systemFailedRateHigh"etc.）。
 * - Lifecycle events：
 *   - app_installed：First startup of this device（= Installed base proxy indicator）
 *   - app_opened：Every startup（PostHog AccordinglyAutoCalculate DAU / Retention）
 *   - app_updated：VersionNumber has changed since last time
 */
import { getVersion } from '@tauri-apps/api/app'
import { posthog, captureBusinessEvent, isAnalyticsEnabled } from './posthog'
import { runtimeProperties } from './runtime'

const INSTALL_FLAG_KEY = 'autovideoclip.analytics.installed'
const LAST_VERSION_KEY = 'autovideoclip.analytics.lastVersion'
const SESSION_COUNT_KEY = 'autovideoclip.analytics.sessionCount'

async function getAppVersion(): Promise<string> {
  try {
    return await getVersion()
  } catch {
    // Not Tauri Environment（As if running in a browser vite dev）Unable to retrieveVersion
    return import.meta.env.VITE_APP_VERSION || 'unknown'
  }
}

function readInt(key: string): number {
  try {
    return parseInt(localStorage.getItem(key) || '0', 10) || 0
  } catch {
    return 0
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export interface RuntimeInfo { version: string; os: string; arch: string; locale: string }
let runtimeInfo: RuntimeInfo = { version: import.meta.env.VITE_APP_VERSION || 'unknown', ...runtimeProperties(), locale: typeof navigator !== 'undefined' ? navigator.language : '' }

/** Cached runtime environment after startup（Version / System / Architecture），ProvideFeedbackReuse in other scenarios；Regardless of whether it relies on tracking pointsOn。 */
export function getRuntimeInfo(): RuntimeInfo {
  return { ...runtimeInfo, locale: document.documentElement.lang || runtimeInfo.locale }
}

/**
 * Register Global PropertiesandReport lifecycle events related to startup。
 * Get it from the initAnalytics() Call once afterwards。posthog Only cache the runtime environment when not initialized。
 */
export async function trackLaunch(): Promise<void> {
  const appVersion = await getAppVersion()
  const { os, arch } = runtimeProperties()
  const locale = document.documentElement.lang || navigator.language
  runtimeInfo = { version: appVersion, os, arch, locale }

  if (!isAnalyticsEnabled() || typeof posthog?.register !== 'function') return

  // Global attributes：Subsequently, everyclipsEventAutoCarry
  try {
    posthog.register({
      app_version: appVersion,
      os,
      arch,
      app_locale: locale,
      analytics_environment: import.meta.env.DEV ? 'development' : 'production',
    })
  } catch { return }

  // Session count
  const sessionCount = readInt(SESSION_COUNT_KEY) + 1
  safeSet(SESSION_COUNT_KEY, String(sessionCount))

  // First timeInstall
  let isInstalled = false
  try {
    isInstalled = localStorage.getItem(INSTALL_FLAG_KEY) === 'true'
  } catch {
    /* ignore */
  }
  if (!isInstalled) {
    if (captureBusinessEvent('app_installed', { app_version: appVersion, os, arch })) safeSet(INSTALL_FLAG_KEY, 'true')
  }

  // VersionUpdate
  let lastVersion: string | null = null
  try {
    lastVersion = localStorage.getItem(LAST_VERSION_KEY)
  } catch {
    /* ignore */
  }
  if (lastVersion && lastVersion !== appVersion) {
    captureBusinessEvent('app_updated', { from_version: lastVersion, to_version: appVersion })
  }
  safeSet(LAST_VERSION_KEY, appVersion)

  // Every startup
  captureBusinessEvent('app_opened', { app_version: appVersion, session_number: sessionCount })
}
