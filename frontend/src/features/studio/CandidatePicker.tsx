import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Btn, Dialog, fmtDuration } from '../../ui'
import { studioApi, errorText } from './api'
import { Candidate, CandidateList } from './types'

interface Props {
  projectId: string
  mode: 'append' | 'replace'
  onClose: () => void
  onChoose: (candidate: Candidate) => void
}

export default function CandidatePicker({ projectId, mode, onClose, onChoose }: Props) {
  useTranslation()
  const [data, setData] = useState<CandidateList | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<Candidate | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    studioApi.candidates(projectId, controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setSelected(result.candidates[0] || null) }
    }).catch(e => { if (!controller.signal.aborted) setError(t(errorText(e))) }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [projectId, version])
  useEffect(() => {
    if (video.current && selected) { video.current.pause(); video.current.currentTime = selected.start }
  }, [selected?.id])
  return <Dialog open title={mode === 'append' ? t("Add a scene") : t("Replace current scene")} onClose={onClose}
    description={t("Choose from source highlights and existing clips. Preview before adding; save to apply.")}
    footer={<div className="studio-actions"><Btn onClick={onClose}>{t("Cancel")}</Btn><Btn variant="cta" disabled={!selected || loading || !!error} onClick={() => selected && onChoose(selected)}>{mode === 'append' ? t("Add to video") : t("Replace scene")}</Btn></div>}>
    {loading ? <p className="studio-muted">{t("Loading available clips…")}</p> : error ? <div role="alert"><p className="studio-error">{error}</p><Btn onClick={() => setVersion(v => v + 1)}>{t("Retry")}</Btn></div> : <>
      {selected && <><video ref={video} className="studio-candidate-video" controls preload="metadata" src={studioApi.source(projectId)}
        onLoadedMetadata={() => { if (video.current) video.current.currentTime = selected.start }}
        onTimeUpdate={() => { const v = video.current; if (v && v.currentTime >= selected.end) { v.pause(); v.currentTime = selected.start } }} />
        <p className="studio-muted">{t("Source video")}{' '}{t('{{start}}–{{end}} s', { start: selected.start.toFixed(1), end: selected.end.toFixed(1) })} · {selected.evidence || t("Check scene boundaries and complete gameplay.")}</p></>}
      {data?.warnings.map(w => <p className="studio-muted" key={w}>{t(w)}</p>)}
      {!data?.candidates.length && <p className="studio-muted">{t("No candidates available. Return to the project to analyze again, or adjust existing scenes.")}</p>}
      <div className="studio-candidate-list" role="radiogroup" aria-label={t("Candidate clips")}>{data?.candidates.map(c => <label className="studio-candidate-option" key={c.id}>
        <input type="radio" name="candidate" checked={selected?.id === c.id} onChange={() => setSelected(c)} />
        <span><b>{c.label}</b><small>{c.kind === 'visual' ? t("Visual highlight") : t("Existing clip")} · {t('{{start}}–{{end}} s', { start: c.start.toFixed(1), end: c.end.toFixed(1) })} · {fmtDuration(c.end - c.start)}</small></span>
      </label>)}</div>
    </>}
  </Dialog>
}
