// RC156 Win QA #14b: local models need a larger context for long videos; the setup shows how.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const React = require('react')
const { loadTs, PRESETS } = require('./load-ts.cjs')
const load = loadTs
const providers = loadTs('providers.ts', { '../../i18n': { t: text => text } })
const flatten = node => !React.isValidElement(node) ? [node] : [node, ...React.Children.toArray(node.props.children).flatMap(flatten)]
const locales = Object.fromEntries(['zh', 'en', 'ja', 'ko', 'es', 'pt', 'ru', 'fr'].map(lang =>
  [lang, JSON.parse(fs.readFileSync(path.join(__dirname, `../src/i18n/locales/${lang}.json`), 'utf8'))]))
const OLLAMA = "For long videos, raise the context to 16384 or more (OLLAMA_CONTEXT_LENGTH environment variable or the model's num_ctx), or the start of the transcript gets cut off."
const LMSTUDIO = 'For long videos, set Context Length to 16384 or more when loading the model in LM Studio, or requests fail or the transcript gets cut.'
const GENERIC = 'Local or LAN model: for long videos, raise the context length to 16384 or more, or the transcript gets cut.'

test('local presets and local compatible servers get a context hint; cloud providers do not', () => {
  assert.equal(providers.contextHintFor('ollama'), OLLAMA)
  assert.equal(providers.contextHintFor('lmstudio'), LMSTUDIO)
  for (const url of ['http://localhost:8080/v1', 'http://127.0.0.1:8000/v1', 'http://192.168.1.9:8000/v1', 'http://10.0.0.5/v1', 'http://172.20.1.1/v1', 'http://gpu.local:8000/v1'])
    assert.equal(providers.contextHintFor('compatible', url), GENERIC, url)
  for (const url of ['https://openrouter.ai/api/v1', 'http://172.32.0.1/v1', '', 'not a url'])
    assert.equal(providers.contextHintFor('compatible', url), '', url)
  for (const key of ['dashscope', 'openai', 'deepseek', 'kimi', 'infistar', 'api88', 'gemini', 'seed', 'glm', 'grok'])
    assert.equal(providers.contextHintFor(key, 'http://localhost:1234/v1'), '', key)
  assert.equal(providers.contextHintFor(undefined), '')
})

test('the address row shows the hint for local setups only', () => {
  const access = load('providerAccess.ts', { '../../i18n': { t: text => text }, './providers': providers })
  const Fields = load('ProviderFields.tsx', {
    react: { useState: () => [false, () => {}] },
    antd: { Input: Object.assign(() => null, { Password: 'password' }), Select: 'select' },
    '../../i18n': { t: text => text }, '../../ui': { Btn: 'button', Row: 'row' },
    '../../utils/externalLinks': { openExternalLink() {} },
    '../../analytics/events': { trackSponsorLinkOpened() {} },
    './providers': providers, './modelSettingsLogic': { presetKey: c => c.provider },
    './providerAccess': access,
    './providerUrl': load('providerUrl.ts', {}),
  }).default
  const hints = connection => flatten(Fields({ connection, placement: 'settings_model', onChoose() {}, onEdit() {} }))
    .filter(node => React.isValidElement(node) && node.type === 'row').map(node => node.props.hint).filter(h => typeof h === 'string')
  assert.ok(hints({ provider: 'ollama', base_url: '' }).some(h => h.includes(OLLAMA) && h.includes('Local services can use the default endpoint.')))
  assert.ok(hints({ provider: 'lmstudio', base_url: '' }).some(h => h.includes(LMSTUDIO)))
  assert.ok(hints({ provider: 'compatible', base_url: 'http://localhost:8000/v1', api_key: '' }).some(h => h.includes(GENERIC)))
  assert.ok(!hints({ provider: 'compatible', base_url: 'https://openrouter.ai/api/v1', api_key: '' }).some(h => h.includes('16384')))
  assert.ok(!hints({ provider: 'dashscope', base_url: '', api_key: '' }).some(h => h.includes('16384')))
})

test('the hints are available in English', () => {
  for (const key of [OLLAMA, LMSTUDIO, GENERIC]) {
    assert.equal(locales.en[key], key, key)
    assert.ok(locales.en[key].includes('16384'))
  }
  assert.ok(locales.en[OLLAMA].includes('OLLAMA_CONTEXT_LENGTH') && locales.en[OLLAMA].includes('num_ctx'))
})

test('frontend local-model guidance stays English when source preset copy differs', () => {
  const json = fs.readFileSync(PRESETS, 'utf8')
  for (const key of [OLLAMA, LMSTUDIO, GENERIC]) {
    assert.ok(key.includes('16384'), key)
    assert.ok(!/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(key), key)
  }
  assert.ok(json.includes('OLLAMA_CONTEXT_LENGTH'))
  assert.ok(json.includes('16384'))
})
