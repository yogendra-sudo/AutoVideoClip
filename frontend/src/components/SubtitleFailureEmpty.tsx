import { t } from '../i18n'
import React from 'react'
import { Btn } from '../ui'
import { SubtitleFailureKind } from '../utils/subtitleFailure'

function copyFor(kind: SubtitleFailureKind): { title: string; body: string } {
  switch (kind) {
    case 'whisper_not_installed':
      return {
        title: t("Local transcription isn’t installed"),
        body: t("This video has no captions. Install Whisper and download a model in Settings → Default models → Speech to subtitles, or import it again with an .srt file."),
      }
    case 'whisper_install_failed':
      return {
        title: t("Whisper didn’t finish installing"),
        body: t("This video has no captions, and the last Whisper install didn’t succeed. Retry the install in Settings → Default models → Speech to subtitles, or import it again with an .srt file."),
      }
    case 'transcription_empty':
      return {
        title: t("Transcription produced no captions"),
        body: t("Whisper is installed, but this video produced no usable speech. Check that it has clear speech and retry, or import it again with an .srt file."),
      }
    case 'subtitle_unknown':
      return {
        title: t("No captions to analyze"),
        body: t("This video has no captions, and local transcription produced nothing. Install or retry Whisper in Settings → Default models → Speech to subtitles, or import it again with an .srt file."),
      }
    default:
      return {
        title: t("Processing was unsuccessful"),
        body: t("In Settings → Default models → Speech to subtitles, check that Whisper is installed and a model is downloaded, or import it again with an .srt file."),
      }
  }
}

/** FailedEmpty state：One-sentence reason、One thing you can do、On「Settings → Default models → Speech to subtitles」Main button。 */
const SubtitleFailureEmpty: React.FC<{
  kind: SubtitleFailureKind
  errorMessage?: string
  onOpenSettings: () => void
}> = ({ kind, errorMessage, onOpenSettings }) => {
  const copy = copyFor(kind)
  return (
    <div className="ac-empty" style={{ marginTop: 32 }}>
      <b>{copy.title}</b>
      <span style={{ display: 'block', maxWidth: 520, margin: '6px auto 0', lineHeight: 1.5 }}>{copy.body}</span>
      {errorMessage && (
        <span className="ac-mono" style={{ display: 'block', marginTop: 10, color: 'var(--ac-muted)', wordBreak: 'break-word' }}>
          {errorMessage}
        </span>
      )}
      <div style={{ marginTop: 16 }}>
        <Btn variant="cta" size="sm" onClick={onOpenSettings}>{t(kind === 'whisper_not_installed' || kind === 'whisper_install_failed' ? 'Install transcription' : 'Open transcription settings')}</Btn>
      </div>
    </div>
  )
}

export default SubtitleFailureEmpty
