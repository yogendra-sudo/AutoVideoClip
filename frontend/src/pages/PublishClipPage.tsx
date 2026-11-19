import { socialPublishObserved, socialPublishOutcome } from '../analytics/studio'
import { workflow } from '../analytics/observer'
import i18n, { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { studioApi } from '../features/studio/api'
import { outputVariantPublishTarget } from '../features/studio/outputVariantPublish'
import { projectApi } from '../services/api'
import { Btn, Icon, ProgressLine, Row, Segmented, StatusDot } from '../ui'
import { openExternalLink } from '../utils/externalLinks'
import { publishGuideHref } from '../publish/guide'
import { bilibiliApi, type BilibiliJobView } from '../publish/bilibiliApi'
import { coverApi, type CoverView } from '../publish/coverApi'
import {
  buildSchedule, defaultPlatforms, platformLabel, privateExtra, publishDestinations, readApiDetail, renderPreset,
  type PublishVisibility,
} from '../publish/uploadPost'
import { uploadPostApi, type PlatformResult, type PublishJobView, type UploadPostProfile } from '../publish/uploadPostApi'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Track = { kind: 'upload-post' | 'bilibili'; jobId: string }

function translatedCoverHint(warning?: string | null, detail?: string | null): string | null {
  if (!warning) return null
  const head = t(String(warning))
  if (!detail) return head
  return `${head}：${t(String(detail))}`
}

function coverPlatform(platforms: string[]): 'bilibili' | 'douyin' {
  if (platforms.includes('bilibili') && platforms.every((p) => p === 'bilibili')) return 'bilibili'
  if (platforms.some((p) => ['tiktok', 'instagram', 'youtube', 'facebook', 'threads', 'pinterest'].includes(p))) {
    return 'douyin'
  }
  return 'bilibili'
}

function settleJob(job: PublishJobView | BilibiliJobView, later: boolean): {
  pending: boolean
  failed: boolean
  scheduled: boolean
  results: PlatformResult[]
  error?: string
} {
  if (job.status === 'failed') {
    return { pending: false, failed: true, scheduled: false, results: [], error: job.error }
  }
  if (job.status === 'queued' || job.status === 'running') {
    return { pending: true, failed: false, scheduled: false, results: [] }
  }
  const direct = 'results' in job && job.results ? job.results : []
  if (job.status === 'completed' || job.status === 'scheduled') {
    return { pending: false, failed: false, scheduled: job.status === 'scheduled' || later, results: direct }
  }
  if (job.status === 'submitted') {
    const remote = 'remote' in job ? job.remote : undefined
    const results = remote?.results || direct
    if (later) return { pending: false, failed: false, scheduled: true, results }
    if (!remote?.final) return { pending: true, failed: false, scheduled: false, results }
    return {
      pending: false,
      failed: results.some((item) => !item.success && !item.skipped),
      scheduled: false,
      results,
    }
  }
  return { pending: true, failed: false, scheduled: false, results: [] }
}

function defaultWhen(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const PublishClipPage: React.FC = () => {
  useTranslation()
  const { id: projectId = '', clipId = '' } = useParams()
  const studioJobId = /^studio-[a-f0-9]{32}$/.test(clipId) ? clipId.slice(7) : null
  const variantTarget = outputVariantPublishTarget(useLocation().search)
  const [studioRevision, setStudioRevision] = useState<number>()
  const navigate = useNavigate()
  const runId = useRef(0)

  const [clipTitle, setClipTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [biliConfigured, setBiliConfigured] = useState(false)
  const [profiles, setProfiles] = useState<UploadPostProfile[]>([])
  const [user, setUser] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [visibility, setVisibility] = useState<PublishVisibility>('private')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [whenValue, setWhenValue] = useState(defaultWhen)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [subtitles, setSubtitles] = useState(true)
  const [titleCard, setTitleCard] = useState(true)
  const [savingFile, setSavingFile] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'running' | 'waiting' | 'done' | 'partial' | 'failed' | 'scheduled'>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<PlatformResult[]>([])
  const [cover, setCover] = useState<CoverView | null>(null)
  const [coverTitle, setCoverTitle] = useState('')
  const [coverSubtitle, setCoverSubtitle] = useState('')
  const [coverBadge, setCoverBadge] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverHint, setCoverHint] = useState<string | null>(null)
  const coverJob = useRef(0)

  useEffect(() => {
    const session = ++runId.current
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [project, cfg, bili] = await Promise.all([
          projectApi.getProject(projectId),
          uploadPostApi.getConfig(),
          bilibiliApi.getConfig(),
        ])
        if (cancelled || runId.current !== session) return
        let clips = project.clips || []
        if (!clips.length) {
          try { clips = await projectApi.getClips(projectId) } catch { clips = [] }
        }
        const clip = clips.find((item) => item.id === clipId)
        let nextTitle = clip?.generated_title || clip?.title || ''
        let coverSlot = 'bilibili'
        if (studioJobId) {
          const workspace = await studioApi.get(projectId)
          if (cancelled || runId.current !== session) return
          const exported = workspace.jobs.find(job => job.job_id === studioJobId && job.status === 'completed')
          if (!exported) throw new Error(t('Video is incomplete or missing. Return to the project to export again.'))
          nextTitle = exported.title
          setStudioRevision(exported.revision)
          // An automatic output arrives with its publish kit: start from its copy and cover.
          const variant = (workspace.output_variants || []).find(item => item.id === variantTarget.uploadPost)
          if (variant?.post) {
            nextTitle = variant.post.title || nextTitle
            setTitle(variant.post.title)
            setDescription([variant.post.description, variant.post.tags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n'))
          }
          if (variant && !['bilibili', 'youtube_long', 'original'].includes(variant.strategy_id)) coverSlot = 'douyin'
        }
        setClipTitle(nextTitle)
        setCoverTitle(nextTitle)
        setConfigured(cfg.configured)
        setBiliConfigured(bili.configured)
        try {
          const existing = await coverApi.get(projectId, clipId, coverSlot)
          if (!cancelled && runId.current === session && existing.ok && existing.url) {
            setCover(existing)
            if (existing.title) setCoverTitle(existing.title)
            if (existing.subtitle) setCoverSubtitle(existing.subtitle)
            if (existing.badge) setCoverBadge(existing.badge)
          }
        } catch { /* NoneCoverIgnore when */ }
        let list: UploadPostProfile[] = []
        let next = ''
        if (cfg.configured) {
          const res = await uploadPostApi.profiles()
          if (cancelled || runId.current !== session) return
          list = res.profiles || []
          next = list.some((p) => p.username === cfg.user) ? cfg.user : (list[0]?.username || cfg.user || '')
        }
        setProfiles(list)
        setUser(next)
        const connected = list.find((p) => p.username === next)?.connected_platforms || []
        setSelected(defaultPlatforms(publishDestinations(connected, bili.configured)))
      } catch (err) {
        if (!cancelled && runId.current === session) setError(readApiDetail(err, t("Publish failed")))
      } finally {
        if (!cancelled && runId.current === session) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId, clipId, studioJobId])

  const chooseUser = (next: string) => {
    setUser(next)
    const connected = profiles.find((p) => p.username === next)?.connected_platforms || []
    setSelected(defaultPlatforms(publishDestinations(connected, biliConfigured)))
  }

  const toggle = (platform: string) => {
    setSelected((cur) => cur.includes(platform) ? cur.filter((p) => p !== platform) : [...cur, platform])
  }

  // Covers are on by default: make one as soon as the page is ready so the user sees it instead of an empty box.
  const autoCover = useRef(false)
  useEffect(() => {
    if (loading || error || cover || coverBusy || autoCover.current) return
    autoCover.current = true
    void generateCover()
  }, [loading, error, cover, coverBusy])

  const generateCover = async () => {
    if (!projectId || !clipId || coverBusy) return
    const session = ++coverJob.current
    setCoverBusy(true)
    setCoverHint(null)
    try {
      const started = await coverApi.start(projectId, clipId, {
        platform: coverPlatform(selected),
        title: (coverTitle || title).trim() || undefined,
        subtitle: coverSubtitle.trim() || undefined,
        badge: coverBadge.trim() || undefined,
      })
      if (coverJob.current !== session) return
      if ('url' in started && started.url) {
        setCover(started as CoverView)
        if (started.warning) setCoverHint(translatedCoverHint(String(started.warning), started.warning_detail))
        return
      }
      const jobId = (started as { job_id: string }).job_id
      for (let i = 0; i < 90; i++) {
        await sleep(1000)
        if (coverJob.current !== session) return
        const job = await coverApi.job(jobId)
        if (job.status === 'completed' && job.result) {
          setCover(job.result)
          if (job.result.warning) setCoverHint(translatedCoverHint(job.result.warning, job.result.warning_detail))
          return
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          setCoverHint(t(job.error || "Cover generation failed. Publishing will use a frame."))
          return
        }
      }
      setCoverHint(t("Cover is still generating. Publishing will fall back to a frame."))
    } catch (err) {
      setCoverHint(readApiDetail(err, t("Cover generation failed. Publishing will use a frame.")))
    } finally {
      if (coverJob.current === session) setCoverBusy(false)
    }
  }

  const profile = profiles.find((p) => p.username === user)
  const connected = profile?.connected_platforms || []
  const destinations = publishDestinations(connected, biliConfigured)
  const reconnect = (profile?.reconnect_platforms || []).map(platformLabel).join(' · ')
  const ready = configured || biliConfigured
  const busy = phase === 'running' || phase === 'waiting' || savingFile
  const preset = renderPreset(selected)
  const longYoutube = selected.includes('youtube') && title.trim().length > 100

  const publish = async () => {
    const overseas = selected.filter((item) => item !== 'bilibili')
    const sendBili = selected.includes('bilibili')
    if (!overseas.length && !sendBili) {
      setError(t("Select at least one platform"))
      return
    }
    if (overseas.length && !user) {
      setError(t("No profile yet. Create one in Upload-Post and connect the accounts you want to publish to."))
      return
    }
    const schedule = buildSchedule(when, whenValue, Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now())
    if (!schedule.ok) {
      setError(schedule.reason === 'empty' ? t("Pick a time") : t("Choose a later time"))
      return
    }
    const session = runId.current
    const later = when === 'later'
    setError(null)
    setResults([])
    setPhase('running')
    setPercent(12)
    const tracks: Track[] = []
    const telemetryGeneration = workflow.generation()
    const telemetryEnabled = workflow.active(telemetryGeneration)
    const observed = new Set<string>()
    try {
      if (overseas.length) {
        const started = await uploadPostApi.start(projectId, clipId, {
          platforms: overseas,
          user,
          preset: renderPreset(overseas),
          output_variant_id: variantTarget.uploadPost,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          subtitles,
          title_card: titleCard,
          scheduled_date: schedule.scheduled_date,
          timezone: schedule.timezone,
          extra: privateExtra(overseas, visibility),
        })
        tracks.push({ kind: 'upload-post', jobId: started.job_id })
      }
      if (sendBili) {
        const started = await bilibiliApi.start(projectId, clipId, {
          output_variant_id: variantTarget.bilibili,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          subtitles,
          title_card: titleCard,
          scheduled_date: schedule.scheduled_date,
          timezone: schedule.timezone,
          visibility,
        })
        tracks.push({ kind: 'bilibili', jobId: started.job_id })
      }
    } catch (err) {
      if (!tracks.length) {
        setError(readApiDetail(err, t("Publish failed")))
        setPhase('failed')
        return
      }
      setError(readApiDetail(err, t("Publish failed")))
    }
    if (runId.current !== session) return
    const deadline = Date.now() + 30 * 60 * 1000
    let waitMs = 2000
    let sawPending = false
    while (Date.now() < deadline) {
      if (runId.current !== session) return
      await sleep(waitMs)
      if (runId.current !== session) return
      let pending = false
      let failed = false
      let scheduled = false
      let message = ''
      const merged: PlatformResult[] = []
      for (const track of tracks) {
        const job = track.kind === 'upload-post'
          ? await uploadPostApi.job(track.jobId)
          : await bilibiliApi.job(track.jobId)
        if (runId.current !== session) return
        const settled = settleJob(job, later)
        if (!settled.pending && !observed.has(track.jobId)) {
          observed.add(track.jobId)
          if (telemetryEnabled) socialPublishObserved(telemetryGeneration, {
            ...workflow.context(projectId, studioJobId || undefined), source_type: studioJobId ? 'studio' : 'legacy', gateway: track.kind,
            outcome: socialPublishOutcome(job.status, settled.scheduled, settled.results),
          })
        }
        if (settled.pending) pending = true
        if (settled.failed) failed = true
        if (settled.scheduled) scheduled = true
        if (settled.error) message = settled.error
        merged.push(...settled.results)
      }
      setResults(merged)
      if (pending) {
        sawPending = true
        setPhase(merged.length ? 'waiting' : 'running')
        setPercent(merged.length ? 72 : 36)
        waitMs = merged.length ? 10000 : 2000
        continue
      }
      setPercent(100)
      if (message) setError(message)
      if (failed && !merged.length) setPhase('failed')
      else if (failed) setPhase('partial')
      else if (scheduled) setPhase('scheduled')
      else setPhase('done')
      return
    }
    setPhase(sawPending ? 'waiting' : 'running')
    setError(sawPending ? t("Submitted. Waiting on each platform.") : t("Rendering and submitting"))
  }

  const downloadFile = async () => {
    if (savingFile || phase === 'running' || phase === 'waiting') return
    setSavingFile(true)
    setError(null)
    setPercent(8)
    try {
      const started = await projectApi.startClipExport(projectId, clipId, {
        preset: studioJobId ? 'original' : preset,
        subtitles,
        title_card: titleCard,
      })
      for (let i = 0; i < 180; i++) {
        await sleep(1000)
        const job = await projectApi.getExportJob(projectId, started.job_id)
        setPercent(job.percent ?? 20)
        if (job.status === 'completed') {
          await projectApi.downloadExport(projectId, started.job_id)
          setPercent(100)
          return
        }
        if (job.status === 'failed') {
          setError(job.error || t("Export failed"))
          return
        }
      }
      setError(t("Export timed out. Check the output folder later."))
    } catch (err) {
      setError(readApiDetail(err, t("Export failed")))
    } finally {
      setSavingFile(false)
    }
  }

  const summary = phase === 'done'
    ? t("Every platform finished")
    : phase === 'partial'
      ? t("Some platforms did not publish")
      : phase === 'scheduled'
        ? t("Scheduled. It goes out on its own, and you can close the app.")
        : phase === 'waiting'
          ? t("Submitted. Waiting on each platform.")
          : phase === 'running'
            ? t("Rendering and submitting")
            : null

  return (
    <div className="ac-page ac-page--narrow">
      <header>
        <button className="ac-back" onClick={() => navigate(`/project/${projectId}`)}>
          <Icon.Back />{t("Project")}
        </button>
        <h1 className="ac-title">{t("Publish")}</h1>
        <div className="ac-meta">
          <span>{clipTitle || t("Clips")}</span>
          <span className="dot" />
          <a href={publishGuideHref(i18n.language)} onClick={(e) => { e.preventDefault(); void openExternalLink(publishGuideHref(i18n.language)) }} style={{ color: 'var(--ac-accent)' }}>{t("How-to")}</a>
        </div>
      </header>

      <div className="ac-rows" style={{ marginTop: 28 }}>
        {loading && <div style={{ padding: '28px 0' }}><StatusDot tone="accent" label={t("Still processing")} /></div>}
        {!loading && !ready && !error && (
          <div className="ac-empty" style={{ marginTop: 8 }}>
            <b>{t("No publish account yet. Add one in Settings.")}</b>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="cta" onClick={() => navigate('/settings?section=publish')}>{t("Open settings")}</Btn>
              <Btn size="sm" onClick={() => void openExternalLink(publishGuideHref(i18n.language))}>{t("How-to")}<Icon.External size={12} /></Btn>
            </div>
          </div>
        )}
        {!loading && ready && (
          <>
            {profiles.length > 1 && (
              <Row label={t("Default profile")}>
                <Segmented size="sm" ariaLabel={t("Default profile")} value={user} onChange={chooseUser}
                  options={profiles.map((p) => ({ value: p.username, label: p.username }))} />
              </Row>
            )}
            <Row label={t("When")}>
              <Segmented size="sm" ariaLabel={t("When")} value={when} onChange={setWhen}
                options={[{ value: 'now', label: t("Now") }, { value: 'later', label: t("Later") }]} />
            </Row>
            {when === 'later' && (
              <Row label={t("Pick a time")} hint={selected.includes('bilibili') ? t("A Bilibili schedule has to be more than two hours from now.") : undefined}>
                <input className="ac-input" style={{ width: 220 }} type="datetime-local" aria-label={t("Pick a time")} value={whenValue} onChange={(e) => setWhenValue(e.target.value)} />
              </Row>
            )}
            {destinations.length > 0 && (
              <Row label={t("Platforms")} stack>
                <div className="ac-seg ac-seg--sm" role="group" aria-label={t("Platforms")}>
                  {destinations.map((p) => (
                    <button key={p} type="button" aria-pressed={selected.includes(p)} onClick={() => toggle(p)} disabled={busy}>{platformLabel(p)}</button>
                  ))}
                </div>
              </Row>
            )}
            {configured && profiles.length > 0 && !connected.length && !biliConfigured && !reconnect && (
              <p style={{ color: 'var(--ac-sub)', fontSize: 13 }}>{t("This profile has no connected platforms.")}</p>
            )}
            {reconnect && (
              <p style={{ color: 'var(--ac-sub)', fontSize: 13, margin: '8px 0 0' }}>{t("Reconnect required: {{platforms}}", { platforms: reconnect })}</p>
            )}
            <Row label={t("Visibility")} hint={t("Starts where only you can see it. Public posts go live on the account.")}>
              <Segmented size="sm" ariaLabel={t("Visibility")} value={visibility} onChange={setVisibility}
                options={[{ value: 'private', label: t("Only me") }, { value: 'public', label: t("Public") }]} />
            </Row>
            <Row wide label={t("Title")} hint={longYoutube ? t("YouTube titles over 100 characters are shortened on their own.") : t("Leave blank to use the clip title.")}>
              <input className="ac-input" aria-label={t("Title")} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Row>
            <Row wide label={t("Description")} hint={t("Used by YouTube, LinkedIn, Facebook, Pinterest, and Bilibili.")}>
              <textarea className="ac-input ac-textarea" style={{ minHeight: 88 }} aria-label={t("Description")} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Row>
            <Row stack label={t("Cover")} hint={t("If generation fails or is skipped, publishing still uses a frame and is never blocked.")}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                <div style={{
                  width: '100%',
                  maxWidth: 360,
                  aspectRatio: coverPlatform(selected) === 'douyin' ? '9 / 16' : '16 / 9',
                  background: 'var(--ac-thumb)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--ac-line)',
                }}>
                  {cover?.url ? (
                    <img src={cover.url} alt={t("Cover")} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--ac-muted)', fontSize: 13 }}>
                      {coverBusy ? t("Generating cover…") : t("No cover yet")}
                    </div>
                  )}
                </div>
                <input className="ac-input" aria-label={t("Cover title")} placeholder={t("Cover title")} value={coverTitle} onChange={(e) => setCoverTitle(e.target.value)} />
                <input className="ac-input" aria-label={t("Cover subtitle")} placeholder={t("Cover subtitle")} value={coverSubtitle} onChange={(e) => setCoverSubtitle(e.target.value)} />
                <input className="ac-input" aria-label={t("Cover badge")} placeholder={t("Cover badge")} value={coverBadge} onChange={(e) => setCoverBadge(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn size="sm" loading={coverBusy} disabled={busy} onClick={() => void generateCover()}>
                    {cover?.url ? t("Regenerate cover") : t("Generate cover")}
                  </Btn>
                  <Btn size="sm" onClick={() => navigate('/settings?section=cover')}>{t("Cover settings")}</Btn>
                </div>
                {coverHint && <p style={{ margin: 0, color: 'var(--ac-sub)', fontSize: 12.5 }}>{coverHint}</p>}
                {cover?.method === 'frame' && !coverHint && (
                  <p style={{ margin: 0, color: 'var(--ac-sub)', fontSize: 12.5 }}>{t("This cover is a video frame")}</p>
                )}
              </div>
            </Row>
          </>
        )}
        {!loading && !studioJobId && (
          <>
            <Row label={t("Subtitles")} hint={t("Show this segment’s subtitles on the video.")}>
              <Segmented size="sm" ariaLabel={t("Subtitles")} value={subtitles ? 'on' : 'off'} onChange={(v) => setSubtitles(v === 'on')}
                options={[{ value: 'on', label: t("Show") }, { value: 'off', label: t("Hide") }]} />
            </Row>
            <Row label={t("Opening title")} hint={t("Shows the title text for about 4 seconds at the start.")}>
              <Segmented size="sm" ariaLabel={t("Opening title")} value={titleCard ? 'on' : 'off'} onChange={(v) => setTitleCard(v === 'on')}
                options={[{ value: 'on', label: t("Show") }, { value: 'off', label: t("Hide") }]} />
            </Row>
          </>
        )}
      </div>

      {!loading && (
        <p className="ac-sub" style={{ marginTop: 16 }}>
          {studioJobId ? t('Publish exported video V{{revision}}, preserving framing, text and audio. Return to the editor and export again to make changes.', { revision: studioRevision ?? '—' }) : t("The file follows the accounts: a vertical account is rendered 9:16, Bilibili alone renders landscape, and horizontal overseas accounts keep the original frame.")}
        </p>
      )}
      {busy && <div style={{ marginTop: 16 }}><ProgressLine percent={percent} /></div>}
      {summary && <p style={{ marginTop: 12, color: 'var(--ac-sub)', fontSize: 13 }}>{summary}</p>}
      {results.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {results.map((r) => {
            const tone = r.skipped ? 'muted' : r.success ? 'ok' : 'error'
            const note = r.skipped
              ? t("Not connected, skipped")
              : r.fallback_to_inbox
                ? t("Saved to the TikTok inbox. Publish it again in the app.")
                : (r.error || r.message || '')
            return (
              <div key={r.platform} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--ac-line)' }}>
                <StatusDot tone={tone} label={<>{platformLabel(r.platform || '')}{note ? <span style={{ color: 'var(--ac-muted)' }}> · {note}</span> : null}</>} />
                {r.url && (
                  <a href={r.url} onClick={(e) => { e.preventDefault(); void openExternalLink(r.url!) }} style={{ color: 'var(--ac-accent)', fontSize: 13 }}>{t("Open link")}</a>
                )}
              </div>
            )
          })}
        </div>
      )}
      {error && <p style={{ marginTop: 12, color: 'var(--ac-error)', fontSize: 13 }}>{error}</p>}

      {!loading && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 28 }}>
          <Btn loading={savingFile} disabled={phase === 'running' || phase === 'waiting'} onClick={() => void downloadFile()}>{t("Download video")}</Btn>
          {ready && phase !== 'done' && phase !== 'partial' && phase !== 'scheduled' && (
            <Btn variant="cta" loading={phase === 'running' || phase === 'waiting'} disabled={!selected.length || savingFile} onClick={() => void publish()}>
              {when === 'later' ? t("Schedule") : t("Publish")}
            </Btn>
          )}
          {(phase === 'done' || phase === 'partial' || phase === 'scheduled') && (
            <Btn onClick={() => navigate(`/project/${projectId}/publish`)}>{t("View posts")}</Btn>
          )}
        </div>
      )}
    </div>
  )
}

export default PublishClipPage
