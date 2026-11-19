import type { Draft } from './types'
import comicThumbnail from '../../assets/title-presets/comic.webp'
import neonThumbnail from '../../assets/title-presets/neon.webp'
import arenaThumbnail from '../../assets/title-presets/arena.webp'
import pixelThumbnail from '../../assets/title-presets/pixel.webp'
import editorialThumbnail from '../../assets/title-presets/editorial.webp'
import frostedThumbnail from '../../assets/title-presets/frosted.webp'

export const titlePresets = [
  {value:'comic',label:'Comic impact'}, {value:'neon',label:'Neon challenge'},
  {value:'arena',label:'Arena slant'}, {value:'pixel',label:'Pixel arcade'},
  {value:'editorial',label:'Minimal bold'}, {value:'frosted',label:'Frosted caption card'},
  {value:'impact',label:'Bold impact'}, {value:'card',label:'Simple title card'},
  {value:'plain',label:'Basic text'},
] as const

export function isArtworkStyle(style: Draft['title_style']) {
  return ['comic','neon','arena','editorial','pixel','frosted'].includes(style || '')
}

export function titleVersions(style: Draft['title_style']) {
  const labels = {1:'Original',2:'Enhanced',3:'Glossy',4:'Design refined',5:'Extra impact',6:'Launch edition'} as const
  const versions: (keyof typeof labels)[] = style==='comic' ? [6,5,4,3,2,1]
    : style==='pixel'||style==='frosted' ? [6,3]
    : style==='editorial' ? [6,3,2] : [6,3,2,1]
  return versions.map(value=>({value,label:labels[value]}))
}

// Design references help users identify the look; TitleArtwork renders their actual text.
export const titleDesignThumbnails: Partial<Record<NonNullable<Draft['title_style']>, string>> = {
  comic: comicThumbnail,
  neon: neonThumbnail,
  arena: arenaThumbnail,
  pixel: pixelThumbnail,
  editorial: editorialThumbnail,
  frosted: frostedThumbnail,
}
