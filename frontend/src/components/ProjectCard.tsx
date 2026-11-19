import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useState, useEffect } from 'react'
import { message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { Project } from '../store/useProjectStore'
import { projectApi } from '../services/api'
import { studioApi } from '../features/studio/api'
import { UnifiedStatusBar } from './UnifiedStatusBar'
import FeedbackDialog from './FeedbackDialog'
import { useSimpleProgressStore } from '../stores/useSimpleProgressStore'
import { Btn, Dialog, Icon, StatusDot } from '../ui'
import { openExternalLink } from '../utils/externalLinks'
import { classifyLlmKeyFailure, llmFailureText } from '../utils/llmFailure'
import { classifySubtitleFailure } from '../utils/subtitleFailure'
import { ADD_PROVIDER_HINT, failureAction, isTranscriptionInstall, presentedFailure, SWITCH_MODEL_LABEL } from '../features/studio/failureAction'
import SwitchModelDialog from '../features/studio/SwitchModelDialog'
import type { SwitchModelOption } from '../features/studio/switchModelOptions'
import { classifyTimelineEmpty, weakLocalTimelineFailure } from '../utils/timelineFailure'
import { isSourceDownloading, readDownloadProgress } from '../utils/downloadProgress'
// import { 
//   getProjectStatusConfig, 
//   calculateProjectProgress, 
//   normalizeProjectStatus,
//   getProgressStatus 
// } from '../utils/statusUtils'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(relativeTime)
dayjs.extend(timezone)
dayjs.extend(utc)
dayjs.locale('zh-cn')

// Tracks which project ids have already had a best-effort auto-start, surviving
// component remounts (the list briefly unmounts while HomePage shows its
// loading spinner). A useRef would reset on every remount and let auto-start
// fire again, which created an infinite onRetry→loadProjects→remount loop.
// Project ids are unique per import, so once-per-session is exactly right.
const autoStartedProjectIds = new Set<string>()

interface ProjectCardProps {
  project: Project
  onDelete: (id: string) => void
  onRetry?: (id: string) => void
  onClick?: () => void
  /** One already-connected replacement. Absent means the card offers model settings. */
  replacement?: { displayName: string } | null
  /** X2: usable connections for SwitchModelDialog (F2 try-run ok). */
  switchOptions?: SwitchModelOption[]
  /** Usable analysis connection count (includes current; drives switch_model vs settings). */
  connectionCount?: number
  /** Catalog provider of the failed analysis binding (sponsor → recharge). */
  analysisProvider?: string | null
  onSwitchAndRetry?: (id: string, choice?: { connectionId: string; model: string }) => void | Promise<void>
}

function suggestLine(name: string) {
  const text = t('Try again with {{model}}.', { model: name })
  const at = text.indexOf(name)
  if (at < 0) return text
  return <>{text.slice(0, at)}<strong>{name}</strong>{text.slice(at + name.length)}</>
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onDelete, onRetry, onClick, replacement, switchOptions, connectionCount, analysisProvider, onSwitchAndRetry }) => {
  useTranslation()
  const navigate = useNavigate()
  const creative = project.settings?.creative || project.processing_config?.creative
  const isVisual = ['highlight', 'promo'].includes(creative?.goal)
  const isManaged = isVisual || !!project.settings?.smart_import || !!project.processing_config?.smart_import
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null)
  const [thumbnailLoading, setThumbnailLoading] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)

  // Get the category labels.
  const isExample = !!(project.settings?.example || project.processing_config?.example)
  const getCategoryInfo = (category?: string) => {
    const categoryMap: Record<string, string> = {
      default: t("Default"), knowledge: t("Education"), business: t("Business and finance"),
      opinion: t("Opinion"), experience: t("Experience sharing"), speech: t("Talks and comedy"),
      content_review: t("Commentary"), entertainment: t("Entertainment"),
    }
    return categoryMap[category || 'default'] || categoryMap.default
  }

  // Manage the thumbnail cache.
  const thumbnailCacheKey = `thumbnail_${project.id}`
  
  // Generate and cache a project video thumbnail.
  useEffect(() => {
    const generateThumbnail = async () => {
      // Prefer the thumbnail provided by the backend.
      if (project.thumbnail) {
        setVideoThumbnail(project.thumbnail)
        console.log(`Using the backend-provided thumbnail: ${project.id}`)
        return
      }
      
      if (!project.video_path) {
        console.log('Project has no video path:', project.id)
        return
      }
      
      // Check the cache.
      const cachedThumbnail = localStorage.getItem(thumbnailCacheKey)
      if (cachedThumbnail) {
        setVideoThumbnail(cachedThumbnail)
        return
      }
      
      setThumbnailLoading(true)
      
      try {
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.preload = 'metadata'
        
        // Try each possible video file path.
        const possiblePaths = [studioApi.source(project.id)]
        
        let videoLoaded = false
        
        for (const path of possiblePaths) {
          if (videoLoaded) break
          
          try {
            const videoUrl = path
            console.log('Trying to load video:', videoUrl)
            
            await new Promise((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error(t("Video loading timed out")))
              }, 10000) // 10-second timeout.
              
              video.onloadedmetadata = () => {
                clearTimeout(timeoutId)
                console.log('Video metadata loaded:', videoUrl)
                video.currentTime = Math.min(5, video.duration / 4) // Use a frame at one-quarter duration or five seconds.
              }
              
              video.onseeked = () => {
                clearTimeout(timeoutId)
                try {
                  const canvas = document.createElement('canvas')
                  const ctx = canvas.getContext('2d')
                  if (!ctx) {
                    reject(new Error(t("Could not access canvas context")))
                    return
                  }
                  
                  // Set an appropriate thumbnail size.
                  const maxWidth = 320
                  const maxHeight = 180
                  const aspectRatio = video.videoWidth / video.videoHeight
                  
                  let width = maxWidth
                  let height = maxHeight
                  
                  if (aspectRatio > maxWidth / maxHeight) {
                    height = maxWidth / aspectRatio
                  } else {
                    width = maxHeight * aspectRatio
                  }
                  
                  canvas.width = width
                  canvas.height = height
                  ctx.drawImage(video, 0, 0, width, height)
                  
                  const thumbnail = canvas.toDataURL('image/jpeg', 0.7)
                  setVideoThumbnail(thumbnail)
                  
                  // Cache the thumbnail.
                  try {
                    localStorage.setItem(thumbnailCacheKey, thumbnail)
                  } catch (e) {
                    // Clear older entries when local storage is low on space.
                    const keys = Object.keys(localStorage).filter(key => key.startsWith('thumbnail_'))
                    if (keys.length > 50) { // Keep at most 50 thumbnail entries.
                      keys.slice(0, 10).forEach(key => localStorage.removeItem(key))
                      localStorage.setItem(thumbnailCacheKey, thumbnail)
                    }
                  }
                  
                  videoLoaded = true
                  resolve(thumbnail)
                } catch (error) {
                  reject(error)
                }
              }
              
              video.onerror = (error) => {
                clearTimeout(timeoutId)
                console.error('Failed to load video:', videoUrl, error)
                reject(error)
              }
              
              video.src = videoUrl
            })
            
            break // Stop after a successful load.
          } catch (error) {
            console.warn(`Failed to load path ${path}:`, error)
            continue // Try the next path.
          }
        }
        
        if (!videoLoaded) {
          console.error('All video paths failed to load.')
        }
      } catch (error) {
        console.error('Failed to generate thumbnail:', error)
      } finally {
        setThumbnailLoading(false)
      }
    }
    
    generateThumbnail()
  }, [project.id, project.video_path, project.thumbnail, thumbnailCacheKey])

  // Source progress is stored in the API settings field (`processing_config`).
  // Reading the wrong field keeps progress at zero and renders every pending state as 5%.
  const downloadProgress = readDownloadProgress(project)
  const isDownloading = isSourceDownloading(project)
  const awaitingConfirmation = project.status === 'pending' && !!(project.settings?.awaiting_confirmation || project.processing_config?.awaiting_confirmation)
  const isImporting = project.status === 'pending' && !isDownloading && !awaitingConfirmation
  // An automatic Studio run that ended failed/partial (including one interrupted by a restart,
  // RC156 #13) is regenerated from the project page (Studio retry → /studio/{id}/analyze, or
  // per-version retry), not by re-running the import screening.
  const studioGeneration = String(project.settings?.studio_generation_status || project.processing_config?.studio_generation_status || '')
  const regenerateInStudio = isManaged && (studioGeneration === 'failed' || studioGeneration === 'partial')
  
  // Normalize the status.
  const normalizedStatus = project.status === 'error' ? 'failed' : 
                          isDownloading ? 'downloading' :
                          isImporting ? 'importing' : project.status
  
  // Debug information.
  console.log('ProjectCard Debug:', {
    projectId: project.id,
    projectStatus: project.status,
    downloadProgress,
    isDownloading,
    isImporting,
    normalizedStatus,
    processingConfig: project.processing_config
  })

  // Automatically start pending projects except while they are downloading.
  // Try each project once and do not show a toast on failure.
  // Including isRetrying in the dependencies and toggling it in handleRetry
  // previously retriggered this effect, repeatedly POSTing /process for Bilibili
  // projects whose downloads were still in progress (400 "Video file not found")
  // and flooding the screen with retry failures. The backend starts the pipeline
  // after download completion, so one best-effort attempt is sufficient.
  useEffect(() => {
    if (
      !isManaged && project.status === 'pending' &&
      !isDownloading &&
      !autoStartedProjectIds.has(project.id)
    ) {
      autoStartedProjectIds.add(project.id)
      // Best-effort, one-shot per project. Uploads (file already present) start
      // processing; Bilibili imports whose download isn't done yet return 400 here —
      // that's fine, the backend auto-starts the pipeline when the download
      // completes. Silent + no onRetry so this never drives the parent's
      // toast/reload path.
      handleRetry({ silent: true })
    }
  }, [project.status, project.id, isDownloading, isManaged])
  
  // Calculate the progress percentage.
  const progressPercent = project.status === 'completed' ? 100 : 
                         project.status === 'failed' ? 0 :
                         isDownloading ? downloadProgress : // Show actual download progress.
                         isImporting ? 5 : // Show 5% while pending to indicate queued work.
                         project.current_step && project.total_steps ? 
                         Math.round((project.current_step / project.total_steps) * 100) : 
                         project.status === 'processing' ? 10 : 0

  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const failedProgress = useSimpleProgressStore((st) => st.getProgress(project.id))
  const failureContext = {
    source: 'failure' as const,
    project_id: project.id,
    stage: failedProgress?.stage,
    error_message: project.error_message || failedProgress?.message || undefined,
    error_code: project.error_code || undefined,
    unexpected_type: (typeof project.unexpected_type === 'string' ? project.unexpected_type
      : typeof project.processing_config?.unexpected_type === 'string' ? project.processing_config.unexpected_type
      : typeof project.settings?.unexpected_type === 'string' ? project.settings.unexpected_type
      : undefined) || undefined,
  }
  const upstream = project.upstream_error_type || project.processing_config?.upstream_error_type || project.settings?.upstream_error_type
  const upstreamType = typeof upstream === 'string' ? upstream : null
  const rawFailure = project.error_message || failedProgress?.message
  const failureText = llmFailureText(rawFailure, project.error_code, upstreamType)
  // The home card must not show only "Processing failed" or "Error": promote bare copy via
  // the same step+reason helper the studio FailureActions use (#491/#500 tip soft).
  const billableRaw = project.processing_config?.billable_calls_before_failure
    ?? project.settings?.billable_calls_before_failure
  const billableCount = Number(billableRaw)
  const failureCard = presentedFailure({
    error: rawFailure,
    error_code: project.error_code,
    upstream_error_type: upstreamType,
    failure_stage: failedProgress?.stage || project.processing_config?.failure_stage || project.settings?.failure_stage,
    phase: project.processing_config?.analysis_phase || project.settings?.analysis_phase,
    // Same plum as studio FailureActions (#491 tip soft): home must pass billable, not only screenshots.
    billable_calls_before_failure: Number.isFinite(billableCount) ? billableCount : undefined,
  }, failureText)
  const timelineEmpty = classifyTimelineEmpty(failureText || failureCard.reason, project.error_code)
  const weakLocalTimeline = weakLocalTimelineFailure(rawFailure || failureCard.reason, project.error_code)
  const llmKeyFailure = !timelineEmpty && classifyLlmKeyFailure(failureText || failureCard.reason, project.error_code)
  const subtitleFailure = timelineEmpty
    ? null
    : classifySubtitleFailure(failureText || failureCard.reason, project.error_code)
  const recoveryAction = failureAction(
    project.error_code,
    upstreamType,
    null,
    connectionCount,
    analysisProvider,
  )
  const installTranscription = isTranscriptionInstall(recoveryAction) ? recoveryAction : null
  const switchModelPrimary = recoveryAction.kind === 'switch_model'
  const addProviderPrimary = recoveryAction.kind === 'settings' && recoveryAction.reason === ADD_PROVIDER_HINT
  const rechargePrimary = recoveryAction.kind === 'recharge'

  const handleRetry = async (opts?: { silent?: boolean; stay?: boolean }) => {
    if (isRetrying) return

    setIsRetrying(true)
    try {
      // Start pending projects; retry projects in all other states.
      // Retry weak local-timeline failures on the home card without opening details.
      if (isManaged && opts?.stay) {
        await studioApi.retry(project.id)
      } else if (isManaged) {
        navigate(regenerateInStudio ? `/project/${project.id}` : `/import/${project.id}`)
        return
      } else if (project.status === 'pending') {
        await projectApi.startProcessing(project.id)
      } else {
        await projectApi.retryProcessing(project.id)
      }
      // Let the parent handle the toast and refresh. Silent auto-starts must not
      // trigger it, or the reload/remount cycle will start the project repeatedly.
      // Notify the parent only for a user-initiated retry.
      if (onRetry && !opts?.silent) {
        onRetry(project.id)
      }
    } catch (error) {
      console.error('Retry failed:', error)
      // Do not interrupt the user when a silent auto-start fails.
      if (!opts?.silent) {
        message.error(t("Retry failed. Try again later."))
      }
    } finally {
      setIsRetrying(false)
    }
  }

  const openSettings = () => navigate('/settings?section=analysis')
  const openSwitchDialog = () => {
    if (!onSwitchAndRetry) return
    if (switchOptions && switchOptions.length) { setSwitchOpen(true); return }
    // Weak-timeline card may only know the recommended display name (no full option list yet).
    if (replacement?.displayName) {
      void (async () => {
        setIsRetrying(true)
        try { await onSwitchAndRetry(project.id) }
        finally { setIsRetrying(false) }
      })()
      return
    }
    openSettings()
  }
  const confirmSwitch = async (choice: { connectionId: string; model: string }) => {
    if (isRetrying || !onSwitchAndRetry) return
    setIsRetrying(true)
    try { await onSwitchAndRetry(project.id, choice) }
    finally { setIsRetrying(false); setSwitchOpen(false) }
  }

  const openProject = () => {
    if (weakLocalTimeline) return
    if (!isManaged && project.status === 'pending') {
      message.warning(t("Importing project. Please wait before opening details."))
      return
    }
    if (!isManaged && project.status === 'processing') {
      message.warning(t("Processing. Open the project after it finishes."))
      return
    }
    if (awaitingConfirmation) navigate(`/import/${project.id}`)
    else if (onClick) onClick()
    else navigate(`/project/${project.id}`)
  }

  return (
    <>
      <article className={`ac-card ac-project-card${weakLocalTimeline ? ' ac-project-card--weak' : ''}`}>
        <div className="ac-card-thumb" style={{ backgroundImage: videoThumbnail ? `url(${videoThumbnail})` : undefined }}>
          {weakLocalTimeline ? (
            <div className="ac-project-open" aria-hidden="true" />
          ) : (
            <button type="button" className="ac-project-open" aria-label={project.name} onClick={openProject}>
              {!videoThumbnail && <Icon.Play size={30} />}
              {thumbnailLoading && <span className="ac-project-thumbnail-loading">{t("Generating thumbnail…")}</span>}
            </button>
          )}
          <div className="ac-project-tags">
            {weakLocalTimeline && <span className="ac-fail-pill"><StatusDot tone="error" label={t("Failed")} /></span>}
            {isExample && <span className="ac-tag ac-tag--sans">{t("Example")}</span>}
            {project.video_category && project.video_category !== 'default' && <span className="ac-tag ac-tag--sans">{getCategoryInfo(project.video_category)}</span>}
          </div>
        </div>
        <div className="ac-card-body">
          {weakLocalTimeline ? (
            <h3 className="ac-card-title">{project.name}</h3>
          ) : (
            <button type="button" className="ac-project-title" onClick={openProject} title={project.name}>
              <span className="ac-card-title">{project.name}</span>
            </button>
          )}
          {!weakLocalTimeline && (awaitingConfirmation ? (
            <div className="ac-project-status"><StatusDot tone="muted" label={t("Waiting for production type confirmation")} /><Btn size="sm" onClick={() => navigate(`/import/${project.id}`)}>{t("View suggestion")}</Btn></div>
          ) : isManaged && project.status === 'processing' ? (
            <StatusDot tone="accent" label={t("Creating · View progress")} />
          ) : (
            <UnifiedStatusBar projectId={project.id} status={normalizedStatus} downloadProgress={progressPercent} />
          ))}
          {normalizedStatus === 'completed' && (
            <div className="ac-project-counts ac-mono">
              {isVisual ? t('Video drafts: {{count}}', { count: project.settings?.studio_draft_count || project.processing_config?.studio_draft_count || 0 }) : <>{t("Clips: {{count}}", { count: project.total_clips || 0 })}<span> · </span>{t("Collections: {{count}}", { count: project.total_collections || 0 })}</>}
            </div>
          )}
          {weakLocalTimeline && (
            <div className="ac-project-weak">
              <p className="ac-project-weak-reason">{t("The current local model could not return a usable timeline.")}</p>
              {replacement?.displayName && <p className="ac-project-weak-suggest">{suggestLine(replacement.displayName)}</p>}
              <div className="ac-project-weak-actions">
                {replacement?.displayName ? (
                  <>
                    <Btn variant="cta" loading={isRetrying} onClick={openSwitchDialog}>{t("Switch and retry")}</Btn>
                    <Btn variant="text" onClick={openSettings}>{t("Other models")}</Btn>
                  </>
                ) : (
                  <>
                    <Btn variant="cta" onClick={openSettings}>{t("Configure model")}</Btn>
                    <Btn variant="text" loading={isRetrying} onClick={() => handleRetry({ stay: true })}>{t("Retry")}</Btn>
                  </>
                )}
              </div>
            </div>
          )}
          {!weakLocalTimeline && normalizedStatus === 'failed' && (
            <div className="ac-empty ac-project-error" role="alert">
              <span className="ac-mono">{t(failureCard.step)}：{t(failureCard.reason)}</span>
              {failureCard.billing ? <p className="ac-project-billing">{t(failureCard.billing)}</p> : null}
            </div>
          )}
          {!weakLocalTimeline && normalizedStatus === 'failed' && (
            <div className="ac-project-recovery">
              {installTranscription && <Btn variant="cta" size="sm" onClick={() => navigate(installTranscription.destination)}>{t(installTranscription.label)}</Btn>}
              {switchModelPrimary && !installTranscription && <Btn variant="cta" size="sm" loading={isRetrying} onClick={openSwitchDialog}>{t(SWITCH_MODEL_LABEL)}</Btn>}
              {addProviderPrimary && !installTranscription && !switchModelPrimary && <Btn variant="cta" size="sm" onClick={() => navigate(recoveryAction.destination)}>{t(recoveryAction.label || 'Open settings')}</Btn>}
              {rechargePrimary && !installTranscription && !switchModelPrimary && <Btn variant="cta" size="sm" onClick={() => {
                const url = (recoveryAction.destination || '').trim()
                if (/^https?:\/\//i.test(url)) void openExternalLink(url)
                else navigate(url || '/settings?section=analysis')
              }}>{t(recoveryAction.label || 'Top up')}</Btn>}
              {subtitleFailure && !installTranscription && <Btn variant="text" size="sm" onClick={() => navigate('/settings?section=speech')}>{t("Transcription")}</Btn>}
              {llmKeyFailure && !switchModelPrimary && !addProviderPrimary && !rechargePrimary && <Btn variant="text" size="sm" onClick={() => navigate('/settings?section=model')}>{t("Model settings")}</Btn>}
              <Btn variant="text" size="sm" loading={isRetrying} onClick={() => handleRetry()}>{regenerateInStudio ? t("Regenerate") : t("Retry")}</Btn>
              <Btn variant="text" size="sm" onClick={() => setFeedbackOpen(true)}>{t("Feedback")}</Btn>
            </div>
          )}
          <div className="ac-card-foot">
            <time className="meta" dateTime={project.created_at}>{dayjs(project.created_at).fromNow()}</time>
            <div className="ac-card-actions">
              {(normalizedStatus === 'processing' || normalizedStatus === 'importing') && !isManaged && <Btn variant="text" size="sm" loading={isRetrying} onClick={() => handleRetry()} title={t("Resubmit task")}><Icon.Refresh /></Btn>}
              <Btn variant="danger" size="sm" onClick={() => setDeleteOpen(true)} title={t("Delete")} aria-label={t("Delete")}><Icon.Trash /></Btn>
            </div>
          </div>
        </div>
      </article>
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t("Delete this project?")} description={t("This cannot be undone")}
        footer={<div className="right"><Btn onClick={() => setDeleteOpen(false)}>{t("Cancel")}</Btn><Btn variant="danger" onClick={() => { setDeleteOpen(false); onDelete(project.id) }}>{t("Confirm")}</Btn></div>} />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} context={failureContext} />
      <SwitchModelDialog
        open={switchOpen}
        options={switchOptions || []}
        busy={isRetrying}
        onClose={() => setSwitchOpen(false)}
        onConfirm={(choice) => void confirmSwitch(choice)}
      />
    </>
  )
}

export default ProjectCard
