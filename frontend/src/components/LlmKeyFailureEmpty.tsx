import React from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '../i18n'
import { Btn } from '../ui'

/** FailedEmpty state：One-sentence reason、With own keyNext、On「Settings → Service Provider andModel」Main button。 */
const LlmKeyFailureEmpty: React.FC<{
  errorMessage?: string
  onOpenSettings: () => void
}> = ({ errorMessage, onOpenSettings }) => {
  useTranslation()
  return (
    <div className="ac-empty" style={{ marginTop: 32 }}>
      <b>{t("No model is ready yet")}</b>
      <span style={{ display: 'block', maxWidth: 520, margin: '6px auto 0', lineHeight: 1.5 }}>
        {t("Bring your own API key from that provider's console, then open Settings → Providers and models, enter the provider, key, and model, and run Test connection.")}
      </span>
      {errorMessage && (
        <span className="ac-mono" style={{ display: 'block', marginTop: 10, color: 'var(--ac-muted)', wordBreak: 'break-word' }}>
          {errorMessage}
        </span>
      )}
      <div style={{ marginTop: 16 }}>
        <Btn variant="cta" size="sm" onClick={onOpenSettings}>{t("Open model settings")}</Btn>
      </div>
    </div>
  )
}

export default LlmKeyFailureEmpty
