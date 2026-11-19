import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Btn, Row } from '../../ui'
import LocalModelPrepare from './LocalModelPrepare'
import api from '../../services/api'

type SenseVoiceStatus = { status: 'not_installed' | 'installing' | 'ready' | 'error'; message: string }

/**
 * First enable reuses the Whisper prepare row (download + progress).
 */
export default function SenseVoiceConfig() {
  const [runtime, setRuntime] = useState<SenseVoiceStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const value = await api.get<unknown, SenseVoiceStatus>('/sensevoice/status')
        if (active) { setRuntime(value); setError('') }
      } catch { if (active) setError(t('Local model status is temporarily unavailable.')) }
    }
    void refresh()
    const preparing = runtime?.status === 'installing'
    const timer = window.setInterval(() => void refresh(), preparing ? 2000 : 15000)
    return () => { active = false; window.clearInterval(timer) }
  }, [runtime?.status])
  const act = async (remove = false) => {
    setBusy(true)
    try {
      const value = remove ? await api.delete<unknown, SenseVoiceStatus>('/sensevoice')
        : await api.post<unknown, SenseVoiceStatus>('/sensevoice/prepare')
      setRuntime(value); setError('')
    } catch { setError(t('Operation failed. Please try again later.')) }
    finally { setBusy(false) }
  }
  const preparing = runtime?.status === 'installing' || busy
  return <div className="ac-rows">
    <Row label={t('Transcription model')} hint={t('Supports Mandarin, Cantonese, English, Japanese and Korean, with word timestamps for subtitles.')}><span>SenseVoiceSmall</span></Row>
    <LocalModelPrepare
      ready={runtime?.status === 'ready'}
      preparing={preparing && runtime?.status !== 'ready'}
      busy
      hint={runtime?.status === 'error' ? t('Model preparation failed. Check your network and disk space, then retry.') : t('Internet access is required for the initial component and model download. Reserve at least 8 GB of disk space. Once ready, transcription does not upload audio.')}
      busyHint={t('Preparing components and model…')}
      error={error}
      disabled={!runtime || busy}
      onPrepare={() => void act()} />
    <p className="ac-note">{t('Installs only the required models; speaker diarization is disabled.')} <a href="https://huggingface.co/FunAudioLLM/SenseVoiceSmall" target="_blank" rel="noreferrer">{t('Model and license details')}</a></p>
    {runtime?.status === 'ready' && <details className="ac-disclosure"><summary>{t('Advanced')}</summary>
      <Row label={t('Delete SenseVoice components and models')} hint={t('Download again to use it after deletion.')}>
        <Btn variant="danger" size="sm" disabled={busy} onClick={() => void act(true)}>{t('Delete')}</Btn>
      </Row>
    </details>}
  </div>
}
