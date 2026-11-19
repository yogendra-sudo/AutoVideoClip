import { USER_CAUSE_ERROR_CODES, USER_CAUSE_UPSTREAM_TYPES, USER_MESSAGES } from '../analytics/failureCodes'

/** None availableModel：Used by the front endOn「Settings → Service Provider andModel」，andReplace with a sentence that includes an explanation of the self-provided key。 */
export const LLM_NOT_CONFIGURED = 'llm_not_configured'
export const LLM_AUTH_INVALID = 'llm_auth_invalid'

/** the lock-timeout notice is an i18n key in all 8 locales (backend file_lock.LOCK_TIMEOUT_MESSAGE).*/
export const STORE_LOCK_TIMEOUT = 'store_lock_timeout'
export const STORE_LOCK_TIMEOUT_TEXT = 'Project data on this computer is in use by another AutoClip process. Please try again shortly; your source media is kept.'

/** The one user-cause reason table studio 「Open settings」 reads. Project cards pass upstream when they have it. */
export const USER_CAUSE_REASONS: Record<string, string> = Object.fromEntries(
  [...new Set([...USER_CAUSE_ERROR_CODES, ...USER_CAUSE_UPSTREAM_TYPES])].map(code => [code, USER_MESSAGES[code]]),
)

export function llmFailureText(error?: string | null, code?: string | null, upstream?: string | null): string {
  if (code === STORE_LOCK_TIMEOUT) return STORE_LOCK_TIMEOUT_TEXT
  // 88API 403 quota used to be stored as llm_auth_invalid. The fine type, or a
  // sentence that already says Top up, must not be rewritten into 「Invalid key」.
  if (upstream === 'insufficient_quota' || (error || '').trim() === USER_MESSAGES.insufficient_quota) {
    return USER_MESSAGES.insufficient_quota
  }
  if (code === LLM_AUTH_INVALID) return USER_CAUSE_REASONS[LLM_AUTH_INVALID]
  if (code === LLM_NOT_CONFIGURED) return USER_MESSAGES[code]
  const generic = !error || /^(?:error|failed|processing failed)$/i.test(error.trim())
    || error === USER_MESSAGES.provider_error || error === USER_MESSAGES.unexpected || error === USER_MESSAGES.unknown
  if (generic && upstream && upstream !== 'unknown' && USER_MESSAGES[upstream]) return USER_MESSAGES[upstream]
  if (upstream && USER_MESSAGES[upstream] && error === USER_MESSAGES[upstream]) return error
  if (generic && code && USER_MESSAGES[code]) return USER_MESSAGES[code]
  if (code && USER_MESSAGES[code] && /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(error || '')) return USER_MESSAGES[code]
  // Site/source refusal codes always show their standard user-facing sentence, even when the
  // backend hint text is already in English (it may be a placeholder rather than the canonical copy).
  if (code && (code === 'source_blocked' || code === 'file_locked' || code === 'source_not_found' || code === 'source_too_short' || code === 'source_no_audio' || code === 'source_unreadable' || code === 'source_unsupported') && USER_MESSAGES[code]) return USER_MESSAGES[code]
  return error || ''
}

/**
 * Have error_code Use it as the standard at the time。1.3.2 Only leave「None available LLM Provider…Missing API Key」，
 * That kind of old copy should also be clickable.Settings。ReviewpointsThreshold、SubtitlesFailed、Timeline is emptyOffIncluded。
 */
export function classifyLlmKeyFailure(error?: string | null, code?: string | null): boolean {
  if (code === LLM_NOT_CONFIGURED) return true
  if (code === 'timeline_empty' || code === LLM_AUTH_INVALID) return false
  const text = error || ''
  if (!text) return false
  if (/no AI model is configured|missing API key|not configured.*API key/i.test(text)) return true
  if (text.includes('Timeline extraction is empty') || text.includes('Timeline is empty')) return false
  if (text.includes('Lowest Ratingpoints')) return false
  if (
    text.includes('None available LLM')
    || text.includes('Missing API Key')
    || text.includes('Not set upLLM')
    || text.includes('Not set up API Key')
    || text.includes('To be provided by the user API Key')
    || text.includes('Own key')
  ) {
    return true
  }
  const mentionsKey = /API Key|API key|Key/.test(text)
  return mentionsKey && (
    text.includes('Connection testFailed')
    || text.includes('APIConnection testFailed')
    || /connection test failed/i.test(text)
  )
}
