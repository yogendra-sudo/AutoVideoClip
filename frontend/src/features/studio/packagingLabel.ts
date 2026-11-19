import { t } from '../../i18n'
import type { Packaging } from './types'

/** Template name shown on result cards and in the editor. */
export function packagingLabel(packaging: Packaging): string {
  if (packaging.template === 'podcast_en') return t('Podcast style')
  const bilingual = packaging.captions_enabled !== false && packaging.source_language === 'en' && !packaging.burned_captions && packaging.cues.some(cue => cue.original.trim() && /[\u4e00-\u9fff]/.test(cue.text))
  return bilingual ? t('Interview style · Chinese and English captions') : t('Interview style')
}

/** Describe actual retained captions, including old drafts with an empty fallback. */
export function packagingFallbackHint(packaging: Packaging, warnings: string[] = [], subtitlesRequested = true): string {
  if (!packaging.fallback) return ''
  const hasCaptions = packaging.cues.length > 0 || packaging.burned_captions || warnings.includes('Packaging was incomplete, so the original captions are used')
  // Captions switched off (or caption-free visual highlights): never claim captions were kept.
  if (!subtitlesRequested) return ''
  return hasCaptions ? t('Packaging is incomplete; available captions have been kept') : t('Packaging is incomplete; captions are currently unavailable')
}
