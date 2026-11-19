import { trackExperience } from '../analytics/experience'
import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Switch, message } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { settingsApi } from '../services/api'
import AIModelSettings from '../features/settings/AIModelSettings'
import OutputBrandingSetting from '../features/settings/OutputBrandingSetting'
import OutputCaptionsSetting from '../features/settings/OutputCaptionsSetting'
import FeedbackDialog from '../components/FeedbackDialog'
import PublishSettings from '../components/PublishSettings'
import { isDesktopMode } from '../utils/desktopMode'
import { openExternalLink } from '../utils/externalLinks'
import { isAnalyticsEnabled, setAnalyticsEnabled } from '../analytics/posthog'
import { getRuntimeInfo } from '../analytics/lifecycle'
import { isCrashReportsEnabled, setCrashReportsEnabled } from '../desktop/sentry'
import { isKeepAwakeEnabled, getKeepAwakeController } from '../features/studio/keepAwake'
import { getAppVersion } from '../desktop/updater'
import { useAppUpdate } from '../desktop/UpdatePrompt'
import { FEEDBACK_DISCUSSIONS_URL, FEEDBACK_ISSUES_URL } from '../analytics/feedback'
import { useTheme } from '../context/ThemeContext'
import { Btn, Icon, Row, Section, Segmented } from '../ui'
import FlagOverrides, { flagOverridesVisible } from '../features/settings/FlagOverrides'
import ImportPreferenceSettings from '../features/settings/ImportPreferenceSettings'

type SectionKey = 'ai' | 'publish' | 'app' | 'feedback'
const NAV: Array<{ key: SectionKey; label: string }> = [
  { key: 'ai', get label() { return t('Providers & models') } },
  { key: 'publish', get label() { return t("Publish") } },
  { key: 'app', get label() { return t("Application") } },
  { key: 'feedback', get label() { return t("Feedback") } },
]
// Old link（ProjectCard「Model settings」「Transcription」etc.）Still canOn，andScroll to the corresponding section
const SECTION_ALIASES: Record<string, { section: SectionKey; anchor?: string }> = {
  model: { section: 'ai', anchor: 'ai-defaults' },
  analysis: { section: 'ai', anchor: 'ai-defaults-analysis' },
  vision: { section: 'ai', anchor: 'ai-defaults-vision' },
  speech: { section: 'ai', anchor: 'ai-defaults-transcription' },
  cover: { section: 'ai', anchor: 'ai-defaults-cover' },
}

