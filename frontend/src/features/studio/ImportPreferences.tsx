import { useTranslation } from 'react-i18next'
import { Select } from 'antd'
import { t } from '../../i18n'
import { Row } from '../../ui'
import { ImportOptions, goalLabels, languages } from './types'

/** Optional production preferences as setting rows; every field defaults to "let AI match". */
export default function ImportPreferences({value, onChange, hideGoal=false}: {value: ImportOptions; onChange: (value: ImportOptions) => void; hideGoal?:boolean}) {
  useTranslation()
  const patch = (changes: Partial<ImportOptions>) => onChange({...value, ...changes})
  return <div className="ac-rows studio-preferences">
    {!hideGoal&&<Row label={t("Production type")}>
      <Select aria-label={t("Production type")} size="small" style={{width:180}} value={value.goal} options={Object.entries(goalLabels).map(([key,label])=>({value:key,label:t(label)}))} onChange={goal=>patch({goal:goal as ImportOptions['goal']})} />
    </Row>}
    <Row label={t("Text language")}>
      <Select aria-label={t("Text language")} size="small" style={{width:180}} value={value.language} options={languages.map(l=>({value:l.value,label:l.value==='source'?t("Use source language (recommended)"):l.label}))} onChange={language=>patch({language:language as ImportOptions['language']})} />
    </Row>
    <Row label={t("Target duration per video")} hint={value.goal==='content'?t("Clips preserve complete ideas. Adjust their boundaries in the editor."):undefined}>
      <Select aria-label={t("Target duration per video")} size="small" style={{width:180}} value={value.duration ?? ''} options={[{value:'',label:t("Let AI match the content")},...[15,30,60,90,120].map(n=>({value:n,label:t('About {{seconds}} seconds', { seconds: n })}))]} onChange={duration=>patch({duration:duration===''?null:Number(duration)})} />
    </Row>
    <Row label={t("Aspect ratio")}>
      <Select aria-label={t("Aspect ratio")} size="small" style={{width:180}} value={value.aspect ?? ''} options={[{value:'',label:t("Let AI match the content")},{value:'original',label:t("Keep original aspect ratio")},{value:'portrait',label:t("9:16 portrait")},{value:'landscape',label:t("16:9 landscape")}]} onChange={aspect=>patch({aspect:(aspect || null) as ImportOptions['aspect']})} />
    </Row>
  </div>
}
