import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import StudioDownloadLink from './StudioDownloadLink'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Btn, Dialog, ProgressLine, Row, fmtDuration } from '../../ui'
import { studioApi, errorText, type SourcePreview } from './api'
import { useWorkspace } from './useWorkspace'
import PlayerBar from './PlayerBar'
import { CropPoint, Draft, Scene, SubtitleCue, languages, draftDuration, draftError, moveScene, applyCandidate, portraitDesign, cropAt, frameModeAt, patchShot } from './types'
import CandidatePicker from './CandidatePicker'
import TitleArtwork from './TitleArtwork'
import DraftVariantDialog from './DraftVariantDialog'
import { titlePresets, isArtworkStyle } from './titlePresets'
import DraftSettingsPanel, { type FramingState } from './DraftSettingsPanel'
import { draftExportState } from './draftExportState'
import { savedDraftOverrides } from './overrides'
import { flagAssigned } from '../../analytics/flags'
import { trackAutoChoiceOverridden } from '../../analytics/studio'
import './studio.css'
import { effectiveSubtitles } from './subtitleState'

export default function StudioEditor() {
  const { id, draftId } = useParams()
  return <Editor key={`${id}:${draftId}`} projectId={id!} draftId={draftId!} />
}
function Editor({ projectId, draftId }: { projectId: string; draftId: string }) {
  useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const variantId = searchParams.get('variant') || undefined
  const { workspace, error: loadError, loading, refresh } = useWorkspace(projectId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [instruction, setInstruction] = useState('')
  const [selected, setSelected] = useState(0)
  const [picker, setPicker] = useState<number | 'append' | null>(null)
  const [sourceDuration, setSourceDuration] = useState<number>()
  const [showVariant, setShowVariant] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showRendered, setShowRendered] = useState(false)
  const [playbackError, setPlaybackError] = useState(false)
  const [sourcePreview, setSourcePreview] = useState<SourcePreview>({status: 'idle'})
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [renderedDuration, setRenderedDuration] = useState(0)
  const [framing, setFraming] = useState<FramingState>({ busy: false })
  useEffect(() => {
    const controller = new AbortController()
    studioApi.subtitles(projectId, controller.signal).then(v => setCues(v.cues)).catch(() => setCues([]))
    studioApi.framingStatus().then(status => setFraming(f => ({ ...f, status }))).catch(() => undefined)
    return () => controller.abort()
  }, [projectId])
  useEffect(() => {
    if (framing.status?.status !== 'installing') return
    const timer = window.setInterval(() => {
      studioApi.framingStatus().then(status => setFraming(f => ({ ...f, status }))).catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [framing.status?.status])
  useEffect(() => {
    if (!['queued', 'running'].includes(sourcePreview.status)) return
    let cancelled = false
    const timer = window.setInterval(() => {
      studioApi.previewStatus(projectId).then(state => {
        if (cancelled) return
        setSourcePreview(state)
        if (state.status === 'completed') setPlaybackError(false)
      }).catch(error => { if (!cancelled) setSourcePreview({status:'failed', error:errorText(error)}) })
    }, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [projectId, sourcePreview.status])
  const preparePreview = async () => {
    setSourcePreview({status:'queued'})
    try {
      const state = await studioApi.preparePreview(projectId)
      setSourcePreview(state)
      if (state.status === 'completed') setPlaybackError(false)
    } catch(error) { setSourcePreview({status:'failed', error:errorText(error)}) }
  }

  /** Centre every scene's crop window on the speaker; scenes without a face keep their value. */
  const autoFrame = async (target?: Draft, trigger: 'auto' | 'manual' | 'portrait_preset' = 'manual') => {
    const base = target || draft
    if (!base || framing.status?.status !== 'installed') return
    setFraming(f => ({ ...f, busy: true, error: undefined }))
    try {
      const result = await studioApi.autoFrame(projectId, base, trigger)
      const found = new Map(result.scenes.filter(s => s.crop_x !== null).map(s => [s.id, s]))
      setDraft(current => current ? { ...current, scenes: current.scenes.map(sc => { const f = found.get(sc.id); return f ? { ...sc, crop_x: f.crop_x, crop_track: f.crop_track, framing_source: 'auto' as const, framing_adjusted: false } : sc }) } : current)
      setShowRendered(false)
      setFraming(f => ({ ...f, busy: false, result: { framed: found.size, total: result.scenes.length, shots: result.scenes.reduce((n, s) => n + (s.crop_track?.length ?? 0), 0), fit: result.scenes.reduce((n, s) => n + s.fit_shots, 0) } }))
    } catch (e) { setFraming(f => ({ ...f, busy: false, error: t(errorText(e)) })) }
  }
  const installFraming = async () => {
    try { const status = await studioApi.framingInstall(); setFraming(f => ({ ...f, status })) }
    catch (e) { setFraming(f => ({ ...f, error: t(errorText(e)) })) }
  }
  // Once the runtime lands (or the user switches to a cropped layout), frame automatically the first time.
  const cropping = !!draft && draft.aspect !== 'original' && draft.layout === 'crop'
  useEffect(() => {
    if (!cropping || framing.busy || framing.result || framing.status?.status !== 'installed') return
    if (draft?.scenes.some(s => s.crop_x != null || s.crop_track?.length)) return
    void autoFrame(undefined, 'auto')
  }, [cropping, framing.status?.status])
  /** Edit only the shot under the playhead; the rest of the scene's track stays as detected. */
  const setShot = (sceneId: string, changes: Partial<CropPoint>) => {
    if (draft) patch({ scenes: draft.scenes.map(sc => sc.id === sceneId ? { ...patchShot(sc, currentTime, changes, draft.crop_x ?? .5), framing_source: sc.framing_source || 'manual', framing_adjusted: true } : sc) })
  }
  const applyPortrait = () => {
    if (!draft) return
    const next = portraitDesign(draft)
    patch(next)
    setFraming(f => ({ ...f, result: undefined }))
    void autoFrame(next, 'portrait_preset')
  }

  const [suggestion, setSuggestion] = useState<Draft | null>(null)
  const [undo, setUndo] = useState<Draft | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const localKey = `autoclip.studio.${projectId}.${draftId}`
  const dirty = !!draft && JSON.stringify(draft) !== saved
  const artworkStyle = isArtworkStyle(draft?.title_style)
  const scene = draft?.scenes[selected] || draft?.scenes[0]
  // The preview transport runs on the clip's own timeline: 0 = scene start (or rendered clip start).
  const playBase = showRendered ? 0 : scene?.start ?? 0
  const playLength = showRendered ? renderedDuration : scene ? scene.end - scene.start : 0
  const togglePlay = () => { const v = video.current; if (!v) return; if (v.paused) void v.play().catch(() => undefined); else v.pause() }
  const jobs = workspace.jobs.filter(j => j.draft_id === draftId)
  const exportState = draft ? draftExportState(draft, jobs) : undefined
  const currentJob = !dirty ? exportState?.completed || exportState?.failure : undefined
  const active = jobs.find(j => j.status === 'queued' || j.status === 'running')

  useEffect(() => {
    if (draft) return
    const server = workspace.drafts.find(d => d.id === draftId)
    if (!server) return
    setSaved(JSON.stringify(server))
    try {
      const cached = JSON.parse(localStorage.getItem(localKey) || 'null') as Draft | null
      if (cached && cached.revision === server.revision && cached.id === server.id && !draftError(cached)) {
        setDraft(cached); setNotice("Local edits restored. Save before exporting."); return
      }
    } catch { /* A damaged local cache must never hide the server draft. */ }
    setDraft(server)
  }, [workspace, draftId, draft])
  useEffect(() => {
    if (!draft) return
    try { if (dirty) localStorage.setItem(localKey, JSON.stringify(draft)); else localStorage.removeItem(localKey) } catch { setNotice("Local recovery is unavailable. Save your draft soon.") }
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draft, dirty])
  useEffect(() => {
    if (video.current && scene && !showRendered) video.current.currentTime = scene.start
  }, [scene?.id, scene?.start, showRendered])
  useEffect(() => { if (draft) setMuted(!draft.original_audio) }, [draft?.original_audio])
  const patch = (changes: Partial<Draft>) => { if (draft) { setDraft({...draft, ...changes}); setShowRendered(false); setError('') } }
  const save = async (): Promise<Draft> => {
    if (!draft) throw new Error(t("Draft not found"))
    const invalid = draftError(draft, sourceDuration)
    if (invalid) throw new Error(t(invalid))
    if (!dirty) return draft
    let fields: ReturnType<typeof savedDraftOverrides> = []
    if (flagAssigned('track_overrides')) {
      try { fields = savedDraftOverrides(JSON.parse(saved) as Draft, draft) } catch { fields = [] }
    }
    const result = await studioApi.save(projectId, draft)
    for (const field of fields) trackAutoChoiceOverridden({ field, stage: 'editor' }, true)
    setDraft(result); setSaved(JSON.stringify(result)); setNotice("Draft saved"); refresh()
    return result
  }
  const perform = async (kind: string, action: () => Promise<void>) => {
    setBusy(kind); setError('')
    try { await action() } catch (e) { setError(t(errorText(e))) } finally { setBusy('') }
  }
  const render = async () => {
    await perform('render', async () => {
      const savedDraft = await save()
      await studioApi.export(projectId, savedDraft.id, savedDraft.revision, savedDraft, variantId)
      refresh(); setNotice("Rendering started. You can leave and check export history later.")
    })
  }
  const rewrite = async () => {
    if (!draft || !instruction.trim()) return
    await perform('rewrite', async () => setSuggestion(await studioApi.rewrite(projectId, draft, instruction.trim())))
  }
  if (!draft) return <div className="ac-page"><button className="ac-back" onClick={() => navigate(`/project/${projectId}`)}>{t("‹ Back to project")}</button><div className="ac-empty"><b>{loading ? t("Loading draft…") : t("Cannot open draft")}</b>{loadError || (!loading && t("Draft missing or removed"))}<Btn onClick={refresh}>{t("Retry")}</Btn></div></div>
  const subtitlesOn = effectiveSubtitles(draft)
  const previewUrl = currentJob?.status === 'completed' ? studioApi.video(projectId, currentJob.job_id) : ''
  const activeCue = cues.find(c => c.start <= currentTime && currentTime < c.end)
  const updateScene = (i: number, update: Partial<Scene>) => patch({ scenes: draft.scenes.map((s, index) => index === i ? {...s,...update} : s) })
  return <div className="ac-page studio-editor-page">
    <button className="ac-back" onClick={() => navigate(`/project/${projectId}`)}>{t("‹ Back to project")}</button>
    <header className="studio-row studio-editor-head"><div><h1 className="ac-title">{draft.title}</h1><span className="studio-muted">{dirty ? t("Unsaved edits · Stored locally") : t("Draft saved")} · V{draft.revision} · {fmtDuration(draftDuration(draft))}</span></div><div className="studio-actions"><Btn disabled={!!busy} onClick={() => setShowVariant(true)}>{t("Save as new version")}</Btn><Btn disabled={!!busy || !dirty} loading={busy==='save'} onClick={() => perform('save', async () => {await save()})}>{t("Save draft")}</Btn><Btn variant="cta" disabled={!!busy} onClick={() => setShowExport(true)}>{t("Export video")}</Btn></div></header>
    {loadError && <p className="studio-error">{t("Task status could not be updated:")}{t(loadError)}</p>}
    {!showRendered && (sourcePreview.status !== 'completed' || playbackError) && <details open={playbackError || ['queued', 'running', 'failed'].includes(sourcePreview.status)} className="studio-muted">
      <summary>{t('Create compatible preview')}</summary>
      <p>{t('If the source cannot play, create a compatible preview. The original stays unchanged; no AI is used.')}</p>
      {sourcePreview.error && <p className="studio-error">{t(sourcePreview.error)}</p>}
      <Btn disabled={['queued', 'running'].includes(sourcePreview.status)} onClick={preparePreview}>{t(['queued', 'running'].includes(sourcePreview.status) ? 'Preparing preview; long videos may take a few minutes…' : 'Create compatible preview')}</Btn>
    </details>}
    <fieldset disabled={!!busy} className="studio-fieldset">
      <div className="studio-editor-grid"><section className="studio-editor-main"><div className="studio-editor-sticky"><div className={`studio-stage studio-stage--${draft.aspect}`}>
        <div className="studio-video-frame" style={{aspectRatio: draft.aspect==='portrait'?'9/16':draft.aspect==='landscape'?'16/9':undefined}}>
          <video ref={video} preload="metadata" playsInline muted={muted} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setPlaybackError(true)} onLoadedData={() => setPlaybackError(false)} src={showRendered && previewUrl ? previewUrl : sourcePreview.status === 'completed' && sourcePreview.version ? studioApi.compatibleSource(projectId, sourcePreview.version) : studioApi.source(projectId)} style={{objectFit: showRendered || draft.layout!=='crop' || frameModeAt(scene, currentTime)==='fit'?'contain':'cover', objectPosition:`${cropAt(scene, currentTime, draft.crop_x ?? .5)*100}% 50%`}} onClick={togglePlay} onLoadedMetadata={() => { const v = video.current; if (!v) return; if (showRendered) setRenderedDuration(v.duration); else if (scene) { setSourceDuration(v.duration); v.currentTime = scene.start } }} onTimeUpdate={() => {const v=video.current; if(!v) return; setCurrentTime(v.currentTime); if(scene && !showRendered && (v.currentTime>=scene.end || v.currentTime<scene.start-.25)) {if(v.currentTime>=scene.end) v.pause(); v.currentTime=scene.start}}} />
          {!showRendered && subtitlesOn && activeCue && <div className={`studio-caption-overlay studio-caption studio-caption--${draft.subtitle_style || 'clean'}`}>{activeCue.text}</div>}
          {!showRendered && selected===0 && draft.hook && !artworkStyle && <div className={`studio-hook studio-hook--${draft.title_style || 'plain'}`}>{draft.hook}</div>}
          {!showRendered && selected===0 && draft.hook && artworkStyle && <TitleArtwork projectId={projectId} draft={draft}/>}
        </div>
        <PlayerBar offset={Math.max(0, Math.min(currentTime - playBase, playLength))} length={playLength} playing={playing} muted={muted}
          onToggle={togglePlay} onMute={() => setMuted(m => !m)}
          onSeek={offset => { const v = video.current; if (!v) return; v.currentTime = playBase + offset; setCurrentTime(v.currentTime) }} />
      </div><div className="studio-row studio-preview-foot"><span className="studio-muted">{showRendered?t("Rendered output"):t("Source preview · clip uses {{range}} · subtitles and translation follow the render", { range: scene ? `${fmtDuration(scene.start)}–${fmtDuration(scene.end)}` : "" })}</span>{previewUrl ? <Btn size="sm" onClick={() => setShowRendered(!showRendered)}>{showRendered?t("View source"):t("Play exported video")}</Btn> : <Btn size="sm" disabled={!!active} onClick={render}>{active?t("Rendering"):t("Render preview")}</Btn>}</div></div>
      <div className="studio-prompt"><input aria-label={t("Copy editing instructions")} placeholder={t("Tell AI how to edit, e.g. open with a short question")} value={instruction} onChange={e=>setInstruction(e.target.value)} /><Btn variant="cta" loading={busy==='rewrite'} disabled={!instruction.trim()} onClick={rewrite}>{t("Rewrite copy")}</Btn></div>
      {undo && <Btn variant="text" onClick={()=>{setDraft({...undo, revision:draft.revision});setUndo(null);setShowRendered(false)}}>{t("Undo last edit")}</Btn>}
      <details className="studio-details studio-source-details"><summary>{t("Adjust scenes")}{' '}<span className="ac-mono">{draft.scenes.length}</span>{' '}{t("· Order and boundaries")}</summary>
        <Btn size="sm" disabled={draft.scenes.length >= 30} onClick={() => setPicker('append')}>{t("Add scene")}</Btn>
        {draft.scenes.map((s,i)=><div className="studio-scene-row" key={s.id}><Btn size="sm" onClick={()=>{setSelected(i);setShowRendered(false)}}>{i+1}. {s.label}</Btn><label>{t("Start (s)")}<input type="number" min={0} step={.1} value={s.start} onChange={e=>updateScene(i,{start:Number(e.target.value)})}/></label><label>{t("End (s)")}<input type="number" min={0} step={.1} value={s.end} onChange={e=>updateScene(i,{end:Number(e.target.value)})}/></label><div className="studio-actions"><Btn size="sm" onClick={() => setPicker(i)}>{t("Replace")}</Btn><Btn size="sm" disabled={i===0} onClick={()=>patch({scenes:moveScene(draft,i,-1).scenes})}>{t("Move up")}</Btn><Btn size="sm" disabled={i===draft.scenes.length-1} onClick={()=>patch({scenes:moveScene(draft,i,1).scenes})}>{t("Move down")}</Btn><Btn size="sm" disabled={draft.scenes.length===1} onClick={()=>{patch({scenes:draft.scenes.filter((_,index)=>index!==i)});setSelected(0)}}>{t("Remove")}</Btn></div></div>)}
      </details>
      </section>
      <DraftSettingsPanel draft={draft} patch={patch} scene={scene} currentTime={currentTime} onShot={setShot}
        framing={framing} onAutoFrame={() => void autoFrame()} onInstallFraming={() => void installFraming()} onPortrait={applyPortrait}
        coverHref={previewUrl && currentJob ? `/project/${projectId}/publish/studio-${currentJob.job_id}` : undefined}
        onOpenCover={href => navigate(href)} /></div>
    </fieldset>
    {active && <div className="studio-render-state"><ProgressLine percent={active.percent}/><span className="studio-muted">{active.status==='queued'?t("Waiting to render"):t("Rendering video")} · {active.percent}%</span></div>}
    {currentJob?.status==='failed' && <p className="studio-error" role="alert">{t(currentJob.error || '')}</p>}
    {currentJob?.result?.warnings?.map(w=><p className="studio-muted" key={w}>{t(w)}</p>)}
    {error && <p className="studio-error" role="alert">{error}</p>}<p className="studio-muted" role="status">{t(notice)}</p>
    {picker !== null && <CandidatePicker projectId={projectId} mode={picker === 'append' ? 'append' : 'replace'} onClose={() => setPicker(null)} onChoose={candidate => {
      try {
        const next = applyCandidate(draft, candidate, picker, crypto.randomUUID())
        setUndo(draft); patch({ scenes: next.scenes }); setSelected(picker === 'append' ? draft.scenes.length : picker)
        setPicker(null); setNotice("Scenes updated. Save and render again. Check that the opening text still matches the footage.")
      } catch(e) { setPicker(null); setError(t(errorText(e))) }
    }} />}
    <DraftVariantDialog open={showVariant} projectId={projectId} draft={draft} onClose={() => setShowVariant(false)} onCreated={created => {
      try { localStorage.removeItem(localKey) } catch { /* The new server draft is already durable. */ }
      navigate(`/project/${projectId}/studio/${created.id}`)
    }} />
    <Dialog open={!!suggestion} onClose={()=>setSuggestion(null)} title={t("Review copy changes")} description={t("Confirm to apply to this draft. Scenes and audio stay unchanged.")} footer={<div className="studio-actions"><Btn onClick={()=>setSuggestion(null)}>{t("Keep original")}</Btn><Btn variant="cta" onClick={()=>{setUndo(draft);setDraft(suggestion);setSuggestion(null);setShowRendered(false)}}>{t("Apply changes")}</Btn></div>}><p>{suggestion?.title}</p><p>{suggestion?.hook || t("No opening text")}</p></Dialog>
    <Dialog open={showExport} onClose={()=>!busy && setShowExport(false)} title={t("Export video")} description={t("Save edits and render. Existing outputs stay in export history.")} footer={<div className="studio-actions"><Btn disabled={!!busy} onClick={()=>setShowExport(false)}>{t("Close")}</Btn>{previewUrl && <Btn onClick={()=>navigate(`/project/${projectId}/publish/studio-${currentJob!.job_id}`)}>{t("Publish this version")}</Btn>}{previewUrl ? <StudioDownloadLink className="ac-btn ac-btn--cta" projectId={projectId} jobId={currentJob!.job_id}/> : <Btn variant="cta" loading={busy==='render'||!!active} disabled={!!active} onClick={render}>{t("Confirm export")}</Btn>}</div>}>
      <Row label={t("Video")}>{draft.title}</Row><Row label={t("Format")}>MP4 · 30 fps</Row><Row label={t("Aspect ratio")}>{draft.aspect==='portrait'?'1080 × 1920':draft.aspect==='landscape'?'1920 × 1080':t("Keep original dimensions")}</Row><Row label={t("Text language")}>{draft.language==='source' ? t('Original language') : languages.find(l=>l.value===draft.language)?.label}</Row>
      <Row label={t("Opening title")}>{draft.hook ? t(titlePresets.find(preset=>preset.value===(draft.title_style||'plain'))?.label ?? '') : t("No opening text")}</Row><Row label={t("Original audio")}>{draft.original_audio?t("Keep"):t("Off")}</Row><Row label={t("Subtitles")}>{subtitlesOn?t("Subtitles on the video"):t("Off")}</Row><Row label={t("Cover")} hint={t("Once rendered, generate a titled cover per platform on the publish page.")}>{previewUrl && currentJob && <Btn size="sm" variant="text" onClick={()=>navigate(`/project/${projectId}/publish/studio-${currentJob.job_id}`)}>{t("Generate")}</Btn>}</Row>
      {currentJob?.status==='completed' && !!currentJob.result?.warnings?.length && <div role="status" className="studio-muted">{currentJob.result.warnings.map(w=><p key={w}>{t(w)}</p>)}</div>}
      {active && <ProgressLine percent={active.percent}/>}<p className="studio-muted">{previewUrl?t("This version is rendered and ready to download."):t("Rendering continues in the background when you close this panel.")}</p>{error && <p className="studio-error">{error}</p>}{currentJob?.status==='failed'&&<p className="studio-error">{t(currentJob.error || '')}</p>}
    </Dialog>
  </div>
}
