import { useState } from 'react'
import { t } from '../../i18n'
import { Btn } from '../../ui'
import { trackOutputRating, trackOutputShare, type VariantProperties } from '../../analytics/studio'
import { openExternalLink } from '../../utils/externalLinks'
import { USE_CASE_URL } from './outputShare'

type Rating = 'ready' | 'needs_edit' | 'unusable'

/** Shown once after a successful download: three-level rating, then an optional use-case invite. */
export default function OutputFeedback({ projectId, variant, onDone }: { projectId: string; variant: VariantProperties; onDone: () => void }) {
  const [rated, setRated] = useState<Rating>()
  const rate = (value: Rating) => {
    setRated(value)
    trackOutputRating(projectId, { output_rating: value, ...variant })
  }
  if (!rated) return <div className="studio-output-feedback" role="group" aria-label={t('Can you use this video as is?')}>
    <span className="studio-output-hint">{t('Can you use this video as is?')}</span>
    <div className="studio-output-feedback-actions">
      <Btn size="sm" variant="text" onClick={() => rate('ready')}>{t('Ready to use')}</Btn>
      <Btn size="sm" variant="text" onClick={() => rate('needs_edit')}>{t('Needs small edits')}</Btn>
      <Btn size="sm" variant="text" onClick={() => rate('unusable')}>{t('Not usable')}</Btn>
      <Btn size="sm" variant="text" onClick={onDone} aria-label={t('Close')}>×</Btn>
    </div>
  </div>
  return <div className="studio-output-feedback" role="status">
    <span className="studio-output-hint">{rated === 'unusable' ? t('Got it. We will keep improving clip selection and editing.') : t('Thanks! Would you share this video as a use case?')}</span>
    <div className="studio-output-feedback-actions">
      {rated !== 'unusable' && <Btn size="sm" variant="text" onClick={() => { trackOutputShare(projectId, { share_target: 'use_case_discussion', ...variant }); void openExternalLink(USE_CASE_URL); onDone() }}>{t('Share a use case')}</Btn>}
      <Btn size="sm" variant="text" onClick={onDone}>{t('Close')}</Btn>
    </div>
  </div>
}
