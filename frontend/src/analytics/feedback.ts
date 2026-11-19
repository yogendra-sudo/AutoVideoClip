/**
 * ApplicationInsideFeedback（PostHog Surveys）。
 *
 * Target：Users don't have to leaveApplication、No registration required GitHub，Can"What's wrong? / What do you want?"Post it，
 * andAutoInclude the context needed for troubleshooting（Version / System / Architecture / LLM provider & Model / FailedStageclipsWith errors）。
 *
 * Key points for implementation：
 * - FeedbackWith `feedback_submitted` Event Entry PostHog（Regardless of whether or notConfiguration Survey All will be sent）。
 * - If PostHog ProjectStorageGet it from theNamed FEEDBACK_SURVEY_NAME（Or env Designate id）of Survey（API Type / None UI），
 *   Press simultaneously PostHog Agreed-upon delivery `survey shown` / `survey sent` / `survey dismissed`，
 *   This is the result that will appear.Get it from the PostHog → Surveys In the response panel，Weekly reports can also be read directly。
 * - Version / System / Architecture By lifecycle.ts Registered super properties AutoCarry；Explicitly written here as an addition，
 *   Avoid Surveys Panel view only `$survey_response*` Lose context when。
 * - Point「Send」Do not view the anonymous statistics switch。Event Entry PostHog After，Write receiving task GitHub。
 *   Faulty opening Issue，Start with an idea Ideas，OtherOpen Q&A。Email not receivedPublicPost。
 * - NoneConfigurationor networkFailedTime，OnPre-filled GitHub Page，To be submitted again by the user。
 */
import { posthog, isAnalyticsEnabled, POSTHOG_HOST, POSTHOG_KEY } from './posthog'
import { settingsApi } from '../services/api'
import { modelSettingsApi } from '../features/settings/modelSettingsApi'
import { getRuntimeInfo } from './lifecycle'
import {
  buildFeedbackDraft,
  captureProperties,
  githubFallbackUrl,
  newFeedbackId,
  type FeedbackCategory,
  type FeedbackDraft,
} from './feedbackDraft'

export const FEEDBACK_SURVEY_NAME = 'AutoClip ApplicationInsideFeedback'
export const FEEDBACK_ISSUES_URL = 'https://github.com/zhouxiaoka/autoclip/issues/new/choose'
export const FEEDBACK_DISCUSSIONS_URL = 'https://github.com/zhouxiaoka/autoclip/discussions'

const SURVEY_ID_ENV = import.meta.env.VITE_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID as string | undefined

export type { FeedbackCategory }
export type FeedbackSource = 'settings' | 'failure' | 'detail'

export interface FeedbackContext {
  source: FeedbackSource
  /** FailedStatus carried */
  stage?: string
  error_message?: string
  error_code?: string
  /** 1.5.9 2C: whitelist enum only when error_code=unexpected */
  unexpected_type?: string
  project_id?: string
  /** SettingsPage / FailedThe status will be completed as much as possible */
  llm_provider?: string
  llm_model?: string
  llm_base_url?: string
  transcription_provider?: string
  transcription_model?: string
}

interface SurveyLike {
  id: string
  name: string
  type?: string
  questions?: Array<{ id?: string; type?: string; question?: string }>
}

let cachedSurvey: SurveyLike | null | undefined

/** Find for receivingFeedbackof Survey；Not foundBack null（No impact feedback_submitted Report）。 */
export function resolveFeedbackSurvey(): Promise<SurveyLike | null> {
  if (cachedSurvey !== undefined) return Promise.resolve(cachedSurvey)
  return new Promise((resolve) => {
    if (typeof posthog?.getSurveys !== 'function' || !isAnalyticsEnabled()) {
      cachedSurvey = null
      return resolve(null)
    }
    try {
      posthog.getSurveys((surveys: unknown) => {
        const list = (Array.isArray(surveys) ? surveys : []) as SurveyLike[]
        const found =
          list.find((s) => SURVEY_ID_ENV && s.id === SURVEY_ID_ENV) ||
          list.find((s) => s.name === FEEDBACK_SURVEY_NAME) ||
          null
        cachedSurvey = found
        resolve(found)
      }, false)
    } catch {
      cachedSurvey = null
      resolve(null)
    }
  })
}

