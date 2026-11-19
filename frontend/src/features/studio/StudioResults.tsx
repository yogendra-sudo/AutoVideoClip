import { useTranslation } from 'react-i18next'
import { getLocale, t } from '../../i18n'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Project, Clip } from '../../store/useProjectStore'
import { Btn, Section, Dialog, fmtDuration } from '../../ui'
import { studioApi, errorText } from './api'
import { failureSettings, sourceFailure } from './importReadiness'
import { browserCookieRecovery, stageBrowserCookieRecovery } from './browserCookieRecovery'
import { analysisFailureText, analysisPageFailure, receiptFailureInfo, failureAction, isTranscriptionInstall } from './failureAction'
import { weakLocalTimelineFailure } from '../../utils/timelineFailure'
import FailureActions, { FailureCopy } from './FailureActions'
import { analysisProviderId, listSwitchModelOptions, usableConnectionCount } from './switchModelOptions'
import { modelSettingsApi, type ModelSettings } from '../settings/modelSettingsApi'
import { forSave } from '../settings/modelSettingsLogic'
import { syncFollowingCover } from '../settings/modelDefaults'
import { displayedProgress, studioRunProgress } from './studioProgress'
import { recordSuccess } from './etaModel'
import { CONTINUE_PARAM, settingsReturnUrl } from './settingsReturn'
import { useWorkspace } from './useWorkspace'
import { Scene, Draft } from './types'
import ExportHistory from './ExportHistory'
import DraftResultCard from './DraftResultCard'
import OutputVariantCard from './OutputVariantCard'
import { platformLabel } from './platformLabel'
import { flagAssigned, flagEnabled } from '../../analytics/flags'
import { trackLegacyEntry } from '../../analytics/studio'
import { workflow } from '../../analytics/observer'
import { legacyEntrypointsHidden } from './legacyEntrypoints'
import { clearCompletionBadge, subscribeCompletionNotice, type NoticeKind } from './noticeRuntime'
import { noticeCopy } from './completionNotice'
import { dismissMorePlatformBanner, hasSuccessHistory, morePlatformBannerSeen, stashReuseImport, suggestAnotherPlatform } from './platformMemory'
import { followOutputLeave } from './overrides'

import './studio.css'
import './quick-output.css'

