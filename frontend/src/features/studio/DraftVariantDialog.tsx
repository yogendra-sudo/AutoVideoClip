import { useTranslation } from 'react-i18next'
import { t } from '../../i18n'
import { useEffect, useState } from 'react'
import { Btn, Dialog } from '../../ui'
import { studioApi, errorText } from './api'
import { Draft, Language, languages, draftError } from './types'

interface Props {
  open: boolean
  projectId: string
  draft: Draft
  onClose: () => void
  onCreated: (draft: Draft) => void
}

export default function DraftVariantDialog({ open, projectId, draft, onClose, onCreated }: Props) {
  useTranslation()
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<Language>('source')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setTitle(t('{{title}} · New version', { title: draft.title.slice(0, 180) }))
      setLanguage(draft.language)
      setError('')
    }
  }, [open])
  const create = async () => {
    const invalid = draftError({ ...draft, title })
    if (invalid) { setError(t(invalid)); return }
    setBusy(true); setError('')
    try {
      const result = await studioApi.duplicate(projectId, draft, title.trim(), language)
      onCreated(result)
    } catch (e) { setError(t(errorText(e))) } finally { setBusy(false) }
  }
  return <Dialog open={open} title={t("Save as new version")} onClose={() => !busy && onClose()}
    description={t("Copy current edits, keeping the original and its exports. Change the new version’s language and opening without analyzing again.")}
    footer={<div className="studio-actions"><Btn disabled={busy} onClick={onClose}>{t("Cancel")}</Btn><Btn variant="cta" disabled={busy || !title.trim()} loading={busy} onClick={create}>{t("Create new version")}</Btn></div>}>
    <fieldset className="studio-fieldset" disabled={busy}>
      <label className="studio-field">{t("New version name")}<input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label>
      <label className="studio-field">{t("New version text language")}<select value={language} onChange={e => setLanguage(e.target.value as Language)}>{languages.map(l => <option key={l.value} value={l.value}>{l.value==='source' ? t('Original language') : l.label}</option>)}</select></label>
      <p className="studio-muted">{t("Text is translated during rendering. Scenes and original audio keep current settings.")}</p>
    </fieldset>
    {error && <p className="studio-error" role="alert">{error}</p>}
  </Dialog>
}
