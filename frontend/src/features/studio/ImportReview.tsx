import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Btn } from '../../ui'
import { useWorkspace } from './useWorkspace'
import { studioApi, errorText } from './api'
import PlanSummary from './PlanSummary'
import { sourceFailure } from './importReadiness'
import { browserCookieRecovery, stageBrowserCookieRecovery } from './browserCookieRecovery'
import { analysisFailureText } from './failureAction'
import { defaultImportOptions } from './types'
import './studio.css'

export default function ImportReview() {
  useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { workspace, error, refresh } = useWorkspace(id)
  const [actionError,setActionError]=useState('')
  const [busy,setBusy]=useState(false)
  const retry=async()=>{if(!id)return;setBusy(true);setActionError('');try{await studioApi.correctPlan(id,{...defaultImportOptions,...workspace.plan?.overrides});refresh()}catch(e){setActionError(t(errorText(e)))}finally{setBusy(false)}}
  const running=workspace.analysis?.status==='running'
  const producing=running&&workspace.analysis?.phase==='production'
  if(!id)return null
  return <main className="ac-page studio-import-review">
    <button className="ac-back" onClick={()=>navigate('/')}>{t("‹ Projects")}</button>
    <h1 className="ac-title">{t("Confirm what to make")}</h1>
    <p className="studio-muted">{t("AI reviews the footage and suggests a plan; editing only starts after you confirm.")}</p>
    {running?<div className="studio-import-box"><h2>{producing?t("Production has started"):t("Quickly identifying the source")}</h2><p className="studio-muted">{producing?t("Open the project to see progress."):t("We identify suitable content types first. Editing starts only after you confirm.")}</p>{producing&&<Btn variant="cta" onClick={()=>navigate(`/project/${id}`)}>{t("View production progress")}</Btn>}</div>:<PlanSummary projectId={id} plan={workspace.plan} status={workspace.analysis?.status} onChanged={refresh} onStarted={()=>navigate(`/project/${id}`)}/>}
    {(error||actionError||workspace.analysis?.status==='failed')&&<p role="alert" className="studio-error">{t(actionError||error||analysisFailureText(workspace.analysis?.error, workspace.analysis, workspace.generation))}</p>}
    {!running&&workspace.analysis?.status==='failed'&&browserCookieRecovery(workspace.analysis.error_code, workspace.analysis.error)&&<p className="studio-muted">{t("Next: go back to import, choose a signed-in browser, then generate again.")}</p>}
    {!running&&workspace.analysis?.status==='failed'&&browserCookieRecovery(workspace.analysis.error_code, workspace.analysis.error)?<div className="studio-actions"><Btn variant="cta" size="sm" onClick={()=>navigate(stageBrowserCookieRecovery())}>{t("Choose a signed-in browser")}</Btn><Btn size="sm" onClick={()=>navigate('/')}>{t("Use another video")}</Btn></div>:!running&&workspace.analysis?.status==='failed'&&sourceFailure(workspace.analysis.error_code)?<div className="studio-actions"><Btn size="sm" onClick={()=>navigate('/')}>{t("Use another video")}</Btn></div>:!running&&(workspace.analysis?.status==='failed'||!workspace.plan)&&<div className="studio-actions"><Btn size="sm" loading={busy} onClick={retry}>{t("Identify again")}</Btn><Btn size="sm" onClick={()=>navigate('/settings?section=ai')}>{t("Model settings")}</Btn></div>}
    {workspace.plan&&<details className="studio-details"><summary>{t("View imported source")}</summary><video controls preload="metadata" className="studio-source-video" src={studioApi.source(id)}/></details>}
  </main>
}
