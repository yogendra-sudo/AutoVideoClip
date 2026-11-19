const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./load-ts.cjs')

function loadClassifier() {
  return loadTs(path.join(__dirname, '../src/utils/llmFailure.ts'))
}

const { classifyLlmKeyFailure } = loadClassifier()

const LEGACY = 'No AI model is configured. Add a provider and API key in Settings.'

test('invalid credentials use distinct localized copy even with a stale missing-key message', () => {
  const { llmFailureText } = loadClassifier()
  assert.equal(classifyLlmKeyFailure(LEGACY, 'llm_auth_invalid'), false)
  const key = llmFailureText(LEGACY, 'llm_auth_invalid')
  assert.equal(key, 'The API key is invalid or expired. Update it in Settings, then try again.')
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es', 'pt', 'ru', 'fr']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, `../src/i18n/locales/${locale}.json`), 'utf8'))
    assert.ok(catalog[key], locale)
    if (locale !== 'zh') assert.equal(catalog[key], key)
  }
  assert.equal(llmFailureText(LEGACY, 'llm_not_configured'), LEGACY)
})

test('insufficient_quota is recharge copy, even when the coarse code says the key is invalid', () => {
  const { llmFailureText } = loadClassifier()
  const { USER_MESSAGES } = loadTs(path.join(__dirname, '../src/analytics/failureCodes.ts'))
  const quota = USER_MESSAGES.insufficient_quota
  const key = USER_MESSAGES.llm_auth_invalid
  assert.match(quota, /Top up or replace the token/)
  assert.equal(llmFailureText(key, 'llm_auth_invalid', 'insufficient_quota'), quota)
  assert.equal(llmFailureText(quota, 'llm_auth_invalid'), quota)
  assert.equal(llmFailureText(USER_MESSAGES.provider_error, 'provider_error', 'insufficient_quota'), quota)
  assert.equal(llmFailureText(LEGACY, 'llm_auth_invalid', 'invalid_key'), key)
})

test('503 coarse provider_error shows the upstream_unavailable sentence', () => {
  const { llmFailureText } = loadClassifier()
  const { USER_MESSAGES } = loadTs(path.join(__dirname, '../src/analytics/failureCodes.ts'))
  const generic = USER_MESSAGES.provider_error
  assert.match(generic, /Unrecognized/)
  assert.equal(llmFailureText(generic, 'provider_error', 'upstream_unavailable'), USER_MESSAGES.upstream_unavailable)
  assert.equal(llmFailureText('', 'provider_error', 'upstream_unavailable'), USER_MESSAGES.upstream_unavailable)
  assert.equal(llmFailureText('The model service is temporarily unavailable. Please try again later.', 'provider_error', 'upstream_unavailable'), USER_MESSAGES.upstream_unavailable)
  assert.equal(llmFailureText(generic, 'provider_error', 'unknown'), generic)
  assert.equal(llmFailureText('Error code: 401 sk-secret', 'unexpected'), 'Error code: 401 sk-secret')
})

test('classifies a missing key, a failed provider test, and the stable code', () => {
  assert.equal(classifyLlmKeyFailure('anything', 'llm_not_configured'), true)
  assert.equal(classifyLlmKeyFailure(LEGACY), true)
  assert.equal(classifyLlmKeyFailure('AI provider is not configured. Please add your own API key in Settings.'), true)
  assert.equal(classifyLlmKeyFailure('Connection test failed. Verify your API key and model in Settings.'), true)
  assert.equal(classifyLlmKeyFailure('API connection test failed. Please check the API key.'), true)
})

test('does not treat scoring, subtitle, or empty-timeline failures as a missing model key', () => {
  assert.equal(classifyLlmKeyFailure('No clips passed the score filter. Lower the minimum score in Settings and retry.'), false)
  assert.equal(classifyLlmKeyFailure('No subtitles are available and local Whisper is not installed.'), false)
  const timeline = 'Timeline extraction is empty. No usable segments remained after filtering; try a longer video or provide more complete subtitles.'
  assert.equal(classifyLlmKeyFailure(timeline), false)
  assert.equal(classifyLlmKeyFailure(timeline, 'timeline_empty'), false)
  assert.equal(classifyLlmKeyFailure('Processing failed：' + timeline), false)
  assert.equal(classifyLlmKeyFailure(''), false)
  assert.equal(classifyLlmKeyFailure(null, 'whisper_not_installed'), false)
  assert.equal(classifyLlmKeyFailure(null, 'timeline_empty'), false)
})

test('failure screens deep-link to Settings → Model', () => {
  const detail = fs.readFileSync(path.join(__dirname, '../src/pages/ProjectDetailPage.tsx'), 'utf8')
  const card = fs.readFileSync(path.join(__dirname, '../src/components/ProjectCard.tsx'), 'utf8')
  const empty = fs.readFileSync(path.join(__dirname, '../src/components/LlmKeyFailureEmpty.tsx'), 'utf8')
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/locales/en.json'), 'utf8'))
  assert.match(detail, /\/settings\?section=model/)
  assert.match(card, /\/settings\?section=model/)
  assert.match(empty, /Open model settings/)
  assert.match(en["Bring your own API key from that provider's console, then open Settings → Providers and models, enter the provider, key, and model, and run Test connection."], /Settings → Providers and models/)
  assert.match(en["Bring your own API key from that provider's console, then open Settings → Providers and models, enter the provider, key, and model, and run Test connection."], /Bring your own API key/)
})
