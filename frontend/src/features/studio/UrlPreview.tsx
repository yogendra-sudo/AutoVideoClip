import { t } from '../../i18n'
import { Btn } from '../../ui'
import { estimate } from './etaModel'
import {
  transcriptionEtaMinutes,
  type PreviewRouteKind,
} from './importReadiness'
import { VISUAL_SOURCE_TOO_LONG_MESSAGE } from './planningCopy'
import { FIRST_WINDOW_END_SEC } from './types'

export type UrlInspectPreview = {
  title?: string | null
  duration?: number | null
  thumbnail?: string | null
  has_manual_subtitle?: boolean
  has_audio?: boolean | null
  preview_route: PreviewRouteKind
  recommended_analysis?: 'subtitle' | 'visual'
  warn_visual_too_long?: boolean
  language?: string | null
  max_height?: number | null
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !(sec > 0)) return '—'
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function routeCopy(preview: UrlInspectPreview): string {
  const route = preview.preview_route
  if (route === 'platform_subtitle') return t('Platform captions available; no local transcription needed')
  if (route === 'visual') return t('No audio track; visual-only (needs a vision model)')
  const n = transcriptionEtaMinutes(preview.duration)
  return n != null
    ? t('No captions; local transcription ~{{minutes}} min', { minutes: n })
    : t('No captions; local transcription needed')
}

/** Total preview ETA minutes. local_transcription includes ASR + generation. */
export function totalPreviewEtaMinutes(
  durationSec: number | null | undefined,
  route: PreviewRouteKind,
): number | null {
  if (durationSec == null || !(durationSec > 0)) return null
  const gen = estimate('dashscope', durationSec / 60, 1, 0).etaMin
  if (route !== 'local_transcription') return gen ?? null
  const asr = transcriptionEtaMinutes(durationSec)
  if (asr == null && gen == null) return null
  // Never show a total shorter than the transcription line when ASR ETA is known.
  if (asr == null) return gen
  if (gen == null) return asr
  return asr + gen
}

function totalEtaLine(durationSec: number | null | undefined, route: PreviewRouteKind): string | null {
  const minutes = totalPreviewEtaMinutes(durationSec, route)
  if (minutes == null) return null
  return t('Estimated total ~{{minutes}} min', { minutes })
}

/** T2: gate the first-30-min tip on no success history and source longer than 30 min. */
export function shouldSuggestFirstWindow(
  hasSuccessHistory: boolean,
  durationSec: number | null | undefined,
  endSec: number = FIRST_WINDOW_END_SEC,
): boolean {
  if (hasSuccessHistory) return false
  return typeof durationSec === 'number' && durationSec > endSec
}

export default function UrlPreview({
  preview,
  loading,
  needsTranscriptionInstall,
  installing,
  onInstallTranscription,
  onConfirm,
  onConfirmFirstWindow,
  onConfirmFull,
  onDismiss,
  confirmLabel,
  suggestFirstWindow,
}: {
  preview: UrlInspectPreview | null
  loading?: boolean
  needsTranscriptionInstall?: boolean
  installing?: boolean
  onInstallTranscription?: () => void
  onConfirm?: () => void
  onConfirmFirstWindow?: () => void
  onConfirmFull?: () => void
  onDismiss?: () => void
  confirmLabel?: string
  suggestFirstWindow?: boolean
}) {
  if (loading) {
    return <div className="studio-url-preview" data-testid="url-preview-loading" role="status">
      <p className="studio-muted">{t('Reading video info…')}</p>
    </div>
  }
  if (!preview) return null
  const eta = totalEtaLine(preview.duration ?? null, preview.preview_route)
  const showFirstWindow = Boolean(suggestFirstWindow && onConfirmFirstWindow && onConfirmFull)
  return (
    <div className="studio-url-preview" data-testid="url-preview" role="region" aria-label={t('Video preview')}>
      <div className="studio-url-preview-main">
        {preview.thumbnail ? (
          <img className="studio-url-preview-thumb" src={preview.thumbnail} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="studio-url-preview-thumb is-empty" aria-hidden />
        )}
        <div className="studio-url-preview-meta">
          <b className="studio-url-preview-title">{preview.title || t('Untitled video')}</b>
          <p className="studio-muted">{t('Duration')} {fmtDuration(preview.duration ?? null)}</p>
          <p className="studio-url-preview-route">{routeCopy(preview)}</p>
          {eta && <p className="studio-muted">{eta}</p>}
          {preview.warn_visual_too_long && (
            <p className="studio-url-preview-warn" role="note">{t(VISUAL_SOURCE_TOO_LONG_MESSAGE)}</p>
          )}
        </div>
      </div>
      {showFirstWindow && (
        <div className="studio-first-window" role="status" data-testid="t2-first-window-prompt">
          <p className="studio-muted">{t('For the first run, try up to 30 minutes to confirm the model setup')}</p>
        </div>
      )}
      <div className="studio-actions studio-url-preview-actions">
        {needsTranscriptionInstall && (
          <Btn size="sm" variant="cta" loading={installing} disabled={installing} onClick={onInstallTranscription}>
            {t('Install transcription')}
          </Btn>
        )}
        {showFirstWindow ? (
          <>
            <Btn size="sm" variant={needsTranscriptionInstall ? 'default' : 'cta'} disabled={needsTranscriptionInstall} onClick={onConfirmFirstWindow} data-testid="t2-window-partial">
              {t('Only first 30 minutes')}
            </Btn>
            <Btn size="sm" variant="default" disabled={needsTranscriptionInstall} onClick={onConfirmFull} data-testid="t2-window-full">
              {t('Process full video')}
            </Btn>
          </>
        ) : onConfirm ? (
          <Btn size="sm" variant={needsTranscriptionInstall ? 'default' : 'cta'} disabled={needsTranscriptionInstall} onClick={onConfirm}>
            {confirmLabel || t('Confirm and start download')}
          </Btn>
        ) : null}
        {onDismiss && (
          <Btn size="sm" variant="text" onClick={onDismiss}>{t('Try another link')}</Btn>
        )}
      </div>
    </div>
  )
}
