import { ERROR_CODE } from './failureCodes'
/**
 * ApplicationInsideFeedbackofPublicDraft。
 * The email address is only for the maintainer's inbox records，Do not enter GitHub ofTitle、Body or pre-filled link。
 */
export type FeedbackCategory = 'bug' | 'idea' | 'other'

export interface FeedbackDraftInput {
  feedbackId: string
  category: FeedbackCategory
  text: string
  contact?: string
  source: string
  stage?: string
  errorMessage?: string
  errorCode?: string
  unexpectedType?: string
  transcriptionProvider?: string
  transcriptionModel?: string
  version: string
  os: string
  arch: string
  llmProvider?: string
  llmModel?: string
}

export interface FeedbackDraft {
  feedbackId: string
  category: FeedbackCategory
  text: string
  contact?: string
  source: string
  stage?: string
  errorMessage?: string
  errorCode?: string
  unexpectedType?: string
  transcriptionProvider?: string
  transcriptionModel?: string
  version: string
  os: string
  arch: string
  llmProvider?: string
  llmModel?: string
  title: string
}

const SECRET = /sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]+|(?:api[_-]?key|token|secret|password|bearer)\s*[:=]\s*\S+/gi

export function safeFeedbackErrorCode(value?: string): string | undefined {
  return value && ERROR_CODE.test(value) ? value : undefined
}

export function newFeedbackId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16)
    const value = ch === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

export function scrubText(value: string | undefined, max = 2000): string {
  return (value || '').replace(SECRET, '[redacted]').replace(/\r\n/g, '\n').trim().slice(0, max)
}

export function buildFeedbackDraft(input: FeedbackDraftInput): FeedbackDraft {
  const text = scrubText(input.text, 2000)
  const category = input.category
  const prefix = category === 'idea' ? '[Idea] ' : '[Feedback] '
  const line = text.split('\n')[0].replace(/\s+/g, ' ').trim()
  const title = (prefix + (line || 'ApplicationInsideFeedback')).slice(0, 120)
  const contact = scrubText(input.contact, 200)
  return {
    feedbackId: input.feedbackId,
    category,
    text,
    contact: contact || undefined,
    source: scrubText(input.source, 40),
    stage: scrubText(input.stage, 80) || undefined,
    errorMessage: scrubText(input.errorMessage, 500) || undefined,
    errorCode: safeFeedbackErrorCode(input.errorCode),
    unexpectedType: scrubText(input.unexpectedType, 40) || undefined,
    transcriptionProvider: ['whisper_local', 'sensevoice_local', 'cloud'].includes(input.transcriptionProvider || '') ? input.transcriptionProvider : undefined,
    transcriptionModel: scrubText(input.transcriptionModel, 80) || undefined,
    version: scrubText(input.version, 40),
    os: scrubText(input.os, 40),
    arch: scrubText(input.arch, 40),
    llmProvider: scrubText(input.llmProvider, 80) || undefined,
    llmModel: scrubText(input.llmModel, 80) || undefined,
    title,
  }
}

/** Send to PostHog Characterclips。ExcludesAPI endpoint。The email address only appearsGet it from theHere。 */
export function captureProperties(draft: FeedbackDraft): Record<string, string | number> {
  const props: Record<string, string | number> = {
    feedback_id: draft.feedbackId,
    category: draft.category,
    text: draft.text,
    source: draft.source,
    app_version: draft.version,
    os: draft.os,
    arch: draft.arch,
    analytics_environment: 'production',
    runtime: 'desktop',
    schema_version: 2,
    $lib: 'autovideoclip-feedback',
  }
  if (draft.contact) props.contact = draft.contact
  if (draft.stage) props.stage = draft.stage
  if (draft.errorMessage) props.error_message = draft.errorMessage
  if (draft.errorCode) props.error_code = draft.errorCode
  if (draft.unexpectedType) props.unexpected_type = draft.unexpectedType
  if (draft.transcriptionProvider) props.transcription_provider = draft.transcriptionProvider
  if (draft.transcriptionModel) props.transcription_model = draft.transcriptionModel
  if (draft.llmProvider) props.llm_provider = draft.llmProvider
  if (draft.llmModel) props.llm_model = draft.llmModel
  return props
}

function platformLabel(os: string): string {
  if (os === 'macos') return 'macOS Desktop Version (Apple Silicon)'
  if (os === 'windows') return 'Windows Desktop Version (x64)'
  if (os === 'linux') return 'Docker'
  return 'Source code execution / From source'
}

function publicLines(draft: FeedbackDraft): string {
  const lines = [
    draft.text,
    '',
    `FeedbackNumber：${draft.feedbackId}`,
    `<!-- feedback-id:${draft.feedbackId} -->`,
    '',
    `Version：${draft.version || 'Unknown'}`,
    `System：${draft.os || 'Unknown'} / ${draft.arch || 'Unknown'}`,
    `Source：${draft.source || 'Unknown'}`,
  ]
  if (draft.stage) lines.push(`Stageclips：${draft.stage}`)
  if (draft.errorCode) lines.push(`Error code：${draft.errorCode}`)
  if (draft.unexpectedType) lines.push(`ErrorType：${draft.unexpectedType}`)
  if (draft.transcriptionProvider) lines.push(`Transcription model：${draft.transcriptionProvider}${draft.transcriptionModel ? ` / ${draft.transcriptionModel}` : ''}`)
  if (draft.llmProvider) lines.push(`Model：${draft.llmProvider}${draft.llmModel ? ` / ${draft.llmModel}` : ''}`)
  if (draft.errorMessage) lines.push('', 'Error', draft.errorMessage)
  return lines.join('\n').slice(0, 1500)
}

/** Direct deliveryFailedTimeOnPre-filled page for。No email address in the link。 */
export function githubFallbackUrl(draft: FeedbackDraft): string {
  if (draft.category === 'bug') {
    const params = new URLSearchParams({
      template: 'bug_report.yml',
      title: draft.title,
      version: draft.version || 'unknown',
      model: draft.llmProvider ? `${draft.llmProvider}${draft.llmModel ? ` / ${draft.llmModel}` : ''}` : 'Unknown',
      platform: platformLabel(draft.os),
      source: 'Irrelevant / N/A',
      what: publicLines(draft),
    })
    return `https://github.com/yogendra-sudo/AutoVideoClip/issues/new?${params}`
  }
  const params = new URLSearchParams({
    category: draft.category === 'idea' ? 'ideas' : 'q-a',
    title: draft.title,
    body: publicLines(draft),
  })
  return `https://github.com/yogendra-sudo/AutoVideoClip/discussions/new?${params}`
}
