import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Btn, ProgressLine, Row, StatusDot } from '../../ui'

/**
 * Shared first-enable row for local ASR (Whisper + SenseVoice):
 * prepare button, thin progress, then a ready dot. No separate wizard.
 */
export default function LocalModelPrepare({
  ready,
  preparing,
  progress,
  busy,
  hint,
  busyHint,
  error,
  onPrepare,
  disabled,
}: {
  ready: boolean
  preparing: boolean
  progress?: number
  busy?: boolean
  hint: ReactNode
  busyHint: string
  error?: string
  onPrepare: () => void
  disabled?: boolean
}) {
  return <>
    <Row label={ready ? t('Model ready') : t('Prepare local model')} hint={ready ? t('New tasks will use this model after you save.') : hint}>
      {ready ? <StatusDot tone="ok" label={t('Ready')} />
        : preparing ? <div style={{ width: 220 }}>
          <ProgressLine percent={progress ?? 0} busy={busy} />
          <span className="ac-hint">{busyHint}</span>
        </div>
        : <Btn size="sm" disabled={disabled} onClick={onPrepare}>{t('Prepare model')}</Btn>}
    </Row>
    {!!error && <p className="ac-note" role="alert">{error}</p>}
  </>
}
