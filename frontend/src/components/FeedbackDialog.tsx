import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React, { useEffect, useMemo, useState } from 'react'
import { message } from 'antd'
import { Btn, Dialog, Icon, Segmented } from '../ui'
import {
  FEEDBACK_DISCUSSIONS_URL,
  FEEDBACK_ISSUES_URL,
  FeedbackCategory,
  FeedbackContext,
  collectLlmContext,
  resolveFeedbackSurvey,
  submitFeedback,
  trackFeedbackDismissed,
  trackFeedbackOpened,
} from '../analytics/feedback'
import { getRuntimeInfo } from '../analytics/lifecycle'
import { openExternalLink as openExternal } from '../utils/externalLinks'

interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
  context: FeedbackContext
}

/**
 * ApplicationInsideFeedback — SettingsPage「Feedback」andProjectFailedStateTotalUse。
 * AutoIncludedVersion / System / Architecture / LLM provider & Model / FailedStageclipsWith errors，Users only need to write one sentence。
 */
const FeedbackDialog: React.FC<FeedbackDialogProps> = ({ open, onClose, context }) => {
  useTranslation()
  const [category, setCategory] = useState<FeedbackCategory>(context.source === 'failure' ? 'bug' : 'idea')
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [llm, setLlm] = useState<Awaited<ReturnType<typeof collectLlmContext>>>({})
  const runtime = useMemo(() => getRuntimeInfo(), [])

  const fullContext: FeedbackContext = useMemo(() => ({ ...llm, ...context }), [llm, context])

  useEffect(() => {
    if (!open) return
    setText('')
    setContact('')
    setCategory(context.source === 'failure' ? 'bug' : 'idea')
    collectLlmContext().then(setLlm)
    resolveFeedbackSurvey().then((s) => trackFeedbackOpened(context, s))
    // Background project refreshes replace context objects. Keep the user's
    // typed report until the dialog closes or switches to another project.
  }, [open, context.source, context.project_id])

  const handleClose = () => {
    resolveFeedbackSurvey().then((s) => trackFeedbackDismissed(context, s))
    onClose()
  }

  const handleSend = async () => {
    if (text.trim().length < 4) {
      message.warning(t("Add a little more detail so we can investigate"))
      return
    }
    setSending(true)
    try {
      const result = await submitFeedback({ category, text: text.trim(), contact: contact.trim() || undefined, context: fullContext })
      if (result.ok) {
        message.success(t("Received. This note goes to PostHog first, then appears publicly on GitHub."))
        onClose()
      } else {
        message.info(t("This did not go through. Submit it once more on the GitHub page that just opened."))
        void openExternal(result.fallbackUrl)
      }
    } finally {
      setSending(false)
    }
  }

  const ctxChips: string[] = [
    runtime.version !== 'unknown' ? `v${runtime.version}` : 'dev',
    `${runtime.os}/${runtime.arch}`,
  ]
  if (fullContext.llm_provider) ctxChips.push(`${fullContext.llm_provider}${fullContext.llm_model ? ` · ${fullContext.llm_model}` : ''}`)
  if (fullContext.stage) ctxChips.push(`stage: ${fullContext.stage}`)
  if (fullContext.error_code) ctxChips.push(fullContext.error_code)
  if (fullContext.transcription_provider) ctxChips.push(`${fullContext.transcription_provider}${fullContext.transcription_model ? ` · ${fullContext.transcription_model}` : ''}`)

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={context.source === 'failure' ? t("No clips this time? Tell us what went wrong.") : t("Feedback")}
      description={
        context.source === 'failure'
          ? t("Error details and runtime information are attached automatically. Just describe what happened. After you send, the note and optional contact go to PostHog first, then appear on GitHub; your email stays private.")
          : t("A short description is enough. Runtime information is attached, without video content or API keys. After you send, the note and optional contact go to PostHog first, then appear on GitHub; your email stays private.")
      }
      footer={
        <>
          <div style={{ display: 'flex', gap: 4 }}>
            <Btn variant="text" size="sm" onClick={() => openExternal(category === 'bug' ? FEEDBACK_ISSUES_URL : FEEDBACK_DISCUSSIONS_URL)}>GitHub <Icon.External size={12} /></Btn>
          </div>
          <div className="right">
            <Btn size="sm" onClick={handleClose}>{t("Cancel")}</Btn>
            <Btn variant="cta" size="sm" style={{ height: 32, fontSize: 13, padding: '0 16px' }} loading={sending} onClick={handleSend}>{t("Send")}</Btn>
          </div>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Segmented
          size="sm"
          ariaLabel={t("Feedback type")}
          value={category}
          onChange={setCategory}
          options={[
            { value: 'bug', label: t("Report a problem") },
            { value: 'idea', label: t("Request a feature") },
            { value: 'other', label: t("Other") },
          ]}
        />
        <textarea
          className="ac-input ac-textarea"
          autoFocus
          placeholder={
            category === 'bug'
              ? t("What happened? Include your steps, expected result and actual result.")
              : category === 'idea'
                ? t("What would you like AutoClip to help you do?")
                : t("Anything you would like to share.")
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
        />
        {fullContext.error_message && (
          <div className="ac-input ac-input--mono" style={{ height: 'auto', padding: '8px 12px', color: 'var(--ac-sub)', background: 'var(--ac-line-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 88, overflow: 'auto', fontSize: 11.5 }}>
            {fullContext.error_message}
          </div>
        )}
        <input
          className="ac-input"
          placeholder={t("Contact (optional email, sent via PostHog only, not published)")}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
        <p className="ac-note">
          {t("Your message and contact details are sent to the developers so they can reply and create a GitHub Issue.")}
        </p>
        <div className="ac-context" title={t("Context included with this feedback")}>
          {ctxChips.map((c) => <span key={c}>{c}</span>)}
          <span>{t("After you send, this goes to PostHog first, then appears on GitHub; your email stays private.")}</span>
        </div>
      </div>
    </Dialog>
  )
}

export default FeedbackDialog
