/** PublishHow-toGet it from thewebsite，ApplicationOnly provide access within，For future convenienceChangeSteps without release。 */
export const PUBLISH_GUIDE_ORIGIN = 'https://yogendra-sudo.github.io/autovideoclip_intro'
export const PUBLISH_GUIDE_PATH = '/guides/publish/'

const LANGS = ['zh', 'en', 'ja', 'ko', 'es', 'pt', 'ru', 'fr'] as const

export function publishGuideHref(lang?: string): string {
  const raw = (lang || '').toLowerCase().replace('_', '-')
  const code = raw.split('-')[0]
  const q = (LANGS as readonly string[]).includes(code) ? code : 'en'
  return `${PUBLISH_GUIDE_ORIGIN}${PUBLISH_GUIDE_PATH}?lang=${q}`
}