// Calm Premium settings — left nav + setting rows (see DESIGN.md → App Layer)
const SettingsPage: React.FC = () => {
  useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const requested = new URLSearchParams(location.search).get('section') || ''
  const initialSection = useMemo<SectionKey>(() => (
    SECTION_ALIASES[requested]?.section || (NAV.find((n) => n.key === requested)?.key as SectionKey) || 'ai'
  ), [requested])
  const [active, setActive] = useState<SectionKey>(initialSection)
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled())
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const runtime = getRuntimeInfo()
  const viewedSection = useRef<SectionKey | null>(null)
  useEffect(() => {
    if (viewedSection.current === active) return
    viewedSection.current = active
    trackExperience('settings_section_viewed', { section: active, entry_source: location.state?.settingsEntry === 'home_setup' ? 'home_setup' : 'direct' })
  }, [active])
  useEffect(() => { setActive(initialSection) }, [initialSection])
  return (
    <div className="ac-page">
      <header>
        {/* andDetailsPage consistency：Within the pageBack，Not dependent on the top bar logo */}
        <button className="ac-back" onClick={() => navigate('/')}>
          <Icon.Back />{t("Project")}</button>
        <h1 className="ac-title">{t("Settings")}</h1>
        <div className="ac-meta">
          <span className="ac-mono">{runtime.version !== 'unknown' ? `v${runtime.version}` : 'dev'}</span>
          <span className="dot" />
          <span className="ac-mono">{runtime.os}/{runtime.arch}</span>
        </div>
      </header>

      <div className="ac-settings" style={{ marginTop: 36 }}>
        <nav className="ac-settings-nav" aria-label={t("Settings sections")}>
          {NAV.map((n) => (
            <button key={n.key} aria-current={active === n.key} onClick={() => navigate(`/settings?section=${n.key}`, { replace: true })}>{n.label}</button>
          ))}
        </nav>

        <div className="ac-settings-body">
          <div hidden={active !== 'ai'}>
            <AIModelSettings requestedSection={requested} requestedProvider={new URLSearchParams(location.search).get('provider') || ''} />
          </div>

          {/* ---------------- Application ---------------- */}
          {active === 'app' && (
            <AppSection analyticsOn={analyticsOn} onAnalyticsChange={(on) => { setAnalyticsEnabled(on); setAnalyticsOn(on) }} />
          )}

          {active === 'publish' && <PublishSettings />}

          {/* ---------------- Feedback ---------------- */}
          {active === 'feedback' && (
            <Section title={t("Feedback")} description={t("Tell us what went wrong or what you need. Runtime details are attached, without videos or API keys. After you send, the note and optional contact go to PostHog first, then appear on GitHub; your email stays private.")}>
              <div className="ac-rows">
                <Row label={t("Send feedback")} hint={t("Write a short note in the app. It goes to PostHog first; bugs become GitHub Issues, ideas become Discussions.")}>
                  <Btn variant="cta" size="sm" style={{ height: 32, fontSize: 13, padding: '0 16px' }} onClick={() => setFeedbackOpen(true)}>
                    <Icon.Chat size={13} />{t("Write feedback")}</Btn>
                </Row>
                <Row label={t("Something broke")} hint={t("Put the version, platform, and model in an issue so it can be reproduced.")}>
                  <Btn size="sm" onClick={() => openExternalLink(FEEDBACK_ISSUES_URL)}>{t("Report issue")}<Icon.External size={12} /></Btn>
                </Row>
                <Row label={t("Ideas and use cases")} hint={t("Post what you want and how you use AutoClip in Discussions. Don't open an issue for that.")}>
                  <Btn size="sm" onClick={() => openExternalLink(FEEDBACK_DISCUSSIONS_URL)}>{t("Discuss")}<Icon.External size={12} /></Btn>
                </Row>
                <Row label={t("Status and known issues")} hint={t("Release plans, known bugs and workarounds are in the pinned issue.")}>
                  <Btn variant="text" size="sm" onClick={() => openExternalLink('https://github.com/zhouxiaoka/autoclip/issues/96')}>#96 <Icon.External size={12} /></Btn>
                </Row>
              </div>
            </Section>
          )}
        </div>
      </div>

      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} context={{ source: 'settings' }} />
    </div>
  )
}

