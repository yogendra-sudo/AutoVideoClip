import { t } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { Btn } from '../../ui'
import {
  readinessLineItems,
  repairDestination,
  type ImportReadiness,
  type ReadinessLineItem,
  type RepairAction,
} from './importReadiness'

function markGlyph(mark: ReadinessLineItem['mark']): string {
  if (mark === 'ok') return '✓'
  if (mark === 'fail') return '✗'
  if (mark === 'warn') return '⚠'
  return '—'
}

function fixLabel(repair: RepairAction, key: ReadinessLineItem['key']): string {
  if (repair === 'install_whisper') return t('Fix now')
  if (repair === 'settings_ai') return t('Open settings')
  if (repair === 'settings_transcription') return t('Open settings')
  if (repair === 'settings_vision') return t('Open settings')
  if (key === 'ffmpeg') return t('Open settings')
  return t('Open settings')
}

/**
 * F5: always-on import readiness line.
 * 「Model ✓ deepseek-chat · Transcription ✓ Local small · Screen — Not enabled · FFmpeg ✓」
 * Each item is clickable → repairDestination; ✗ items also offer one-click fix.
 */
export default function ReadinessLine({
  report,
  busy,
  repairing,
  onFix,
}: {
  report: ImportReadiness | null
  busy?: boolean
  repairing?: boolean
  onFix: (item: ReadinessLineItem) => void
}) {
  useTranslation()
  const items = readinessLineItems(report)
  return (
    <div className="studio-readiness-line" role="status" data-testid="readiness-line" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 2px',
      marginTop: 12, fontSize: 13, color: 'var(--ac-sub, #6b7280)', lineHeight: 1.6,
    }}>
      {items.map((item, index) => {
        const destination = repairDestination(item.repair)
        const clickable = item.repair !== 'none' && (destination || item.repair === 'install_whisper')
        const color = item.mark === 'fail' ? 'var(--ac-danger, #b91c1c)'
          : item.mark === 'warn' ? '#a16207'
          : item.mark === 'ok' ? 'var(--ac-ok, #15803d)'
          : 'var(--ac-sub, #6b7280)'
        return (
          <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {index > 0 && <span aria-hidden style={{ margin: '0 4px', color: 'var(--ac-muted, #a8a29e)' }}>·</span>}
            <button
              type="button"
              className="studio-readiness-line-item"
              data-testid={`readiness-line-${item.key}`}
              data-mark={item.mark}
              disabled={!clickable || busy}
              onClick={() => { if (clickable) onFix(item) }}
              style={{
                appearance: 'none', border: 'none', background: 'transparent', padding: 0,
                cursor: clickable ? 'pointer' : 'default',
                color, font: 'inherit', textAlign: 'left',
                textDecoration: clickable ? 'underline dotted' : 'none',
                textUnderlineOffset: 3,
              }}
              title={clickable ? t('Open settings') : undefined}
            >
              <span>{t(item.title)}</span>
              {' '}
              <span aria-hidden>{markGlyph(item.mark)}</span>
              {item.detail ? <>{' '}{item.detail.startsWith('Local') || item.detail === 'Not enabled' || item.detail === 'FFmpeg' || item.detail === 'Transcription' || item.detail === '…'
                ? t(item.detail)
                : item.detail}</> : null}
              {item.badge ? <>{' '}{t(item.badge)}</> : null}
            </button>
            {item.needsFix && (
              <Btn
                size="sm"
                disabled={busy || repairing}
                loading={repairing && item.repair === 'install_whisper'}
                onClick={() => onFix(item)}
              >
                {fixLabel(item.repair, item.key)}
              </Btn>
            )}
          </span>
        )
      })}
    </div>
  )
}
