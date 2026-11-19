import { t } from '../../i18n'

/** Non-blocking. The save bar stays available. */
export default function WeakLocalTimelineNote() {
  return (
    <p className="ac-note" role="status">
      {t("This local model often can't produce clips. Prefer a larger or cloud model.")}
    </p>
  )
}