/** Read current LLM provider / Model，Fill inFeedbackContext；Silently ignore when the backend is unreachable。 */
export async function collectLlmContext(): Promise<Pick<FeedbackContext, 'llm_provider' | 'llm_model' | 'llm_base_url' | 'transcription_provider' | 'transcription_model'>> {
  const [provider, models] = await Promise.allSettled([settingsApi.getCurrentProvider(), modelSettingsApi.get()])
  const p = provider.status === 'fulfilled' ? provider.value : null
  const transcription = models.status === 'fulfilled' ? models.value.transcription : null
  return {
      llm_provider: p?.provider,
      llm_model: p?.model,
      llm_base_url: p?.base_url || undefined,
      transcription_provider: transcription?.provider,
      transcription_model: transcription?.model,
  }
}

export function trackFeedbackOpened(ctx: FeedbackContext, survey: SurveyLike | null): void {
  if (typeof posthog?.capture !== 'function') return
  posthog.capture('feedback_opened', { source: ctx.source, stage: ctx.stage })
  if (survey) posthog.capture('survey shown', { $survey_id: survey.id, $survey_name: survey.name })
}

export function trackFeedbackDismissed(ctx: FeedbackContext, survey: SurveyLike | null): void {
  if (typeof posthog?.capture !== 'function') return
  posthog.capture('feedback_dismissed', { source: ctx.source })
  if (survey) posthog.capture('survey dismissed', { $survey_id: survey.id, $survey_name: survey.name })
}

export interface FeedbackPayload {
  category: FeedbackCategory
  text: string
  contact?: string
  context: FeedbackContext
}

export interface FeedbackDelivery {
  ok: boolean
  fallbackUrl: string
}

function feedbackDistinctId(draft: FeedbackDraft): string {
  if (isAnalyticsEnabled()) {
    try {
      const current = posthog.get_distinct_id?.()
      if (current) return current
    } catch { /* ExplicitFeedbackStill to be sent */ }
  }
  return `feedback:${draft.feedbackId}`
}

/**
 * ProactiveSendDo not view the anonymous statistics switch。SuccessWhen the event enters PostHog，Subsequently written by the receiving task GitHub。
 * NoneConfigurationor networkFailedTime，BackPre-filled GitHub Link，By callerOn。
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackDelivery> {
  const runtime = getRuntimeInfo()
  const draft = buildFeedbackDraft({
    feedbackId: newFeedbackId(),
    category: payload.category,
    text: payload.text,
    contact: payload.contact,
    source: payload.context.source,
    stage: payload.context.stage,
    errorMessage: payload.context.error_message,
    errorCode: payload.context.error_code,
    unexpectedType: payload.context.unexpected_type,
    version: runtime.version,
    os: runtime.os,
    arch: runtime.arch,
    llmProvider: payload.context.llm_provider,
    llmModel: payload.context.llm_model,
    transcriptionProvider: payload.context.transcription_provider,
    transcriptionModel: payload.context.transcription_model,
  })
  const fallbackUrl = githubFallbackUrl(draft)
  if (!POSTHOG_KEY) return { ok: false, fallbackUrl }
  try {
    const response = await fetch(`${POSTHOG_HOST.replace(/\/$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: 'feedback_submitted',
        distinct_id: feedbackDistinctId(draft),
        timestamp: new Date().toISOString(),
        properties: {
          ...captureProperties(draft),
          analytics_environment: import.meta.env.VITE_TELEMETRY_VALIDATION === 'true'
            ? 'validation'
            : import.meta.env.DEV ? 'development' : 'production',
          runtime: '__TAURI_INTERNALS__' in window ? 'desktop' : 'web',
        },
      }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    })
    return { ok: response.ok, fallbackUrl }
  } catch {
    return { ok: false, fallbackUrl }
  }
}