export default function StudioResults({ project, children, onCreateCollection, onReload }: { project: Project; children: ReactNode; onCreateCollection: () => void; onReload: () => void }) {
  useTranslation()
  const navigate = useNavigate()
  // back from a successful settings save -> 「Continue」 is the primary action.
  const returnedFromSettings = new URLSearchParams(useLocation().search).get(CONTINUE_PARAM) === '1'
  const {workspace,error,loading,loaded,refresh} = useWorkspace(project.id)
  const [history, setHistory] = useState(false)
  const [busy,setBusy] = useState('')
  const [actionError,setActionError] = useState('')
  const [preview,setPreview] = useState<Scene|null>(null)
  const [exporting,setExporting] = useState<Draft|null>(null)
  const [aiSettings, setAiSettings] = useState<ModelSettings | null>(null)
  useEffect(() => {
    let live = true
    modelSettingsApi.get().then(v => { if (live) setAiSettings(v) }).catch(() => { if (live) setAiSettings(null) })
    return () => { live = false }
  }, [])
  const goal = project.settings?.creative?.goal || project.processing_config?.creative?.goal || 'content'
  const visual = goal !== 'content'
  const sourceDuration=workspace.plan?.source_duration ?? workspace.analysis?.coverage?.duration
  const managed = visual || !!project.settings?.smart_import || !!project.processing_config?.smart_import
  const automatic = !!workspace.generation?.auto_start
  const hideLegacy = legacyEntrypointsHidden(flagEnabled('hide_legacy_entrypoints'), managed || automatic)
  const noteLegacy = (action: 'plan_adjust' | 'collection' | 'export_confirm') => trackLegacyEntry({ legacy_action: action }, flagAssigned('hide_legacy_entrypoints'))
  const failedCode = workspace.analysis?.error_code || workspace.generation?.error_code
  const sourceUnusable = workspace.analysis?.status === 'failed' && sourceFailure(failedCode)
  const cookieRecovery = workspace.analysis?.status === 'failed' && browserCookieRecovery(failedCode, workspace.analysis?.error)
  const canRetryAnalysis = automatic ? !workspace.output_variants?.length : !(workspace.drafts.length || project.clips?.length || project.collections?.length || workspace.jobs?.some(job => job.status === 'completed'))
  const whisperSettings = workspace.analysis?.status === 'failed' && !sourceUnusable && failureSettings(failedCode).label === 'Open transcription settings' ? failureSettings(failedCode) : null
  const recoveryAction = failureAction(failedCode)
  const installTranscription = isTranscriptionInstall(recoveryAction) ? recoveryAction : null
  // the generation status covers this round only; earlier rounds' failures stay listed (count from settle)
  const notRedone = workspace.generation?.not_redone_failed_count || 0
  const generationDescription = workspace.generation?.status === 'completed' && notRedone > 0 ? t('This re-run finished. Earlier unfinished versions you can still retry: {{count}}', { count: notRedone })
    : workspace.generation?.status === 'completed' ? t('Ready-to-publish videos are done for the platforms you chose.')
    : workspace.generation?.status === 'partial' ? t('Some videos are done. You can retry the unfinished ones later.')
      : workspace.generation?.status === 'failed' ? t(sourceUnusable ? "This source can't be used" : 'Production did not complete') : t('AI is making videos for the platforms you chose.')
  const variantDraft = (draftId: string) => workspace.drafts.find(draft => draft.id === draftId)
  const variantJob = (jobId?: string) => workspace.jobs.find(job => job.job_id === jobId)
  const latest = useRef(workspace)
  latest.current = workspace
  const [doneNote, setDoneNote] = useState<NoticeKind | null>(null)
  useEffect(() => subscribeCompletionNotice((key, kind) => {
    if (key === project.id) setDoneNote(kind)
  }), [project.id])
  useEffect(() => {
    const clear = () => { if (document.visibilityState === 'visible') void clearCompletionBadge() }
    window.addEventListener('focus', clear)
    document.addEventListener('visibilitychange', clear)
    const stopLeave = followOutputLeave(project.id, () => {
      const current = latest.current
      return {
        createdAt: current.generation?.created_at,
        status: current.generation?.status,
        completed: (current.output_variants || []).filter(item => item.status === 'completed').length,
      }
    })
    return () => {
      window.removeEventListener('focus', clear)
      document.removeEventListener('visibilitychange', clear)
      stopLeave()
    }
  }, [project.id])
  // A retry whose response was lost is still watched: the open generation attempt on the snapshot is the source.
  useEffect(()=>{workflow.adoptOpenAttempt(project.id, workspace)},[project.id, workspace.attempts])
  useEffect(()=>{if(workspace.analysis && workspace.analysis.status!=='running' && project.status!=='completed') onReload()},[workspace.analysis?.status])
  const act = async (key: string, fn:()=>Promise<void>) => {setBusy(key);setActionError('');try{await fn();refresh()}catch(e){setActionError(t(errorText(e)))}finally{setBusy('')}}
  const [progressNow, setProgressNow] = useState(() => Date.now())
  const progressRun = workspace.analysis?.status === 'running' || workspace.jobs.some(job => job.status === 'queued' || job.status === 'running')
  useEffect(() => {
    if (!progressRun) return
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [progressRun])
  const progressFloor = useRef(0)
  const progressKey = `${project.id}:${workspace.analysis?.run_id || ''}:${workspace.analysis?.status || ''}`
  const progressKeySeen = useRef(progressKey)
  if (progressKeySeen.current !== progressKey) {
    progressKeySeen.current = progressKey
    progressFloor.current = 0
  }
  const progressRaw = studioRunProgress({
    analysis: workspace.analysis,
    generation: workspace.generation,
    jobs: workspace.jobs,
    source_duration_sec: typeof sourceDuration === 'number' ? sourceDuration : null,
    concurrency: 1,
  }, progressNow)
  const progressShown = progressRaw && displayedProgress(progressRaw, progressFloor.current)
  if (progressShown) progressFloor.current = progressShown.floor
  const progress = progressShown?.view ?? null
  const etaPosted = useRef('')
  useEffect(() => {
    const initial = progress?.etaInitialMin
    const attempt = workspace.generation?.attempt_id || workspace.analysis?.run_id || ''
    if (!initial || !attempt || etaPosted.current === attempt) return
    etaPosted.current = attempt
    void studioApi.reportEta(project.id, initial).catch(() => undefined)
  }, [progress?.etaInitialMin, workspace.generation?.attempt_id, workspace.analysis?.run_id, project.id])
  useEffect(() => {
    const status = workspace.generation?.status
    if (status !== 'completed' && status !== 'partial') return
    const provider = workspace.generation?.provider || workspace.analysis?.provider
    const sourceMin = typeof sourceDuration === 'number' && sourceDuration > 0 ? sourceDuration / 60 : 0
    const started = workspace.generation?.created_at || workspace.analysis?.created_at
    const stamp = workspace.generation?.attempt_id || started || ''
    if (!provider || !(sourceMin > 0) || !started || !stamp) return
    const storageKey = `autovideoclip.eta.recorded.${project.id}`
    try { if (sessionStorage.getItem(storageKey) === stamp) return } catch { /* ignore */ }
    const elapsed = Math.max(0, (Date.now() - Date.parse(started)) / 1000)
    if (!(elapsed > 0)) return
    try { sessionStorage.setItem(storageKey, stamp) } catch { /* ignore */ }
    recordSuccess({ provider, source_min: sourceMin, elapsed_sec: elapsed })
  }, [workspace.generation?.status, workspace.generation?.attempt_id, workspace.generation?.provider, workspace.generation?.created_at, workspace.analysis?.provider, workspace.analysis?.created_at, sourceDuration, project.id])

  const billable = Math.max(workspace.analysis?.billable_calls_before_failure || 0, workspace.generation?.billable_calls_before_failure || 0)
  const switchOptions = listSwitchModelOptions(aiSettings, {
    connectionId: aiSettings?.analysis?.connection_id,
    model: aiSettings?.analysis?.model,
  })
  const analysisConnection = aiSettings?.connections?.find(c => c.id === aiSettings.analysis?.connection_id)
  const failureInfo = (extra?: { error?: string }) => ({
    error: extra?.error ?? workspace.analysis?.error,
    ...(receiptFailureInfo(workspace.attempts, workspace.analysis?.run_id) || analysisPageFailure(workspace.analysis, workspace.generation)),
    phase: workspace.analysis?.phase,
    billable_calls_before_failure: billable,
    quota_precheck: workspace.generation?.quota_precheck || workspace.analysis?.quota_precheck,
    // N3: pass through so FailureActions can unlock after Test connection clears the stamp.
    quota_exhausted_at: analysisConnection?.quota_exhausted_at,
    connection_count: usableConnectionCount(aiSettings),
    provider: analysisProviderId(aiSettings),
  })
  const switchModelAndRetry = async (choice: { connectionId: string; model: string }) => {
    if (!aiSettings) return
    const saved = await modelSettingsApi.save(forSave(syncFollowingCover(aiSettings, {
      ...aiSettings,
      analysis: {
        connection_id: choice.connectionId,
        model: choice.model,
        capability: aiSettings.analysis?.capability || 'auto',
        model_source: 'user',
      },
    })))
    setAiSettings(saved)
    await studioApi.retry(project.id, { retry_kind: 'switch_model' })
  }
  const createLegacy = (clip: Clip) => act(clip.id, async()=>{const draft=await studioApi.create(project.id,[clip.id],clip.generated_title||clip.title||t("New video"));navigate(`/project/${project.id}/studio/${draft.id}`)})
  const genDone = workspace.generation?.status === 'completed' || workspace.generation?.status === 'partial'
  const [showMorePlatform, setShowMorePlatform] = useState(() => genDone && hasSuccessHistory() && !morePlatformBannerSeen())
  const usedFirstWindow = Boolean(workspace.plan?.overrides?.source_window)
  const [showFullImportTip, setShowFullImportTip] = useState(() => genDone && usedFirstWindow)
  useEffect(() => {
    if (!genDone) return
    if (hasSuccessHistory() && !morePlatformBannerSeen()) setShowMorePlatform(true)
    if (usedFirstWindow) setShowFullImportTip(true)
  }, [genDone, workspace.generation?.status, usedFirstWindow])
  const alreadyPlatforms = workspace.generation?.requested_platforms || []
  const morePlatformId = suggestAnotherPlatform(getLocale(), alreadyPlatforms)
  const morePlatformLabel = morePlatformId === 'xiaohongshu' ? t('Xiaohongshu')
    : morePlatformId === 'youtube_shorts' ? 'Shorts'
    : platformLabel(morePlatformId)
  const startAnotherPlatform = () => {
    dismissMorePlatformBanner()
    setShowMorePlatform(false)
    stashReuseImport({
      platforms: [morePlatformId],
      sourceUrl: project.source_url || undefined,
      sourceMeta: {
        source_url: project.source_url,
        source_file: project.source_file,
        video_path: project.video_path,
        project_id: project.id,
      },
    })
    navigate('/')
  }
  return <div className="studio-results">
    {doneNote && <p className="studio-done-note" role="status">{t(noticeCopy(doneNote))}</p>}
    {showMorePlatform && genDone && <div className="studio-more-platform" role="status" data-testid="t1-more-platform">
      <p className="studio-muted">{morePlatformId === 'xiaohongshu' ? t('You can also make a Xiaohongshu version') : morePlatformId === 'youtube_shorts' ? t('You can also make a Shorts version') : t('You can also make a {{platform}} version', { platform: morePlatformLabel })}</p>
      <div className="studio-actions">
        <Btn size="sm" variant="cta" onClick={startAnotherPlatform}>{t('Make another with the same source')}</Btn>
        <Btn size="sm" variant="text" onClick={() => { dismissMorePlatformBanner(); setShowMorePlatform(false) }}>{t('Got it')}</Btn>
      </div>
    </div>}
    {showFullImportTip && genDone && usedFirstWindow && <div className="studio-more-platform" role="status" data-testid="t2-full-import-tip">
      <p className="studio-muted">{t('Setup looks good — you can re-import the full video')}</p>
      <div className="studio-actions">
        <Btn size="sm" variant="cta" onClick={() => { setShowFullImportTip(false); navigate('/') }}>{t('Re-import full video')}</Btn>
        <Btn size="sm" variant="text" onClick={() => setShowFullImportTip(false)}>{t('Got it')}</Btn>
      </div>
    </div>}
    {managed && !automatic && !hideLegacy && <div className="studio-row"><span className="studio-muted">{sourceDuration!=null?`${t('Source {{duration}}', { duration: fmtDuration(sourceDuration) })} · `:''}{workspace.analysis?.status==='awaiting_confirmation'?t("New plan awaiting confirmation. Existing results are kept."):t("Results and editing")}</span><Btn size="sm" disabled={workspace.analysis?.status==='running'} onClick={()=>{ noteLegacy('plan_adjust'); navigate(`/import/${project.id}`) }}>{workspace.analysis?.status==='awaiting_confirmation'?t("Continue plan confirmation"):t("Adjust production plan")}</Btn></div>}
    {automatic && workspace.generation?.skipped?.map(item=><p key={item.strategy_id} className="studio-output-hint">{t('No {{platform}} version: {{reason}}', { platform: platformLabel(item.strategy_id), reason: t(item.reason) })}</p>)}
    {!(workspace.analysis?.status==='awaiting_confirmation' && !workspace.drafts.length && !project.clips?.length && !project.collections?.length) && <Section title={t("Clips and videos")} count={automatic ? (workspace.output_variants?.length || 0) : workspace.drafts.length+(project.clips?.length||0)+(project.collections?.length||0)} description={automatic ? generationDescription : visual?t("Candidates are editable drafts. Export to download the finished video with styling."):t("Find clips and collections here. Download directly or save as a video draft.")} right={<div className="studio-actions"><Btn size="sm" onClick={()=>setHistory(true)}>{t("Export history")}</Btn>{!managed && !hideLegacy && <Btn size="sm" onClick={()=>{ noteLegacy('collection'); onCreateCollection() }}>{t("New collection")}</Btn>}</div>}>
      {progress && <div className="ac-empty studio-processing">
        <div className="studio-progress" role="progressbar" aria-busy={progress.indeterminate || undefined} aria-valuenow={progress.indeterminate ? undefined : progress.percent} aria-valuemin={progress.indeterminate ? undefined : 0} aria-valuemax={progress.indeterminate ? undefined : 100} aria-valuetext={t(progress.label)}>
          <div className="studio-progress-track"><div className={`studio-progress-fill${progress.indeterminate ? ' studio-progress-fill--busy' : ''}`} style={progress.indeterminate ? undefined : { width: `${progress.percent}%` }} /></div>
          <div className="studio-progress-meta"><span>{t(progress.label)}</span>{!progress.indeterminate && <span className="ac-mono">{progress.percent}%</span>}</div>
        </div>
        <p className="studio-muted">{[
          progress.elapsedMinutes == null ? '' : progress.elapsedMinutes < 1 ? t('Less than a minute so far') : t('About {{minutes}} minutes so far', { minutes: progress.elapsedMinutes }),
          progress.etaOverrun ? t('Taking longer than expected, but still running') : (progress.etaMin != null ? t('About {{minutes}} min left', { minutes: progress.etaMin }) : ''),
          progress.modelBudget ? t('Model steps are capped at about 20 minutes') : '',
          progress.approximate ? t('Progress is an estimate; the stage is what counts') : '',
        ].filter(Boolean).join(' · ')}</p>
        {progress.canLeave && <p className="studio-muted">{t('You can minimize to the tray; we will notify you when done')}</p>}
        {progress.detail && progress.detail !== progress.label && <p className="studio-muted">{t(progress.detail)}</p>}
        {workspace.analysis?.phase==='screening'&&!automatic?t("Confirm the content types after identification. Editing has not started."):t("Drafts will appear here when ready. You can work on other projects meanwhile.")}
      </div>}
      {workspace.analysis?.status==='failed' && sourceUnusable && <div className="ac-empty" role="alert"><b>{t("This source can't be used")}</b><FailureCopy info={failureInfo()} message={analysisFailureText(workspace.analysis.error, workspace.analysis, workspace.generation)} /><div className="studio-actions"><Btn disabled={!!busy} onClick={()=>navigate('/')}>{t("Use another video")}</Btn>{!hideLegacy && <Btn disabled={!!busy} onClick={()=>{ noteLegacy('plan_adjust'); navigate(`/import/${project.id}`) }}>{t("Adjust production plan")}</Btn>}</div></div>}
      {cookieRecovery && <div className="ac-empty" role="alert"><b>{t("Production did not complete")}</b><FailureCopy info={failureInfo()} message={analysisFailureText(workspace.analysis?.error, workspace.analysis, workspace.generation)} /><p className="studio-muted">{t("Next: go back to import, choose a signed-in browser, then generate again.")}</p><div className="studio-actions"><Btn variant="cta" disabled={!!busy} onClick={()=>navigate(stageBrowserCookieRecovery(project.source_url))}>{t("Choose a signed-in browser")}</Btn>{canRetryAnalysis && <Btn disabled={!!busy} loading={busy==='retry-analysis'} onClick={()=>act('retry-analysis', async()=>{await studioApi.retry(project.id)})}>{t("Retry")}</Btn>}<Btn disabled={!!busy} onClick={()=>navigate('/')}>{t("Use another video")}</Btn></div></div>}
      {workspace.analysis?.status==='failed' && whisperSettings && !cookieRecovery && <div className="ac-empty" role="alert"><b>{t("Production did not complete")}</b><FailureCopy info={failureInfo()} message={analysisFailureText(workspace.analysis.error, workspace.analysis, workspace.generation)} /><div className="studio-actions">{installTranscription && <Btn variant="cta" disabled={!!busy} onClick={()=>navigate(installTranscription.destination)}>{t(installTranscription.label)}</Btn>}{canRetryAnalysis && <Btn disabled={!!busy} loading={busy==='retry-analysis'} onClick={()=>act('retry-analysis', async()=>{await studioApi.retry(project.id)})}>{t("Retry")}</Btn>}{!installTranscription && <Btn disabled={!!busy} onClick={()=>navigate(whisperSettings.to)}>{t(whisperSettings.label)}</Btn>}{!hideLegacy && <Btn disabled={!!busy} onClick={()=>{ noteLegacy('plan_adjust'); navigate(`/import/${project.id}`) }}>{t("Adjust production plan")}</Btn>}</div></div>}
      {workspace.analysis?.status==='failed' && !sourceUnusable && !whisperSettings && !cookieRecovery && <div className="ac-empty"><b>{t("Production did not complete")}</b>
        <FailureActions info={failureInfo()}
          canRetry={canRetryAnalysis}
          returnedFromSettings={returnedFromSettings} busy={!!busy} retrying={busy==='retry-analysis'}
          repeatFailure={workspace.generation?.repeat_failure}
          resumePoint={workspace.resume_point}
          switchOptions={switchOptions}
          onSwitchModel={choice => act('retry-analysis', async () => { await switchModelAndRetry(choice) })}
          onRetry={()=>act('retry-analysis', async()=>{await studioApi.retry(project.id, { retry_kind: 'same' })})}
          onFreshRetry={()=>act('retry-analysis', async()=>{await studioApi.retry(project.id, { retry_kind: 'same', fresh: true })})}
          onSettings={destination=>navigate(settingsReturnUrl(destination, project.id))}>
          {!weakLocalTimelineFailure(failureInfo().error, failureInfo().error_code) && <Btn disabled={!!busy} onClick={()=>navigate('/settings?section=ai')}>{t("Model settings")}</Btn>}{!hideLegacy && <Btn disabled={!!busy} onClick={()=>{ noteLegacy('plan_adjust'); navigate(`/import/${project.id}`) }}>{t("Adjust production plan")}</Btn>}
        </FailureActions></div>}
      {error && <div className="ac-empty"><b>{t("Failed to load video drafts")}</b>{t(error)}<Btn onClick={refresh}>{t("Retry")}</Btn></div>}
      <div className="ac-grid-3 studio-result-grid">{automatic ? [...(workspace.output_variants || [])].sort((a, b) => Number(a.status === 'on_demand') - Number(b.status === 'on_demand')).map(variant => <OutputVariantCard key={variant.id} projectId={project.id} variant={variant} draft={variantDraft(variant.draft_id)} job={variantJob(variant.render_job_id)} billable={billable > 0} recommendation={{ recommended_template: workspace.generation?.recommended_template, accepted_recommendation: workspace.generation?.accepted_recommendation }} onRetry={()=>act(`retry-${variant.id}`, async()=>{await studioApi.retryOutputVariant(project.id, variant.id)})} onProduce={()=>act(`produce-${variant.id}`, async()=>{await studioApi.produceOutputVariant(project.id, variant.id, variant.strategy_id)})}/>) : workspace.drafts.map(d => <DraftResultCard key={d.id} projectId={project.id} draft={d} jobs={workspace.jobs}
        onEdit={()=>navigate(`/project/${project.id}/studio/${d.id}`)} allowExport={!hideLegacy} onExport={()=>{ noteLegacy('export_confirm'); setExporting(d) }} onHistory={()=>setHistory(true)} />)}{loaded && !automatic && children}</div>
      {!loading&&!error&&!workspace.drafts.length&&!project.clips?.length&&!project.collections?.length&&workspace.analysis?.status!=='running'&&!sourceUnusable&&!cookieRecovery&&<div className="ac-empty"><b>{t("No videos available yet")}</b>{managed?t("Try again or adjust the plan."):t("Adjust the minimum score and retry processing.")}</div>}
    </Section>}
    {actionError&&<p className="studio-error" role="alert">{actionError}</p>}
    <details className="studio-details studio-source-details"><summary>{visual?t("Highlight clips"):t("Source clips")} <span className="ac-mono">{workspace.events.length+(project.clips?.length||0)}</span>{t("· Choose when replacing scenes")}</summary>
      {workspace.analysis?.coverage && <p className="studio-muted">{workspace.analysis.coverage.note} {t('Initial full-video sampling interval: about {{seconds}} s.', { seconds: workspace.analysis.coverage.sample_interval.toFixed(1) })}</p>}
      {workspace.events.map(e=><div className="studio-source-row" key={e.id}><div><b>{e.label}</b><p className="studio-muted">{t('{{start}}–{{end}} s', { start: e.start.toFixed(1), end: e.end.toFixed(1) })} · {e.evidence}</p></div><div className="studio-actions"><Btn size="sm" onClick={()=>setPreview(e)}>{t("View source")}</Btn><Btn size="sm" disabled={!!busy} loading={busy===e.id} onClick={()=>act(e.id,async()=>{const d=await studioApi.eventDraft(project.id,e.id);navigate(`/project/${project.id}/studio/${d.id}`)})}>{t("Use in new video")}</Btn></div></div>)}
      {project.clips?.map(c=><div className="studio-source-row" key={c.id}><div><b>{c.generated_title||c.title}</b><p className="studio-muted">{c.start_time}–{c.end_time}</p></div><Btn size="sm" disabled={!!busy} loading={busy===c.id} onClick={()=>createLegacy(c)}>{t("Use in new video")}</Btn></div>)}
    </details>
    <details className="studio-details studio-source-details"><summary>{t("Source media")}</summary><video controls preload="none" className="studio-source-video" src={studioApi.source(project.id)}/></details>
    <ExportHistory projectId={project.id} jobs={workspace.jobs} open={history} onClose={()=>setHistory(false)}/>
    <Dialog open={!!preview} title={preview?.label||t("Source video")} onClose={()=>setPreview(null)}>{preview&&<video key={preview.id} controls preload="metadata" className="studio-source-video" src={`${studioApi.source(project.id)}#t=${preview.start},${preview.end}`}/>}<p className="studio-muted">{preview?.evidence}</p></Dialog>
    <Dialog open={!!exporting} title={t("Export video")} onClose={()=>!busy&&setExporting(null)} description={t("Render with current draft settings, then download from export history.")} footer={<div className="studio-actions"><Btn disabled={!!busy} onClick={()=>setExporting(null)}>{t("Close")}</Btn><Btn variant="cta" disabled={!!busy} loading={busy==='export'} onClick={()=>exporting&&act('export',async()=>{await studioApi.export(project.id,exporting.id,exporting.revision, exporting);setExporting(null);setHistory(true)})}>{t("Confirm export")}</Btn></div>}><p>{exporting?.title}</p><p className="studio-muted">{exporting?.aspect==='portrait'?t("9:16 portrait"):exporting?.aspect==='landscape'?t("16:9 landscape"):t("Original aspect ratio")} · MP4 · 30 fps</p>{actionError&&<p className="studio-error">{actionError}</p>}</Dialog>
  </div>
}
