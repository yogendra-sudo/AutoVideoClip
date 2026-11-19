import { t } from '../../i18n'

/** Localized display name for a platform strategy id; the single source for Studio UI labels. */
export function platformLabel(id: string): string {
  switch (id) {
    case 'douyin': return t('Douyin')
    case 'tiktok': return 'TikTok'
    case 'instagram_reels': return 'Instagram Reels'
    case 'youtube_shorts': return 'YouTube Shorts'
    case 'youtube_long': return t('YouTube video')
    case 'bilibili': return t('Bilibili')
    case 'xiaohongshu': return t('Xiaohongshu')
    case 'original': return t('Original')
    default: return t('Selected platform')
  }
}
