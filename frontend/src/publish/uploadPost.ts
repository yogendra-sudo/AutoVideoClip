/** OverseasPublish（Upload-Post）Pure logic of。With the backend pick_preset / Private wordsclipsAgreed to remain consistent。 */

export const VERTICAL_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook', 'threads', 'pinterest'] as const

export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X',
  threads: 'Threads',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  discord: 'Discord',
  telegram: 'Telegram',
  google_business: 'Google Business',
  mastodon: 'Mastodon',
  wordpress: 'WordPress',
  bilibili: 'Bilibili',
}

export type PublishVisibility = 'private' | 'public'

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] || platform
}

/** Rules when no preset is specified：With vertical screenPlatformJust use 9:16 shorts，OtherwiseOriginal。Command line not written --preset Use this when。 */
export function pickPreset(platforms: string[]): 'shorts' | 'original' {
  return platforms.some((p) => (VERTICAL_PLATFORMS as readonly string[]).includes(p)) ? 'shorts' : 'original'
}

/**
 * Publishof the pageVideoSpecifications follow the account to be posted。
 * For portrait mode 9:16 And not truncated（douyin）；Only send BilibiliUse landscape mode；Landscape onlyOverseasWhen getting accounts, pressOriginal。
 */
export function renderPreset(platforms: string[]): 'douyin' | 'bilibili' | 'original' {
  if (!platforms.length) return 'douyin'
  if (platforms.some((p) => (VERTICAL_PLATFORMS as readonly string[]).includes(p))) return 'douyin'
  if (platforms.includes('bilibili')) return 'bilibili'
  return 'original'
}

/** PublishSelectable destinations on the page：Upload-Post Connectedof, thenAddConfiguredof Bilibili。 */
export function publishDestinations(connected: string[], bilibili: boolean): string[] {
  const list = connected.filter((p) => p !== 'bilibili')
  if (bilibili) list.push('bilibili')
  return list
}

/** DefaultCheckConnectedPortrait modePlatform；Check all when there are noneConnectedPlatform。 */
export function defaultPlatforms(connected: string[]): string[] {
  const vertical = connected.filter((p) => (VERTICAL_PLATFORMS as readonly string[]).includes(p))
  return vertical.length ? vertical : connected.slice()
}

/**
 * 「Only me」Only include the words agreed upon in the documentclips：TikTok privacy_level=SELF_ONLY，YouTube privacyStatus=private。
 * PublicDo not append wordsclips，Avoid including irrelevantPlatformPrivate parameter 1andSent out。
 */
export function privateExtra(platforms: string[], visibility: PublishVisibility): Record<string, string> {
  if (visibility !== 'private') return {}
  const extra: Record<string, string> = {}
  if (platforms.includes('tiktok')) extra.privacy_level = 'SELF_ONLY'
  if (platforms.includes('youtube')) extra.privacyStatus = 'private'
  return extra
}

export type ScheduleResult =
  | { ok: true; scheduled_date?: string; timezone?: string }
  | { ok: false; reason: 'empty' | 'past' }

/** NowWithout time。LaterRequestLocalTime is later than nowGet it from the，secondsCompleted by number ISO，Time zone is given to the caller。 */
export function buildSchedule(when: 'now' | 'later', localValue: string, timeZone: string, nowMs: number): ScheduleResult {
  if (when === 'now') return { ok: true }
  const value = localValue.trim()
  if (!value) return { ok: false, reason: 'empty' }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed) || parsed <= nowMs) return { ok: false, reason: 'past' }
  return {
    ok: true,
    scheduled_date: value.length === 16 ? `${value}:00` : value,
    timezone: timeZone || 'UTC',
  }
}

export function recordStatusKey(status: string | undefined): string {
  if (status === 'scheduled') return 'Scheduled'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'failed' || status === 'not_found') return 'Publish failed'
  if (status === 'completed') return 'Sent'
  return 'Processing'
}

const WEEK_OFFSETS = [0, 2, 4]
const BUSY_RECORD = new Set(['scheduled', 'submitted', 'completed', 'processing', 'pending', 'running', 'queued'])

