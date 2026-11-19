/** Timeline is empty，andModelConnectionAlreadySuccess。OffOn「Settings → Service Provider andModel」Or「Settings → Default models → Speech to subtitles」。 */
export const TIMELINE_EMPTY = 'timeline_empty'

/**
 * Have error_code Use it as the standard at the time。CLI / ProgressclipsSometimes only leave last_error Body，
 * That kind of「Timeline extraction is empty…」Also needs to be recognized，Avoid being treated as missing a key or not having oneSubtitles。
 */
export function classifyTimelineEmpty(error?: string | null, code?: string | null): boolean {
  if (code === TIMELINE_EMPTY) return true
  const text = error || ''
  if (!text) return false
  return text.includes('Timeline extraction is empty') || text.includes('Timeline is empty')
}

/** User-facing sentence. Same text as backend WEAK_LOCAL_TIMELINE_REASON. */
export const WEAK_LOCAL_TIMELINE_REASON = 'The current local model could not return a usable timeline.'
/** Stored on failures from before the short sentence. Still this failure, never shown raw. */
const LEGACY_WEAK_MARKER = 'often cannot produce a structured timeline'

/** Terminal empty-interval copy, only after the backend has named a weak local model. */
export function weakLocalTimelineFailure(error?: string | null, code?: string | null): boolean {
  if (code && code !== 'invalid_response') return false
  const text = error || ''
  if (text.includes(WEAK_LOCAL_TIMELINE_REASON)) return true
  return /no valid time interval/i.test(text) && text.toLowerCase().includes(LEGACY_WEAK_MARKER)
}
