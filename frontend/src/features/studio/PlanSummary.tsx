import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { useEffect, useState } from 'react'
import { Btn, Dialog, Row, Segmented, fmtDuration } from '../../ui'
import { AnalysisMode, Goal, ImportOptions, ImportPlan, defaultImportOptions, goalLabels, languages } from './types'
import ImportPreferences from './ImportPreferences'
import { studioApi, errorText, errorCode } from './api'
import { useNavigate } from 'react-router-dom'
import { speechApi } from '../../services/api'
import TranscriptionGatePrompt from './TranscriptionGatePrompt'
import { isRecoveryCode, probeConfig } from './transcriptionRecovery'
import { useTranscriptionRecovery } from './useTranscriptionRecovery'

const contentLabels: Record<string,string> = {gameplay:'Gameplay recording',talk:'Talk / interview',sport:'Sports',vlog:'Vlog',mixed:'Mixed content',other:'Video content'}
const choices: {goal:Goal;description:string}[] = [
  {goal:'content',description:'Extract complete clips based on speech and meaning'},
  {goal:'highlight',description:'Find highlights and preserve the key action'},
  {goal:'promo',description:'Create promo drafts with different openings from real footage'},
]
export default function PlanSummary({projectId, plan, status, onChanged, onStarted}: {projectId:string;plan?:ImportPlan;status?:string;onChanged:()=>void;onStarted?:()=>void}) {
  useTranslation()
  const [analysisMode,setAnalysisMode]=useState<AnalysisMode>('subtitle')
  const [capability,setCapability]=useState<{visual_analysis:boolean;visual_model:string}|null>(null)
  useEffect(()=>{let live=true;studioApi.capabilities().then(v=>{if(live)setCapability(v)}).catch(()=>{if(live)setCapability(null)});return()=>{live=false}},[])
  const [open,setOpen]=useState(false)
  const [value,setValue]=useState<ImportOptions>({...defaultImportOptions})
  const [selected,setSelected]=useState<Goal[]>([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  // #418 rewrite: a coded gate 422 on confirm opens the same recovery controller as the import page (by code, never text).
  const [recovery,recover]=useTranscriptionRecovery({readiness:signal=>studioApi.readinessProbe(signal),getRuntimeStatus:signal=>speechApi.getRuntimeStatus(probeConfig(signal)),getModels:signal=>speechApi.getModels(probeConfig(signal)),installRuntime:signal=>speechApi.installRuntime({signal}),downloadModel:(model,signal)=>speechApi.downloadModel(model,{signal})},{onReady:()=>{recover.close();void start()}})
  const navigate=useNavigate()
  const running=status==='running'
  const awaiting=status==='awaiting_confirmation'
  useEffect(()=>{setAnalysisMode(plan?.recommended_analysis || 'subtitle');setSelected(plan?.suggested_goals || []);setValue({...defaultImportOptions,...plan?.overrides});setError('')},[plan?.id])
  const show=()=>{setValue({...defaultImportOptions,...plan?.overrides});setError('');setOpen(true)}
  const apply=async()=>{setBusy(true);setError('');try{await studioApi.correctPlan(projectId,value);setOpen(false);onChanged()}catch(e){setError(t(errorText(e)))}finally{setBusy(false)}}
  const start=async()=>{if(!plan||!selected.length)return;setBusy(true);setError('');recover.close();try{await studioApi.confirmPlan(projectId,plan.id,selected,value,analysisMode);if(onStarted)onStarted();else onChanged()}catch(e){const code=errorCode(e);if(isRecoveryCode(code))recover.open(code as string);else setError(t(errorText(e)))}finally{setBusy(false)}}
  const incompatible=analysisMode==='visual'&&selected.length===1&&selected[0]==='content'
  const unavailable=analysisMode==='visual'&&!capability?.visual_analysis
  const prefs=plan?.preferences
  const aspectLabel=(aspect:string)=>t(aspect==='portrait'?'9:16 portrait':aspect==='landscape'?'16:9 landscape':'Keep original aspect ratio')
  const aspectSummary=awaiting&&selected.length?selected.map(goal=>`${t(goalLabels[goal])} · ${aspectLabel(value.aspect || (goal==='promo'?'portrait':plan?.aspect || 'original'))}`).join(' / '):aspectLabel(prefs?.aspect || 'original')
  return <>
    <div className={`studio-plan-summary ${awaiting?'studio-plan-confirm':''}`}>
      {plan?.degrade_reason==='vision_unavailable_subtitle_fallback'&&<p role="status" className="studio-muted">{t('Vision is temporarily unavailable. Switched to subtitle analysis to continue creating clips.')}</p>}
      {plan?.degrade_reason==='vision_invalid_subtitle_fallback'&&<p role="status" className="studio-muted">{t('Visual result unavailable; switched to subtitles to continue.')}</p>}
      {plan?.degrade_reason==='frame_extract_subtitle_fallback'&&<p role="status" className="studio-muted">{t('Could not read frames from the source. Switched to subtitle analysis to continue.')}</p>}
      {plan?.degrade_reason==='source_too_long_subtitle_route'&&<p role="status" className="studio-muted">{t('Visual analysis supports sources up to 120 minutes. Switched to subtitle analysis to continue.')}</p>}
      <div>{prefs?<><b>{awaiting?t("Here is what you can make"):plan?.mode==='ai'?t("AI suggestion"):plan?.mode==='manual'?t("Your plan"):t("Current plan")}</b><span className="studio-muted">{t(contentLabels[plan?.content_type || 'other'] ?? contentLabels.other)}{plan?.source_duration!=null?` · ${t('Source {{duration}}', { duration: fmtDuration(plan.source_duration) })}`:''} · {prefs.goal==='content'?t("Select complete ideas"):t('Target per video: {{seconds}} s', { seconds: prefs.duration })} · {aspectSummary} · {prefs.language==='source' ? t('Original language') : languages.find(l=>l.value===prefs.language)?.label}</span><details><summary>{t("View the reasoning")}{plan?.mode==='ai' && plan.confidence<.6?t("· Low confidence"):''}</summary><p className="studio-muted">{t(plan?.reason || '')}</p></details></>:<span className="studio-muted">{running?t("Quickly checking suitable content types"):t("Adjust the plan and identify again")}</span>}</div>
      {awaiting && plan ? <>
        <Row label={t("Analysis")} hint={analysisMode==='visual'
            ? <>{t("Samples a few frames alongside the text for a better read on action and scenes; billed by the model provider.")}{capability?.visual_model?` · ${capability.visual_model}`:''}</>
            : unavailable ? t("The current model can’t analyse frames; switch to a multimodal model to enable this.") : t("Analyses subtitle text only — the cheapest option; speech is transcribed first when there are no subtitles.")}>
          <Segmented size="sm" ariaLabel={t("Analysis")} value={analysisMode} onChange={value=>!busy&&setAnalysisMode(value)}
            options={[{value:'subtitle',label:t("Subtitles only")},{value:'visual',label:t("Subtitles + frames")}]} />
        </Row>
        {unavailable&&<p role="alert" className="studio-error">{t("The current model can’t analyse frames. Choose “Subtitles only”, or switch to a multimodal model in Settings.")}</p>}
        {incompatible&&<p role="alert" className="studio-error">{t("“Content clips” use subtitles only; to analyse frames, also select Highlights or Promo.")}</p>}
        <p className="studio-muted">{plan.suggested_goals.length?t("Suggested types are selected. You can deselect or add others."):t("No automatic suggestion was available. Choose types that suit the source.")}{' '}{t("Detailed analysis and editing begin only after confirmation.")}</p>
        <div className="studio-output-choices">{choices.map(({goal,description})=><label key={goal} className={`studio-output-choice ${selected.includes(goal)?'is-selected':''}`}><input type="checkbox" checked={selected.includes(goal)} disabled={busy} onChange={e=>setSelected(e.target.checked?[...selected,goal]:selected.filter(g=>g!==goal))}/><b>{t(goalLabels[goal])}</b>{plan.suggested_goals.includes(goal)&&<small>{t("Suggested")}</small>}<span className="studio-muted">{t(goal==='highlight'&&analysisMode==='subtitle'?'Find peak moments from the subtitles and keep the key run-up':description)}</span></label>)}</div>
        {analysisMode==='subtitle'&&selected.includes('promo')&&<p className="studio-muted">{t("Subtitle promos make one additional text-model request for copy, billed by your provider. Review before use.")}</p>}
        <details className="studio-details"><summary>{t("Adjust settings (optional)")}</summary><ImportPreferences value={value} onChange={setValue} hideGoal/></details>
        <div className="studio-row studio-confirm-footer"><span className="studio-muted">{selected.length?t('Content types to create: {{count}}', { count: selected.length }):t("Select at least one content type")}</span><Btn variant="cta" disabled={!selected.length||busy||incompatible||unavailable} loading={busy} onClick={start}>{t("Confirm and start")}</Btn></div>
      </> : <div className="studio-actions">{plan?.selected_goals&&<span className="studio-muted">{plan.selected_goals.map(g=>t(goalLabels[g])).join(' / ')}</span>}<Btn size="sm" disabled={running} onClick={show}>{t("Edit plan")}</Btn></div>}
      {!open&&<TranscriptionGatePrompt state={recovery} busy={busy} onInstall={()=>recover.install()} onRetry={()=>recover.retry()} onContinue={()=>{recover.close();void start()}} navigate={navigate}/>}
      {!open&&error&&<p className="studio-error" role="alert">{error}</p>}
    </div>
    <Dialog open={open} onClose={()=>!busy&&setOpen(false)} title={t("Adjust production plan")} description={t("Get new suggestions from the same source, then confirm to start. Existing drafts and exports are kept.")} footer={<div className="studio-actions"><Btn disabled={busy} onClick={()=>setOpen(false)}>{t("Cancel")}</Btn><Btn variant="cta" loading={busy} onClick={apply}>{t("Suggest again")}</Btn></div>}>
      <ImportPreferences value={value} onChange={setValue}/><label className="studio-field">{t("Additional instructions")}<input value={value.instruction} maxLength={1000} onChange={e=>setValue({...value,instruction:e.target.value})}/></label>
      {error&&<p className="studio-error" role="alert">{error}</p>}
    </Dialog>
  </>
}
