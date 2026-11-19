import { useTranslation } from 'react-i18next'
import { getLocale } from '../../i18n'
import StudioDownloadLink from './StudioDownloadLink'
import { Link } from 'react-router-dom'
import { RenderJob } from './types'
import { Dialog, ProgressLine } from '../../ui'
export default function ExportHistory({ projectId, jobs, open, onClose }: { projectId: string; jobs: RenderJob[]; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  return <Dialog open={open} onClose={onClose} title={t('Export history')} description={t('Each export keeps its video and draft version.')}>
    {!jobs.length && <p className="studio-muted">{t('No exports yet. Select a draft to export.')}</p>}
    {jobs.map(job => <div key={job.job_id} className="studio-history-row"><b>{job.title}</b><span className="studio-muted">V{job.revision} · {new Date(job.created_at).toLocaleString(getLocale())}</span>
      {job.status === 'completed' ? <><StudioDownloadLink className="ac-btn" projectId={projectId} jobId={job.job_id}/><Link className="studio-link" to={`/project/${projectId}/publish/studio-${job.job_id}`}>{t('Publish this version')}</Link>{job.result?.warnings?.map(w => <p className="studio-muted" key={w}>{t(w)}</p>)}</> : job.status === 'failed' ? <p className="studio-error">{t(job.error || '')}</p> : <><ProgressLine percent={job.percent} /><span className="studio-muted">{t(job.status === 'queued' ? 'Queued' : 'Rendering')} · {job.percent}%</span></>}
    </div>)}
  </Dialog>
}
