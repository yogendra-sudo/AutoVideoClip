import { useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import { t } from '../../i18n'
import { Btn } from '../../ui'
import { studioApi } from './api'
import { copyText } from './outputShare'
import { isDesktopDownload, saveLocalFile, saveStudioExport } from './nativeDownload'
import type { OutputVariant, PostCopy } from './types'
import { studioDownloadRequested, observeStudioDownload, type VariantProperties } from '../../analytics/studio'
import { flagAssigned, useFlag } from '../../analytics/flags'
import { trackAutoChoiceOverridden } from '../../analytics/studio'
import { markOutputTaken } from './overrides'
import { captionWithCredit, savePublishPack } from './publishPack'

const LANDSCAPE = new Set(['bilibili', 'youtube_long', 'original'])

/** Post copy as it is pasted into a platform: title, description, then the hashtags. */
export function postCaption(post: PostCopy) {
  return [post.title, post.description, post.tags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n')
}

/** Ready-to-publish copy and cover of one output: read, edit, copy, export as a bundle, redo the cover with AI. */
export default function PublishKit({ projectId, variant, analytics = {}, coverStamp, onCoverChanged, onCopied, onCombined }: { projectId: string; variant: OutputVariant; analytics?: VariantProperties; coverStamp: number; onCoverChanged: () => void; onCopied: () => void; onCombined?: () => void }) {
  // A saved edit shows right away: the workspace stops polling once every output is done.
  const [saved, setSaved] = useState<PostCopy | null>(null)
  useEffect(() => setSaved(null), [variant.post])
  const post = saved || variant.post
  const [editing, setEditing] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [draft, setDraft] = useState<PostCopy | null>(post || null)
  const [saving, setSaving] = useState(false)
  const [redesigning, setRedesigning] = useState(false)
  const [packing, setPacking] = useState(false)
  const combined = useFlag('publish_pack_v2') === 'combined'
  useEffect(() => { if (!editing) setDraft(post || null) }, [post, editing])
  if (!post || !draft) return null
  const save = async () => {
    setSaving(true)
    try {
      setSaved(await studioApi.updateVariantPost(projectId, variant.id, draft))
      if (draft.title !== post.title) trackAutoChoiceOverridden({ field: 'title', stage: 'results_chip' }, flagAssigned('track_overrides'))
      setEditing(false)
      message.success(t('Copy saved'))
    } catch {
      message.error(t('Could not save, please try again'))
    } finally { setSaving(false) }
  }
  const copy = async () => {
    if (await copyText(postCaption(post))) { markOutputTaken(projectId); onCopied(); message.success(t('Post copy copied')) }
    else message.error(t('Could not copy. Try again later.'))
  }
  const kitPath = `/studio/${projectId}/output-variants/${variant.id}/kit`
  const coverUrl = studioApi.variantCover(projectId, variant.id, coverStamp)
  const noteCover = combined && variant.strategy_id === 'xiaohongshu'
  const saveCombined = async () => {
    if (!variant.render_job_id || packing) return
    if (!(await copyText(captionWithCredit(postCaption(post), variant.strategy_id)))) { message.error(t('Could not copy. Try again later.')); return }
    markOutputTaken(projectId)
    onCombined?.()
    setPacking(true)
    const coverPath = `/studio/${projectId}/output-variants/${variant.id}/cover`
    try {
      const mode = await savePublishPack({
        desktop: isDesktopDownload(),
        strategyId: variant.strategy_id,
        hasCover: !!variant.cover,
        saveVideo: () => saveStudioExport(projectId, variant.render_job_id!),
        saveCover: () => saveLocalFile(coverPath),
        requestDownload: artifact => studioDownloadRequested(projectId, variant.render_job_id, { ...analytics, strategy_id: variant.strategy_id, artifact_type: artifact }),
        observeDownload: (action, artifact) => observeStudioDownload(action, projectId, variant.render_job_id, { ...analytics, strategy_id: variant.strategy_id, artifact_type: artifact }),
        openBrowser: kind => {
          const link = document.createElement('a')
          link.href = kind === 'video' ? studioApi.video(projectId, variant.render_job_id!, true) : coverUrl
          link.download = ''
          document.body.appendChild(link)
          link.click()
          link.remove()
        },
      })
      message.success(t(mode === 'native' ? 'Caption copied. The video and cover are saved.' : 'Post copy copied'))
    } catch {
      message.error(t('Download failed. Try again later.'))
    } finally { setPacking(false) }
  }
  const exportKit = async (event: React.MouseEvent) => {
    markOutputTaken(projectId)
    const props = { ...analytics, strategy_id: variant.strategy_id, artifact_type: 'publish_kit' as const }
    if (!isDesktopDownload()) { studioDownloadRequested(projectId, variant.render_job_id, props); return }
    event.preventDefault()
    try { await observeStudioDownload(() => saveLocalFile(kitPath), projectId, variant.render_job_id, props); message.success(t('Publish kit saved to Downloads')) } catch { message.error(t('Download failed. Try again later.')) }
  }
  const redesign = async () => {
    if (!variant.render_job_id) return
    setRedesigning(true)
    try {
      let job = await studioApi.redesignVariantCover(projectId, variant.id)
      let done = job.status === 'completed'
      for (let tries = 0; !done && tries < 90; tries++) {
        if (job.status === 'failed') throw new Error(job.error || 'failed')
        await new Promise(resolve => setTimeout(resolve, 2000))
        if (!mounted.current) return
        job = await studioApi.variantCoverJob(projectId, variant.id)
        done = job.status === 'completed'
      }
      if (!mounted.current) return
      if (job.status === 'failed') throw new Error(job.error || 'failed')
      if (!done) { message.info(t('The AI cover is still being made; refresh in a moment.')); return }
      onCoverChanged()
      message.success(t('Cover redesigned with AI'))
    } catch {
      if (mounted.current) message.error(t('The AI cover was not created; check the image model in Settings'))
    } finally { if (mounted.current) setRedesigning(false) }
  }
  return <div className="studio-post">
    {editing ? <div className="studio-post-edit">
      <input className="ac-input" aria-label={t('Title')} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/>
      <textarea className="ac-input ac-textarea" aria-label={t('Description')} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/>
      <input className="ac-input" aria-label={t('Hashtags')} value={draft.tags.join(' ')} placeholder={t('Hashtags, separated by spaces')}
        onChange={event => setDraft({ ...draft, tags: event.target.value.split(/[\s,，#]+/).filter(Boolean) })}/>
      <div className="studio-post-actions"><Btn variant="text" onClick={() => { setDraft(post); setEditing(false) }}>{t('Cancel')}</Btn><Btn size="sm" loading={saving} onClick={() => void save()}>{t('Save')}</Btn></div>
    </div> : <>
      <div className="studio-post-body">
        {variant.cover && <a className={`studio-post-cover${noteCover ? ' studio-post-cover--note' : LANDSCAPE.has(variant.strategy_id) ? ' studio-post-cover--wide' : ''}`} href={coverUrl} target="_blank" rel="noreferrer" title={t('View cover')}>
          <img src={coverUrl} alt={t('Cover')}/>
        </a>}
        <div className="studio-post-text">
          <h2 className="studio-post-title" title={post.title}>{post.title}</h2>
          {post.description && <p className="studio-post-desc">{post.description}</p>}
          {post.tags.length > 0 && <p className="studio-post-tags" title={post.tags.map(tag => `#${tag}`).join(' ')}>{post.tags.map(tag => `#${tag}`).join(' ')}</p>}
        </div>
      </div>
      <div className="studio-post-actions">
        {combined && variant.status === 'completed' && variant.render_job_id
          ? <Btn className="studio-pack-action" loading={packing} onClick={() => saveCombined()}>{t('Copy the caption and save the video and cover')}</Btn>
          : <Btn variant="text" onClick={() => void copy()}>{t('Copy post text')}</Btn>}
        <Btn variant="text" onClick={() => setEditing(true)}>{t('Edit copy')}</Btn>
        {!combined && variant.status === 'completed' && <a className="studio-link" href={studioApi.variantKit(projectId, variant.id)} download onClick={event => void exportKit(event)}>{t('Export publish kit')}</a>}
        {variant.status === 'completed' && <Btn variant="text" loading={redesigning} onClick={() => void redesign()}>{t('Redesign cover with AI')}</Btn>}
      </div>
    </>}
  </div>
}
