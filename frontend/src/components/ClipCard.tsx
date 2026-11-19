import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, message } from 'antd'
import { Clip } from '../store/useProjectStore'
import EditableTitle from './EditableTitle'
import ClipVideo from './ClipVideo'
import { ClipExportDialog } from '../features/exports/ClipExportDialog'
import { Btn, Icon, parseTimecode, fmtDuration, fmtClock } from '../ui'

interface ClipCardProps {
  onEdit?: () => void
  clip: Clip
  videoUrl?: string
  onDownload: (clipId: string) => void
  projectId?: string
  onClipUpdate?: (clipId: string, updates: Partial<Clip>) => void
}

// Calm Premium clip card — see DESIGN.md → App Layer / Media card
const ClipCard: React.FC<ClipCardProps> = ({ clip, videoUrl, onDownload, projectId, onClipUpdate, onEdit }) => {
  useTranslation()
  const navigate = useNavigate()
  const [showPlayer, setShowPlayer] = useState(false)
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)

  const openPublish = () => {
    if (!projectId) return
    setShowPlayer(false)
    navigate(`/project/${projectId}/publish/${clip.id}`)
  }

  // CoverMake an appointment 1 secondsOne frame at。Pre-set currentTime Set again src Will not take effect，The first frame is often black.。
  useEffect(() => {
    if (!videoUrl) return
    let cancelled = false
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    const draw = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      setVideoThumbnail(canvas.toDataURL('image/jpeg', 0.8))
    }
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = duration > 0 ? Math.min(1, duration / 2) : 0
      if (target > 0 && video.currentTime < 0.05) {
        video.currentTime = target
        return
      }
      draw()
    }
    video.onseeked = draw
    video.src = videoUrl
    return () => {
      cancelled = true
      video.removeAttribute('src')
      video.load()
    }
  }, [videoUrl])

  const handleDownload = async () => {
    try {
      await onDownload(clip.id)
    } catch (err) {
      console.error('Download failed:', err)
      message.error(t("Download failed"))
    }
  }

  const durationSec = Math.max(0, parseTimecode(clip.end_time) - parseTimecode(clip.start_time))

  // PriorityShowRecommendedReason；Otherwise, take the key points of the content；Finally, revert to the outline
  const getDisplayContent = () => {
    if (clip.recommend_reason && clip.recommend_reason.trim()) return clip.recommend_reason
    if (clip.content && Array.isArray(clip.content) && clip.content.length > 0) {
      const points = clip.content.filter((item) => {
        const text = item.trim()
        if (text.length > 100) return false
        if (text.split(/[，。！？；：""''（）【】]/).length > 3) return false
        return true
      })
      if (points.length > 0) return points.join(' ')
    }
    if (clip.outline && clip.outline.trim()) return clip.outline
    return ''
  }

  const title = clip.title || clip.generated_title || t("Untitled clip")
  // Backend evaluationpointsHistorically, there have been 0–1 / 0–10 Two scales，UnifiedShowis 0–100 Integer of
  const raw = clip.final_score ?? 0
  const score = Math.round(raw <= 1 ? raw * 100 : raw <= 10 ? raw * 10 : raw)

  return (
    <>
      <article className="ac-card">
        <div
          className="ac-card-thumb"
          style={videoThumbnail ? { backgroundImage: `url(${videoThumbnail})` } : undefined}
          onClick={onEdit || (() => setShowPlayer(true))}
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (onEdit || (() => setShowPlayer(true)))() } }}
          role="button"
          aria-label={t(onEdit ? "Preview and edit" : "Play")}
        >
          <div className="play"><span><Icon.Play size={18} /></span></div>
          <span className="ac-tag ac-tag--tr" title={t("Score")}>{score}</span>
          <span className="ac-tag ac-tag--bl">{fmtClock(clip.start_time)} – {fmtClock(clip.end_time)}</span>
        </div>

        <div className="ac-card-body">
          <div className="ac-card-title">
            <EditableTitle
              title={title}
              clipId={clip.id}
              onTitleUpdate={(t) => onClipUpdate?.(clip.id, { title: t })}
              style={{ fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit', color: 'inherit', width: '100%' }}
            />
          </div>
          <div className="ac-card-desc" title={getDisplayContent()}>{getDisplayContent()}</div>
          <div className="ac-card-foot">
            <span className="meta">{fmtDuration(durationSec)}</span>
            <div className="ac-card-actions">
              <Btn variant="text" onClick={onEdit || (() => setShowPlayer(true))}>{t(onEdit ? "Preview and edit" : "Play")}</Btn>
              <Btn variant="text" onClick={handleDownload}>{t("Download")}</Btn>
              {projectId && <Btn variant="text" onClick={openPublish}>{t("Publish")}</Btn>}
              {projectId && <Btn variant="text" onClick={() => setShowExport(true)}>{t("Export")}</Btn>}
            </div>
          </div>
        </div>
      </article>

      <Modal
        open={showPlayer}
        onCancel={() => setShowPlayer(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {projectId && <Btn size="sm" onClick={openPublish}>{t("Publish")}</Btn>}
            <Btn size="sm" variant="cta" onClick={handleDownload} style={{ height: 30, fontSize: 12.5, padding: '0 14px' }}>{t("Download")}</Btn>
          </div>
        }
        width={820}
        centered
        destroyOnClose
        closeIcon={<span style={{ color: 'var(--ac-sub)', fontSize: 16 }}>×</span>}
        title={
          <div style={{ paddingRight: 30 }}>
            <EditableTitle
              title={clip.title || clip.generated_title || t("Video preview")}
              clipId={clip.id}
              onTitleUpdate={(t) => onClipUpdate?.(clip.id, { title: t })}
              style={{ color: 'var(--ac-ink)', fontSize: 15, fontWeight: 500 }}
            />
            <div className="ac-meta" style={{ marginTop: 4 }}>
              <span className="ac-mono">{fmtClock(clip.start_time)} – {fmtClock(clip.end_time)}</span>
              <span className="dot" />
              <span className="ac-mono">{fmtDuration(durationSec)}</span>
              <span className="dot" />
              <span>{t("Score")}<span className="ac-mono">{score}</span></span>
            </div>
          </div>
        }
      >
        {videoUrl && (
          <div style={{ borderRadius: 12, overflow: 'hidden', height: 430, background: 'var(--ac-thumb)' }}>
            <ClipVideo url={videoUrl} playing={showPlayer} />
          </div>
        )}
      </Modal>

      {projectId && (
        <ClipExportDialog
          key={`${projectId}:${clip.id}`}
          open={showExport}
          onClose={() => setShowExport(false)}
          projectId={projectId}
          clipId={clip.id}
        />
      )}

    </>
  )
}

export default ClipCard
