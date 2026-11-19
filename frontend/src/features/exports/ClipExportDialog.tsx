import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { useEffect, useState } from 'react'
import { projectApi } from '../../services/api'
import { Btn, Dialog, ProgressLine, Row, Segmented } from '../../ui'
import { useClipExport } from './useClipExport'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  clipId: string
}

export function ClipExportDialog({ open, onClose, projectId, clipId }: Props) {
  useTranslation()
  const [preset, setPreset] = useState<'douyin' | 'xiaohongshu' | 'shorts' | 'bilibili' | 'original' | '1080p60'>('douyin')
  const [burnSub, setBurnSub] = useState(true)
  const [titleCard, setTitleCard] = useState(true)
  const { exporting, percent, error, result, start, reset } = useClipExport(projectId, clipId)

  useEffect(() => { if (open) reset() }, [open, reset])

  return (
    <Dialog
      open={open}
      onClose={() => !exporting && onClose()}
      title={t("Export video")}
      description={t("Render a video ready to upload. Existing pipeline clips stay unchanged.")}
      footer={
        <div className="right" style={{ marginLeft: 'auto' }}>
          <Btn size="sm" onClick={onClose} disabled={exporting}>{t("Cancel")}</Btn>
          {result ? (
            <Btn size="sm" variant="cta" onClick={() => projectApi.downloadExport(projectId, result.jobId)}>
              {t("Download video")}
            </Btn>
          ) : (
            <Btn size="sm" variant="cta" loading={exporting} onClick={() => void start({ preset, subtitles: burnSub, title_card: titleCard })}>{t("Start export")}</Btn>
          )}
        </div>
      }
    >
      <Row label={t("Platform")} hint={t("Aspect ratio and duration follow platform requirements")}>
        <Segmented
          size="sm"
          ariaLabel={t("Export preset")}
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'douyin', label: t("Douyin") },
            { value: 'xiaohongshu', label: t("Xiaohongshu") },
            { value: 'shorts', label: 'Shorts' },
            { value: 'bilibili', label: t("Bilibili") },
            { value: 'original', label: t("Original") },
            { value: '1080p60', label: '1080p60' },
          ]}
        />
      </Row>
      <Row label={t("Subtitles")} hint={t("Burn the segment’s original subtitles into the video")}>
        <Segmented size="sm" value={burnSub ? 'on' : 'off'} onChange={(v) => setBurnSub(v === 'on')}
          options={[{ value: 'on', label: t("Burn in") }, { value: 'off', label: t("Off") }]} />
      </Row>
      <Row label={t("Title card")} hint={t("Show the clip title for about 4 seconds at the start")}>
        <Segmented size="sm" value={titleCard ? 'on' : 'off'} onChange={(v) => setTitleCard(v === 'on')}
          options={[{ value: 'on', label: t("Show") }, { value: 'off', label: t("Off") }]} />
      </Row>
      {exporting && <div style={{ marginTop: 16 }}><ProgressLine percent={percent} /></div>}
      {error && <p style={{ marginTop: 12, color: 'var(--ac-error)', fontSize: 13 }}>{error}</p>}
      {result && (
        <p style={{ marginTop: 12, color: 'var(--ac-sub)', fontSize: 13 }}>
          {t("Completed")}{result.warnings?.length ? ` · ${result.warnings.join('；')}` : ''}
        </p>
      )}
    </Dialog>
  )
}