/* ---------------- Application ---------------- */
const AppSection: React.FC<{ analyticsOn: boolean; onAnalyticsChange: (on: boolean) => void }> = ({ analyticsOn, onAnalyticsChange }) => {
  useTranslation()
  const { theme, setTheme } = useTheme()
  const [autostart, setAutostart] = useState(false)
  const [keepAwake, setKeepAwake] = useState(() => isKeepAwakeEnabled())
  const [busy, setBusy] = useState(false)
  const [desktop, setDesktop] = useState(false)
  const [crashOn, setCrashOn] = useState(isCrashReportsEnabled())
  const crashPreferenceChanged = useRef(false)
  const [version, setVersion] = useState('')
  const appUpdate = useAppUpdate()

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const isDesktop = await isDesktopMode()
        setDesktop(isDesktop)
        setVersion(await getAppVersion())
        if (isDesktop) {
          const { invoke } = await import('@tauri-apps/api/core')
          setAutostart(Boolean(await invoke('is_autostart_enabled')))
        }
        try {
          const privacy = await settingsApi.getPrivacy()
          // A delayed snapshot must not undo a newer choice or an unmounted page.
          if (active && !crashPreferenceChanged.current && typeof privacy?.crash_reports === 'boolean') {
            setCrashReportsEnabled(privacy.crash_reports)
            setCrashOn(privacy.crash_reports)
          }
        } catch {
          /* Used when the backend is not running or when the data directory is not on the desktop localStorage */
        }
      } catch (err) {
        console.error('CheckAutoStartStatusFailed:', err)
      }
    })()
    return () => { active = false }
  }, [])

  const toggleAutostart = async (enabled: boolean) => {
    if (!desktop) { message.error(t("This feature is only available in the desktop app")); return }
    setBusy(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke(enabled ? 'enable_autostart' : 'disable_autostart')
      setAutostart(enabled)
    } catch (err) {
      console.error('SwitchAutoStartStatusFailed:', err)
      message.error(t("Action failed: {{value1}}", { value1: err }))
    } finally {
      setBusy(false)
    }
  }


  const toggleKeepAwake = (enabled: boolean) => {
    setKeepAwake(enabled)
    getKeepAwakeController().onEnabledChange(enabled)
  }

  const toggleCrashReports = async (enabled: boolean) => {
    crashPreferenceChanged.current = true
    setCrashReportsEnabled(enabled)
    setCrashOn(enabled)
    try {
      await settingsApi.updatePrivacy({ crash_reports: enabled })
    } catch {
      message.warning(t("The interface preference was applied, but the backend privacy setting could not be saved. Please retry."))
    }
  }

  const handleCheckUpdate = async () => {
    if (!desktop && !appUpdate.preview) { message.info(t('Update checks are available in the desktop app only.')); return }
    try {
      const result = await appUpdate.checkNow()
      if (result === 'current') {
        const current = appUpdate.currentVersion || version
        message.success(current ? t('You are up to date ({{version}}).', { version: current }) : t('You are up to date.'))
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      if (text === 'desktop-only') message.info(t('Update checks are available in the desktop app only.'))
      else message.error(t('Update check failed: {{error}}', { error: text.split('{{').join('{') }))
    }
  }

  const shownVersion = appUpdate.currentVersion || version
  const versionHint = appUpdate.phase === 'ready' || appUpdate.phase === 'restarting'
    ? t('Ready to update to {{version}}', { version: appUpdate.version })
    : appUpdate.phase === 'downloading'
      ? t('Preparing {{version}}', { version: appUpdate.version })
      : appUpdate.phase === 'failed'
        ? t('Update did not finish: {{error}}', { error: appUpdate.error })
        : shownVersion
          ? t('Current: {{version}}', { version: shownVersion })
          : t('The desktop app checks GitHub Releases for updates.')

  return (
    <Section title={t("Application")} description={t("Appearance, startup and privacy.")}>
      <div className="ac-rows">
        <Row label={t("Appearance")} hint={t("Follows your system on first launch.")}>
          <Segmented size="sm" ariaLabel={t("Appearance")} value={theme} onChange={setTheme} options={[{ value: 'light', label: t("Light") }, { value: 'dark', label: t("Dark") }]} />
        </Row>
        <Row label={t("Launch at login")} hint={t("Start with your system and open from the tray. Desktop app only.")}>
          <Switch checked={autostart} onChange={toggleAutostart} loading={busy} disabled={!desktop} />
        </Row>
        <Row label={t("Prevent sleep while producing")} hint={t("Keep the system awake while producing (screen may still turn off). When off, the computer may sleep on its schedule.")}>
          <Switch checked={keepAwake} onChange={toggleKeepAwake} />
        </Row>
        <OutputBrandingSetting />
        <OutputCaptionsSetting />
        {(desktop || appUpdate.preview) && (
          <>
            <Row label={t('Version')} hint={versionHint}>
              {appUpdate.phase === 'ready' || appUpdate.phase === 'restarting' ? (
                <Btn size="sm" variant="cta" loading={appUpdate.phase === 'restarting'} onClick={() => void appUpdate.restart()}>{t('Update and restart')}</Btn>
              ) : appUpdate.phase === 'downloading' ? (
                <Btn size="sm" onClick={appUpdate.showToast}>{t('View progress')}</Btn>
              ) : appUpdate.phase === 'failed' ? (
                <Btn size="sm" onClick={() => void appUpdate.retry()}>{t('Retry')}</Btn>
              ) : (
                <Btn size="sm" loading={appUpdate.phase === 'checking'} onClick={() => void handleCheckUpdate()}>{t('Check for updates')}</Btn>
              )}
            </Row>
            <Row label={t('Check for updates on startup')} hint={t('Remind when a new version is available, at most once a day for the same version. You can still check manually after turning this off.')}>
              <Switch checked={appUpdate.remindersEnabled} onChange={appUpdate.setRemindersEnabled} />
            </Row>
          </>
        )}
        <Row label={t("Anonymous usage statistics")} hint={t("Collects anonymous feature usage and processing outcomes, without video content, subtitles or API keys. You can still send feedback after turning this off.")}>
          <Switch checked={analyticsOn} onChange={onAnalyticsChange} />
        </Row>
        <Row label={t("Crash reports")} hint={t("Sends crash stacks to Sentry to help fix bugs. No video content, subtitles or API keys. Nothing is sent without a configured endpoint.")}>
          <Switch checked={crashOn} onChange={toggleCrashReports} />
        </Row>
      </div>
      <div style={{ marginTop: 'var(--ac-space-3xl)' }}>
        <ImportPreferenceSettings />
        {flagOverridesVisible() && <FlagOverrides />}
      </div>
    </Section>
  )
}

export default SettingsPage