export interface WeekClip {
  id: string
  title: string
  score: number
}

export interface WeekRecord {
  clip_id?: string
  title?: string
  status?: string
  scheduled_date?: string | null
  submitted_at?: string
}

export interface WeekSlotPlan {
  at: Date
  stamp: string
  state: 'new' | 'taken' | 'empty'
  clipId?: string
  title?: string
  score?: number
}

export function localStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function recordInstant(record: { scheduled_date?: string | null; submitted_at?: string }): Date | null {
  const raw = record.scheduled_date || record.submitted_at
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Six-week grid starting on Monday。month From 0 Start。 */
export function monthCells(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date, inMonth: date.getMonth() === month }
  })
}

function mondayOf(now: Date): Date {
  const date = new Date(now)
  const diff = date.getDay() === 0 ? -6 : 1 - date.getDay()
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function slotsFromMonday(monday: Date): Date[] {
  return WEEK_OFFSETS.map((offset) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + offset)
    date.setHours(9, 0, 0, 0)
    return date
  })
}

/** The Monday of this week that hasn't arrived yet、Three、Five 09:00。Use the next week if it's already passed.。 */
export function upcomingWeekSlots(now: Date): Date[] {
  const monday = mondayOf(now)
  const current = slotsFromMonday(monday).filter((slot) => slot.getTime() > now.getTime())
  if (current.length) return current
  const next = new Date(monday)
  next.setDate(monday.getDate() + 7)
  return slotsFromMonday(next)
}

function sameMinute(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
    && left.getHours() === right.getHours()
    && left.getMinutes() === right.getMinutes()
}

/** Not yet sent、Neither.Get it from theIn the scheduleClips。FailedandCancelledCan be rescheduled。 */
export function remainingClips(clips: WeekClip[], records: WeekRecord[]): WeekClip[] {
  const busyIds = new Set(records.filter((record) => BUSY_RECORD.has(record.status || '') && record.clip_id).map((record) => record.clip_id as string))
  return clips.filter((clip) => clip.id && !busyIds.has(clip.id))
}

/** MonthDefaultStopGet it from theNextclipsFuture SchedulingGet it from theMonth；Stop if not availableGet it from theToday。month From 0 Start。 */
export function focusMonth(records: WeekRecord[], now: Date): { year: number; month: number } {
  const upcoming = records
    .filter((record) => record.status === 'scheduled')
    .map((record) => recordInstant(record))
    .filter((date): date is Date => !!date && date.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())
  const focus = upcoming[0] || now
  return { year: focus.getFullYear(), month: focus.getMonth() }
}

/** HighpointsPriority。Already posted or scheduledClipsNo longer occupies an empty slot；Leave the time slot empty if it conflicts with an existing scheduleclipsRecord。 */
export function planWeek(clips: WeekClip[], records: WeekRecord[], now: Date): WeekSlotPlan[] {
  const ranked = remainingClips(clips, records)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title))
  let index = 0
  return upcomingWeekSlots(now).map((at) => {
    const taken = records.find((record) => record.status === 'scheduled' && record.scheduled_date && sameMinute(new Date(record.scheduled_date), at))
    const stamp = localStamp(at)
    if (taken) return { at, stamp, state: 'taken', title: taken.title, clipId: taken.clip_id }
    const clip = ranked[index]
    index += 1
    if (!clip) return { at, stamp, state: 'empty' }
    return { at, stamp, state: 'new', clipId: clip.id, title: clip.title, score: clip.score }
  })
}

export function recordTone(status: string | undefined): 'ok' | 'error' | 'accent' | 'muted' {
  if (status === 'completed') return 'ok'
  if (status === 'failed' || status === 'not_found') return 'error'
  if (status === 'cancelled') return 'muted'
  return 'accent'
}

export function readApiDetail(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback
  const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'msg' in item && typeof (item as { msg: unknown }).msg === 'string') {
        return (item as { msg: string }).msg
      }
      return ''
    }).filter(Boolean)
    if (parts.length) return parts.join('；')
  }
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message : fallback
}
