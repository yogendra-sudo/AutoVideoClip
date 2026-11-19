import { t } from '../../i18n'
import { Btn } from '../../ui'
import { CLOUD_TRANSCRIPTION_DESTINATION, repairDestination } from './importReadiness'
import type { RecoveryState } from './transcriptionRecovery'

export interface TranscriptionGatePromptProps {
  state: RecoveryState
  busy: boolean
  /** One-click install (runtime -> model) through the shared recovery controller. */
  onInstall: () => void | Promise<void>
  /** Failed or timed out: same path as install. */
  onRetry: () => void | Promise<void>
  /** Ready: start the same import / confirmation again. */
  onContinue: () => void
  navigate: (to: string) => void
}

/** The one view of the install-recovery controller (#418 rewrite), used by the import page and the confirm page.
 * Every phase has an exit: install, wait with progress, continue, or retry / transcription settings. */
export default function TranscriptionGatePrompt({ state, busy, onInstall, onRetry, onContinue, navigate }: TranscriptionGatePromptProps) {
  const settings = () => navigate(repairDestination('settings_transcription') as string)
  // #371: a background install stays inline while it runs; #404: once it failed or timed out it is shown, with retry.
  const ended = state.phase === 'failed' || state.phase === 'timeout'
  if (state.phase === 'idle' || (state.background && !ended)) return null
  if (state.phase === 'install_required') return <div className="studio-readiness" role="alertdialog" aria-label={t('Local transcription needs to be installed first')}>
    <b>{t('Local transcription needs to be installed first')}</b>
    <span>{t('This video has no subtitles and needs the local transcription component (about 220 MB, about 15 minutes on a slow network), or switch to cloud transcription.')}</span>
    <div className="studio-actions">
      <Btn size="sm" disabled={busy} onClick={() => void onInstall()}>{t('Install now')}</Btn>
      <Btn size="sm" disabled={busy} onClick={() => navigate(CLOUD_TRANSCRIPTION_DESTINATION)}>{t('Use cloud transcription instead')}</Btn>
    </div>
  </div>
  return <div className="studio-readiness" role="alertdialog" aria-label={t('Waiting for installation to finish')}>
    <b>{t('Waiting for installation to finish')}</b>
    {state.phase === 'ready' ? <>
      <span>{t('Local transcription is ready. You can continue the import.')}</span>
      <div className="studio-actions"><Btn size="sm" disabled={busy} onClick={onContinue}>{t('Continue import')}</Btn></div>
    </> : state.phase === 'failed' || state.phase === 'timeout' ? <>
      <span className="studio-error">{t(state.phase === 'timeout' ? 'The install has made no progress for a while. Retry, or check transcription settings.'
        : state.offline ? "Can't reach the local backend right now. It will continue automatically once the backend is back, or you can retry." : 'The install or model download failed. Retry, or check transcription settings.')}</span>
      <div className="studio-actions">
        <Btn size="sm" disabled={busy} onClick={() => void onRetry()}>{t('Retry')}</Btn>
        <Btn size="sm" disabled={busy} onClick={settings}>{t('Open transcription settings')}</Btn>
      </div>
    </> : <>
      <span>{t(state.phase === 'downloading' ? 'Downloading the transcription model. You can continue once it finishes.' : 'Local Whisper is installing. Start once it finishes.')}</span>
      <span className="studio-muted">{t(state.phase === 'downloading'
        ? 'A video without subtitles has to download the local transcription component the first time (about 220 MB, about 15 minutes on a slow network).'
        : "A video without subtitles has to download the local transcription component the first time (about 220 MB, about 15 minutes on a slow network). If you don't want to wait, switch to cloud transcription.")}</span>
      {state.unreachable && <span className="studio-muted">{t("Can't reach the local backend right now, retrying…")}</span>}
      {state.percent != null && <span className="studio-muted" role="progressbar" aria-valuenow={state.percent} aria-valuemin={0} aria-valuemax={100}>{t('{{percent}}% done', { percent: state.percent })}</span>}
      <div className="studio-actions"><Btn size="sm" onClick={settings}>{t('Open transcription settings')}</Btn></div>
    </>}
  </div>
}
