const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInSandbox } = require('./vm-sandbox.cjs')
const ts = require('typescript')

function load(relativePath) {
  const file = path.join(__dirname, relativePath)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  runInSandbox(code, { module, exports: module.exports })
  return module.exports
}

const { classifyTimelineEmpty, weakLocalTimelineFailure } = load('../src/utils/timelineFailure.ts')
const { classifyLlmKeyFailure } = require('./load-ts.cjs').loadTs(path.join(__dirname, '../src/utils/llmFailure.ts'))
const { classifySubtitleFailure } = load('../src/utils/subtitleFailure.ts')

// and backend empty_timeline_failure().user_message() Consistent；CLI It will be written into last_error。
const LAST_ERROR = 'Timeline extraction is empty. No usable segments remained after filtering; try a longer video or provide more complete subtitles.'
const PROGRESS = `Processing failed: ${LAST_ERROR}`

test('classifies the stable code and a last_error that has no code', () => {
  assert.equal(classifyTimelineEmpty('anything', 'timeline_empty'), true)
  assert.equal(classifyTimelineEmpty(LAST_ERROR), true)
  assert.equal(classifyTimelineEmpty(PROGRESS), true)
  assert.equal(classifyTimelineEmpty('Timeline is empty. No usable clips were found.'), true)
})

test('does not treat model, scoring, or subtitle failures as an empty timeline', () => {
  assert.equal(classifyTimelineEmpty('No AI model is configured. Add a provider and API key in Settings.'), false)
  assert.equal(classifyTimelineEmpty('No clips passed the score filter. Lower the minimum score in Settings and retry.'), false)
  assert.equal(classifyTimelineEmpty('No captions to analyze. Install local transcription from Settings → Speech to subtitles.'), false)
  assert.equal(classifyTimelineEmpty(''), false)
  assert.equal(classifyTimelineEmpty(null, 'llm_not_configured'), false)
  assert.equal(classifyTimelineEmpty(null, 'whisper_not_installed'), false)
})

test('an empty timeline last_error does not open model or transcription settings', () => {
  assert.equal(classifyLlmKeyFailure(LAST_ERROR), false)
  assert.equal(classifyLlmKeyFailure(LAST_ERROR, 'timeline_empty'), false)
  assert.equal(classifyLlmKeyFailure(PROGRESS), false)
  assert.equal(classifySubtitleFailure(LAST_ERROR), null)
  assert.equal(classifySubtitleFailure(LAST_ERROR, 'timeline_empty'), null)
  assert.equal(classifySubtitleFailure(PROGRESS), null)
  assert.equal(LAST_ERROR.includes('Settings → Service Provider andModel'), false)
  assert.equal(LAST_ERROR.includes('API Key'), false)
  assert.equal(LAST_ERROR.includes('Test connection'), false)
})

const WEAK = 'The current local model could not return a usable timeline.'
const LEGACY = 'Timeline extraction failed: no valid time interval was returned (82 tags and 14 subtitle blocks). This model often cannot produce a structured timeline, and automatic retries are exhausted. Switch to a cloud model or a larger model.'
const GENERIC = 'Timeline extraction returned no valid time interval. No usable segments remained after filtering.'

test('#428 weak-local empty intervals are not an empty timeline and keep the short sentence', () => {
  assert.equal(weakLocalTimelineFailure(WEAK, 'invalid_response'), true)
  assert.equal(weakLocalTimelineFailure(LEGACY, 'invalid_response'), true)
  assert.equal(weakLocalTimelineFailure(WEAK), true)
  assert.equal(weakLocalTimelineFailure(GENERIC, 'invalid_response'), false)
  assert.equal(weakLocalTimelineFailure(WEAK, 'timeline_empty'), false)
  assert.equal(classifyTimelineEmpty(WEAK, 'invalid_response'), false)
  assert.equal(classifyLlmKeyFailure(WEAK, 'invalid_response'), false)
  const backend = fs.readFileSync(path.join(__dirname, '../../backend/core/weak_local_timeline.py'), 'utf8')
  assert.match(backend, /The current local model could not return a usable timeline./)
  assert.match(backend, /The current local model could not return a usable timeline./)
  const detail = fs.readFileSync(path.join(__dirname, '../src/pages/ProjectDetailPage.tsx'), 'utf8')
  const card = fs.readFileSync(path.join(__dirname, '../src/components/ProjectCard.tsx'), 'utf8')
  assert.doesNotMatch(detail, /weakLocalTimelineFailure/)
  assert.match(card, /Configure model/)
  assert.match(card, /Switch and retry/)
})

test('failure screens do not route an empty timeline to Settings → Model', () => {
  const detail = fs.readFileSync(path.join(__dirname, '../src/pages/ProjectDetailPage.tsx'), 'utf8')
  const card = fs.readFileSync(path.join(__dirname, '../src/components/ProjectCard.tsx'), 'utf8')
  assert.match(detail, /classifyTimelineEmpty/)
  assert.match(detail, /!timelineEmpty && classifyLlmKeyFailure/)
  assert.match(card, /classifyTimelineEmpty/)
  assert.match(card, /!timelineEmpty && classifyLlmKeyFailure/)
})
