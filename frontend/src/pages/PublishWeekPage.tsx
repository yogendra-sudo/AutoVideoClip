import i18n, { getLocale, t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectApi } from '../services/api'
import { Btn, Icon, ProgressLine, Row, StatusDot } from '../ui'
import { openExternalLink } from '../utils/externalLinks'
import { publishGuideHref } from '../publish/guide'
import {
  defaultPlatforms, planWeek, privateExtra, readApiDetail, remainingClips, renderPreset,
  type WeekClip, type WeekRecord,
} from '../publish/uploadPost'
import { uploadPostApi } from '../publish/uploadPostApi'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function shownScore(score: number | undefined): number {
  const value = score || 0
  return value <= 1 ? Math.round(value * 100) : Math.round(value)
}

function slotWhen(date: Date): string {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

const PublishWeekPage: React.FC = () => {
  useTranslation()
  const { id: projectId = '' } = useParams()
  const navigate = useNavigate()
  const runId = useRef(0)
  const [clips, setClips] = useState<WeekClip[]>([])
  const [records, setRecords] = useState<WeekRecord[]>([])
  const [configured, setConfigured] = useState(false)
  const [platforms, setPlatforms] = useState<string[]>([])
  const [user, setUser] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [cfg, recordRes, loaded] = await Promise.all([
          uploadPostApi.getConfig(),
          uploadPostApi.records(projectId),
          projectApi.getClips(projectId),
        ])
        if (cancelled) return
        setConfigured(cfg.configured)
        setRecords(recordRes.records || [])
        setClips((loaded || []).map((clip) => ({
          id: clip.id,
          title: clip.generated_title || clip.title || '',
          score: clip.final_score || 0,
        })))
        if (!cfg.configured) return
        const res = await uploadPostApi.profiles()
        if (cancelled) return
        const list = res.profiles || []
        const next = list.some((profile) => profile.username === cfg.user) ? cfg.user : (list[0]?.username || cfg.user || '')
        setUser(next)
        const connected = list.find((profile) => profile.username === next)?.connected_platforms || []
        setPlatforms(defaultPlatforms(connected))
      } catch (err) {
        if (!cancelled) setError(readApiDetail(err, t("Publish failed")))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      runId.current += 1
    }
  }, [projectId])

  const slots = useMemo(() => planWeek(clips, records, now), [clips, records, now])
  const fresh = slots.filter((slot) => slot.state === 'new' && slot.clipId)
  const nothingLeft = !remainingClips(clips, records).length

  const confirm = async () => {
    if (!fresh.length || running) return
    if (!platforms.length) {
      setError(t("Select at least one platform"))
      return
    }
    if (!user) {
      setError(t("No profile yet. Create one in Upload-Post and connect the accounts you want to publish to."))
      return
    }
    const session = ++runId.current
    setRunning(true)
    setError(null)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    try {
      for (let index = 0; index < fresh.length; index += 1) {
        if (runId.current !== session) return
        const slot = fresh[index]
        setProgress({ done: index + 1, total: fresh.length })
        const started = await uploadPostApi.start(projectId, slot.clipId!, {
          platforms,
          user,
          preset: renderPreset(platforms),
          subtitles: true,
          title_card: true,
          scheduled_date: slot.stamp,
          timezone,
          extra: privateExtra(platforms, 'private'),
        })
        if (runId.current !== session) return
        const deadline = Date.now() + 30 * 60 * 1000
        let submitted = false
        while (Date.now() < deadline) {
          if (runId.current !== session) return
          await sleep(2000)
          if (runId.current !== session) return
          const job = await uploadPostApi.job(started.job_id)
          if (runId.current !== session) return
          if (job.status === 'failed') {
            setError(job.error || t("Publish failed"))
            setRunning(false)
            return
          }
          if (job.status === 'submitted') {
            submitted = true
            break
          }
        }
        if (!submitted) {
          setError(t("Publish failed"))
          setRunning(false)
          return
        }
      }
      if (runId.current !== session) return
      navigate(`/project/${projectId}/publish?view=calendar`)
    } catch (err) {
      if (runId.current !== session) return
      setError(readApiDetail(err, t("Publish failed")))
      setRunning(false)
    }
  }

  return (
    <div className="ac-page ac-page--narrow">
      <header>
        <button className="ac-back" onClick={() => navigate(`/project/${projectId}/publish`)}>
          <Icon.Back />{t("Publish")}
        </button>
        <h1 className="ac-title">{t("Plan this week")}</h1>
      </header>

      {loading && <div style={{ marginTop: 28 }}><StatusDot tone="accent" label={t("Still processing")} /></div>}
      {!loading && !configured && !error && (
        <div className="ac-empty" style={{ marginTop: 28 }}>
          <b>{t("No publish key yet. Add it once in Settings.")}</b>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn size="sm" variant="cta" onClick={() => navigate('/settings?section=publish')}>{t("Open settings")}</Btn>
            <Btn size="sm" onClick={() => void openExternalLink(publishGuideHref(i18n.language))}>{t("How-to")}<Icon.External size={12} /></Btn>
          </div>
        </div>
      )}
      {!loading && configured && (
        <>
          <p className="ac-sub" style={{ marginTop: 20 }}>
            {t("Unsent clips fill Monday, Wednesday, and Friday at 09:00, highest score first. Nothing is submitted until you confirm. Posts stay private.")}
          </p>
          <div className="ac-rows" style={{ marginTop: 8 }}>
            {slots.map((slot) => {
              const title = slot.title || t("Clips")
              const hint = slot.state === 'empty'
                ? t("This slot is open")
                : slot.state === 'taken'
                  ? (slot.title || t("This slot is already taken"))
                  : `${title} · ${t("Score {{score}}", { score: shownScore(slot.score) })}`
              return (
                <Row key={slot.stamp} label={<span className="ac-mono">{slotWhen(slot.at)}</span>} hint={hint} />
              )
            })}
          </div>
          {nothingLeft && <p className="ac-sub">{t("No unsent clips left for this week.")}</p>}
          <p className="ac-sub">{t("TikTok allows 15 a day and YouTube 10. This week places one a day.")}</p>
          {running && progress && (
            <>
              <div style={{ marginTop: 16 }}><ProgressLine percent={Math.round((progress.done / progress.total) * 100)} /></div>
              <p className="ac-sub">{t("Scheduling {{done}} of {{total}}", progress)}</p>
            </>
          )}
          {!platforms.length && <p className="ac-sub">{t("This profile has no connected platforms.")}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
            <Btn variant="cta" loading={running} disabled={!fresh.length || !platforms.length} onClick={() => void confirm()}>{t("Confirm schedule")}</Btn>
          </div>
        </>
      )}
      {error && <p style={{ marginTop: 12, color: 'var(--ac-error)', fontSize: 13 }}>{error}</p>}
    </div>
  )
}

export default PublishWeekPage
