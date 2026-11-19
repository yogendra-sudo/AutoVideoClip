import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../i18n'
import { Btn, fmtDuration } from '../../ui'
import { trackOutputShare, type VariantProperties } from '../../analytics/studio'
import { flagAssigned, useFlag } from '../../analytics/flags'
import { clipReason } from './clipReason'
import StudioDownloadLink from './StudioDownloadLink'
import OutputFeedback from './OutputFeedback'
import { Draft, OutputVariant, RenderJob } from './types'
import { studioApi } from './api'
import { outputVariantPublishPath } from './outputVariantPublish'
import { markRatingAsked, shouldAskRating } from './outputShare'
import { platformLabel } from './platformLabel'
import { packagingLabel, packagingFallbackHint } from './packagingLabel'
import PublishKit from './PublishKit'
import './quick-output.css'
import { effectiveSubtitles } from './subtitleState'
import { readableFailure, failureStep, BILLING_GUIDANCE } from './failureAction'

const framingHints: Record<NonNullable<OutputVariant['framing']>, string> = {
  speaker: 'Reframed to follow the speaker',
  full_frame: 'No one to follow on screen, so the full frame is kept',
  full_frame_pending: 'Speaker detection is still being set up, so this one keeps the full frame',
  full_frame_captions: 'The source has built-in captions, so the full frame is kept to avoid cutting them',
}

export default function OutputVariantCard({ projectId, variant, draft, job, onRetry, onProduce, recommendation, billable }: { projectId: string; variant: OutputVariant; draft?: Draft; job?: RenderJob; onRetry: () => void; onProduce: () => void; recommendation?: { recommended_template?: VariantProperties['recommended_template']; accepted_recommendation?: boolean }; billable?: boolean }) {
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const [coverStamp, setCoverStamp] = useState(0)
  const showReason = useFlag('clip_reasons') === true
  const reason = showReason ? clipReason({ evidence: draft?.scenes[0]?.evidence, framing: variant.framing }) : null
  const packaging = draft?.packaging
  const rendered = job?.result?.template_render?.template
  const template = rendered === 'editorial' || rendered === 'street' || rendered === 'news' || rendered === 'cinema' || rendered === 'classic' ? rendered : packaging?.template
  const analytics: VariantProperties = {
    strategy_id: variant.strategy_id, framing: variant.framing, template,
    packaging_style: packaging ? packaging.style || (packaging.template === 'podcast_en' ? 'pop' : 'classic') : undefined,
    outro_applied: job?.result?.outro_applied,
    recommended_template: recommendation?.recommended_template,
    accepted_recommendation: recommendation?.accepted_recommendation,
  }
  const completed = variant.status === 'completed' && job?.status === 'completed'
  const outroEnabled = job?.result?.outro_applied ?? job?.brand_outro ?? variant.branding.outro_enabled
  const failed = variant.status === 'failed'
  const onDemand = variant.status === 'on_demand'
  const duration = job?.result?.duration ?? (draft ? draft.scenes.reduce((sum, scene) => sum + scene.end - scene.start, 0) : 0)
  const packagingHint = packaging ? packagingFallbackHint(packaging, job?.result?.warnings, effectiveSubtitles(draft)) : ''
  const productionDetails = [outroEnabled ? t('Includes “Made with AutoClip” end card') : t('No brand end card'), packaging && packagingLabel(packaging), variant.framing && t(framingHints[variant.framing])].filter(Boolean).join(' · ')
  const downloaded = () => {
    if (!shouldAskRating(projectId)) return
    markRatingAsked(projectId)
    setAsking(true)
  }
  return <article className="ac-card studio-output-card" aria-label={variant.post?.title || draft?.title || t('Preparing video')}>
    <div className="studio-variant-thumb" title={productionDetails}>{completed && variant.render_job_id ? <video className="studio-variant-video" controls preload="metadata" poster={variant.cover ? studioApi.variantCover(projectId, variant.id, coverStamp) : undefined} src={studioApi.video(projectId, variant.render_job_id)}/> : <span className="play">▷</span>}<span className="ac-tag ac-tag--tl">{platformLabel(variant.strategy_id)}</span>{duration > 0 && <span className="ac-tag ac-tag--br">{fmtDuration(duration)}</span>}{!completed && <span className="ac-tag studio-output-progress" role="status">{failed ? t('Generation failed') : onDemand ? t('Backup clip · generate when needed') : variant.status === 'preparing' ? t('Preparing framing and packaging') : job?.status === 'running' ? t('Generating') : t('Queued')}</span>}</div>
    <div className="ac-card-body">
      {!variant.post && <h2 className="ac-card-title">{draft?.title || t('Preparing video')}</h2>}
      {variant.trimmed_to_sec && <p className="studio-output-hint">{t('Platform limit is {{seconds}}s; trimmed at the end of a sentence', { seconds: variant.trimmed_to_sec })}</p>}
      {packagingHint && <p className="studio-output-hint">{packagingHint}</p>}
      {reason && <p className="studio-clip-reason">{reason.kind === 'evidence' ? reason.evidence : t(reason.key)}</p>}
      <PublishKit projectId={projectId} variant={variant} analytics={analytics} coverStamp={coverStamp} onCoverChanged={() => setCoverStamp(Date.now())} onCopied={() => trackOutputShare(projectId, { share_target: 'copy_caption', ...analytics })} onCombined={() => { if (flagAssigned('publish_pack_v2')) trackOutputShare(projectId, { share_target: 'copy_and_save', ...analytics }) }}/>
      {failed && <p className="studio-output-hint studio-error">{t(failureStep(undefined, 'rendering', variant.error_code))}：{t(readableFailure(variant.error || job?.error, variant.error_code))}</p>}
      {failed && billable && <p className="studio-billing">{t(BILLING_GUIDANCE)}</p>}
      <div className="ac-card-foot"><div className="ac-card-actions">
        {draft && <Btn variant="text" onClick={() => navigate(`/project/${projectId}/studio/${draft.id}?variant=${encodeURIComponent(variant.id)}`)}>{t('Preview and edit')}</Btn>}
        {failed && <Btn variant="text" onClick={onRetry}>{t('Retry this one')}</Btn>}
        {onDemand && <Btn variant="text" onClick={onProduce}>{t('Generate this one')}</Btn>}
        {completed && variant.render_job_id && <Btn variant="text" onClick={() => navigate(outputVariantPublishPath(projectId, variant))}>{t('Publish')}</Btn>}
        {completed && variant.render_job_id && <StudioDownloadLink className="studio-output-download" projectId={projectId} jobId={variant.render_job_id} onSaved={downloaded} variant={analytics}/>}
      </div></div>
      {asking && <OutputFeedback projectId={projectId} variant={analytics} onDone={() => setAsking(false)}/>}
    </div>
  </article>
}
