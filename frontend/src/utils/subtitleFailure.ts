/** Classifies subtitle failures to choose the right transcription settings action and message. */
export type SubtitleFailureKind =
  | 'whisper_not_installed'
  | 'whisper_install_failed'
  | 'transcription_empty'
  | 'subtitle_setup'
  | 'subtitle_unknown'

const CODES = new Set<SubtitleFailureKind>([
  'whisper_not_installed',
  'whisper_install_failed',
  'transcription_empty',
  'subtitle_setup',
  'subtitle_unknown',
])

function mentionsSubtitle(text: string): boolean {
  return /subtitle|transcription|whisper/i.test(text)
}

/**
 * Prefer error codes. Older versions only stored a generic no-captions message, so those failures
 * remain subtitle_unknown and the details page can check the current Whisper status.
 */
export function classifySubtitleFailure(error?: string | null, code?: string | null): SubtitleFailureKind | null {
  if (code && CODES.has(code as SubtitleFailureKind)) return code as SubtitleFailureKind
  // Source-duration and audio-track problems cannot be fixed by changing transcription settings.
  if (code === 'source_too_short' || code === 'source_no_audio' || code === 'source_unreadable') return null
  const text = error || ''
  // An empty timeline may mention subtitles, but it does not imply a Whisper setup problem.
  if (code === 'timeline_empty' || text.includes('Timeline extraction is empty') || text.includes('Timeline is empty')) return null
  if (!text || !mentionsSubtitle(text)) return null
  if (/installation failed|failed to install|install failed/i.test(text)) return 'whisper_install_failed'
  if (/not installed|runtime is not installed|speech recognition is unavailable/i.test(text)) {
    return 'whisper_not_installed'
  }
  if (
    /no subtitles were generated|no speech was recognized|no speech detected/i.test(text)
  ) {
    return 'transcription_empty'
  }
  if (/local transcription produced no results/i.test(text)) return 'subtitle_unknown'
  // Cloud transcription uses the same settings path, but it is not a local Whisper install.
  if (/cloud transcription/i.test(text)) return null
  if (text.includes('No captions to analyze') || text.includes('Settings → Speech recognition') || text.includes('Settings → Transcription') || text.includes('Settings → Default models → Speech to subtitles')) {
    return 'subtitle_setup'
  }
  if (/subtitle file does not exist on this system/i.test(text)) return 'subtitle_unknown'
  return null
}
