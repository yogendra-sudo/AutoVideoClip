/**
 * Key business events（See ROADMAP.md Phase 0：Import / Image output / Failed / Settings key）。
 *
 * UnifiedGet it from theDefine the event name and payload type here，Avoid barecharactersStrings are scattered everywhere。
 * All capture All passed trackEvent，Not initialized / OffTimeAuto no-op。
 */
import { captureBusinessEvent } from './posthog'
import type { SponsorId } from '../features/settings/providers'

export const AnalyticsEvent = {
  /** Import assets（Upload/SelectVideoStart oneProject） */
  VideoImported: 'video_imported',
  /** Legacy: one downloadVideo call received a file and triggered browser download. */
  ClipsExported: 'clips_exported',
  /** Key processesFailed（Import/Transcription/Clips/ExportAny step） */
  ProcessingFailed: 'processing_failed',
  /** Settings/Update LLM API key */
  ApiKeyConfigured: 'api_key_configured',
  /** OnSponsorMerchant registration / Setup guideLink（Only record which company it is、Which entrance?） */
  SponsorLinkOpened: 'sponsor_link_opened',
  /** Historical compatibility events；Currently has real footageExampleChangeUse example_project_open_* and example_project_viewed */
  ExampleProjectOpened: 'example_project_opened',
} as const

export type AnalyticsEventName =
  (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent]

/** General event tracking entry point。posthog Not initialized or already opt-out For the purpose of no-op（Processed internally）。 */
const LEGACY_EVENTS = new Set<AnalyticsEventName>([
  AnalyticsEvent.VideoImported,
  AnalyticsEvent.ClipsExported,
  AnalyticsEvent.ProcessingFailed,
  AnalyticsEvent.ApiKeyConfigured,
  AnalyticsEvent.ExampleProjectOpened,
])

function trackEvent(
  name: AnalyticsEventName,
  properties?: Record<string, string | number | boolean | undefined>,
): void {
  captureBusinessEvent(name, LEGACY_EVENTS.has(name) ? { ...properties, legacy: true } : properties)
}

export function trackVideoImported(props?: {
  source?: 'upload' | 'url' | 'local'
  fileType?: string
  durationSec?: number
  sizeBytes?: number
}): void {
  trackEvent(AnalyticsEvent.VideoImported, props)
}

export function trackClipsExported(props?: {
  clipCount?: number
  durationSec?: number
  withSubtitles?: boolean
  exportType?: 'clip' | 'collection' | 'project'
}): void {
  trackEvent(AnalyticsEvent.ClipsExported, props)
}

export function trackProcessingFailed(props: {
  stage: 'import' | 'transcribe' | 'analyze' | 'clip' | 'export' | 'other'
  message?: string
  code?: string | number
}): void {
  // Never send arbitrary exception text (may contain tokens, URLs or local paths).
  trackEvent(AnalyticsEvent.ProcessingFailed, { stage: props.stage, code: props.code })
}

export function trackSponsorLinkOpened(props: {
  sponsor: SponsorId
  target: 'register' | 'guide'
  placement: 'settings_model' | 'home_setup' | 'import_card'
}): void {
  trackEvent(AnalyticsEvent.SponsorLinkOpened, props)
}
