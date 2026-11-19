const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInSandbox } = require('./vm-sandbox.cjs')
const { loadTs } = require('./load-ts.cjs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { USER_MESSAGES } = loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts'))

function renderCard(status, error, progressMessage, extra = {}, navigate = () => {}, props = {}) {
  const opened = []
  const stubs = {
    '../i18n': { t: (key, values) => values ? String(key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => values[name] == null ? '' : String(values[name])) : key },
    'react-i18next': { useTranslation: () => ({}) },
    'react-router-dom': { useNavigate: () => navigate },
    '../services/api': { projectApi: {} },
    '../features/studio/api': { studioApi: {} },
    '../utils/externalLinks': { openExternalLink: (url) => { opened.push(url); if (extra.onExternal) extra.onExternal(url) } },
    './UnifiedStatusBar': { UnifiedStatusBar: () => null },
    './FeedbackDialog': { __esModule: true, default: () => null },
    '../features/studio/SwitchModelDialog': { __esModule: true, default: () => null },
    '../stores/useSimpleProgressStore': {
      useSimpleProgressStore: (select) => select({ getProgress: () => ({ message: progressMessage }) }),
    },
    '../ui': { Btn: ({ children, onClick, variant }) => { if (extra.onButton) extra.onButton(children, onClick, variant); return React.createElement('button', {}, children) }, Dialog: () => null, StatusDot: ({ label }) => React.createElement('span', {}, label), Icon: { Play: () => null, Refresh: () => null, Trash: () => null } },
  }
  function load(file) {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText
    runInSandbox(code, {
      module, exports: module.exports, console: { log() {} },
      require: (id) => {
        if (id in stubs) return stubs[id]
        if (id === '@event-catalog' || id === '@failure-messages' || id === '@provider-presets' || id === '@provider-quality') {
          const file = id === '@event-catalog' ? '../../backend/core/event_catalog.json'
            : id === '@failure-messages' ? '../../backend/core/failure_messages.json'
            : id === '@provider-presets' ? '../../backend/presets/provider_presets.json'
            : '../../backend/presets/provider_quality.json'
          const data = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))
          return { default: data, __esModule: true }
        }
        if (id.startsWith('.')) {
          const base = path.resolve(path.dirname(file), id)
          const candidate = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find(p => fs.existsSync(p))
          if (!candidate) throw new Error('cannot resolve ' + id + ' from ' + file)
          return load(candidate)
        }
        return require(id)
      },
    })
    return module.exports
  }
  const Card = load(path.join(__dirname, '../src/components/ProjectCard.tsx')).default
  if (extra) extra.opened = opened
  return renderToStaticMarkup(React.createElement(Card, {
    project: { id: 'test', name: 'Example', status, error_message: error, created_at: '2026-09-30', ...(extra.project || {}) },
    onDelete() {},
    ...props,
  }))
}

const WEAK = 'The current local model could not return a usable timeline.'
const LEGACY = 'Timeline extraction failed: no valid time interval was returned (82 tags and 14 subtitle blocks). This model often cannot produce a structured timeline, and automatic retries are exhausted. Switch to a cloud model or a larger model. This step has not yet applied score or minimum-duration filters.'

test('#428 home card with a replacement stays on the card and offers switch-and-retry', () => {
  const visited = []
  const buttons = {}
  const switched = []
  const html = renderCard('failed', WEAK, null, {
    project: { error_code: 'invalid_response', name: 'Interview with General Ma' },
    onButton: (label, onClick) => { buttons[label] = onClick },
  }, to => visited.push(to), { replacement: { displayName: 'DeepSeek' }, onSwitchAndRetry: id => switched.push(id) })
  assert.match(html, /Failed/)
  assert.match(html, /The current local model could not return a usable timeline./)
  assert.match(html, /Try again with/)
  assert.match(html, /<strong>DeepSeek<\/strong>/)
  assert.doesNotMatch(html, /82|subtitle blocks|automatic retries|often cannot produce/i)
  assert.equal(html.includes('href="/project/'), false)
  buttons['Switch and retry']()
  assert.deepEqual(switched, ['test'])
  buttons['Other models']()
  assert.deepEqual(visited, ['/settings?section=analysis'])
})

test('#428 home card without a replacement offers configure, and does not open the project', () => {
  const visited = []
  const buttons = {}
  const html = renderCard('failed', LEGACY, null, {
    project: { error_code: 'invalid_response' },
    onButton: (label, onClick) => { buttons[label] = onClick },
  }, to => visited.push(to))
  assert.match(html, /The current local model could not return a usable timeline./)
  assert.doesNotMatch(html, /82|subtitle blocks|automatic retries/i)
  assert.equal(buttons['Switch and retry'], undefined)
  buttons['Configure model']()
  assert.deepEqual(visited, ['/settings?section=analysis'])
  assert.equal(typeof buttons['Retry'], 'function')
})

test('B2 home card: whisper gate codes lead with Install transcription and keep retry secondary', () => {
  for (const code of ['whisper_not_installed', 'whisper_install_failed', 'whisper_model_missing', 'whisper_model_failed']) {
    const visited = []
    const buttons = {}
    renderCard('failed', 'Local transcription is not installed.', null, {
      project: { error_code: code },
      onButton: (label, onClick, variant) => { buttons[label] = { onClick, variant } },
    }, to => visited.push(to))
    assert.equal(buttons['Install transcription'].variant, 'cta', code)
    assert.equal(buttons['Retry'].variant, 'text', code)
    assert.equal(buttons['Transcription'], undefined, code)
    buttons['Install transcription'].onClick()
    assert.deepEqual(visited, ['/settings?section=speech'])
  }
  const buttons = {}
  renderCard('failed', 'Request timeout', null, {
    project: { error_code: 'timeout' },
    onButton: (label, onClick, variant) => { buttons[label] = { onClick, variant } },
  })
  assert.equal(buttons['Install transcription'], undefined)
  assert.equal(buttons['Retry'].variant, 'text')
})

test('a generic invalid timeline does not add model settings on the project card', () => {
  const buttons = {}
  const error = 'Timeline extraction returned no valid time interval. No usable segments remained after filtering.'
  renderCard('failed', error, null, {
    project: { error_code: 'invalid_response' },
    onButton: (label, onClick) => { buttons[label] = onClick },
  })
  assert.equal(buttons['Model settings'], undefined)
})

test('a quota failure is not rewritten into an invalid-key prompt', () => {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../backend/core/failure_messages.json'), 'utf8'))
  const html = renderCard('failed', messages.insufficient_quota, null, {
    project: { error_code: 'llm_auth_invalid', upstream_error_type: 'insufficient_quota' },
  })
  assert.match(html, /Top up or replace the token/)
  assert.doesNotMatch(html, /API Key Invalid/)
})

test('failed project shows the persisted reason even after progress state is lost', () => {
  const html = renderCard('error', 'The Whisper model file is missing or incomplete.')
  assert.match(html, /role="alert"/)
  assert.match(html, /The Whisper model file is missing or incomplete\./)
})

test('progress failure remains visible before project refresh and is escaped', () => {
  const html = renderCard('failed', null, 'failed <script>alert(1)</script>')
  assert.match(html, /failed &lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})

test('successful retry does not show a stale failure', () => {
  const html = renderCard('completed', 'stale failure', 'old progress')
  assert.doesNotMatch(html, /stale failure|old progress|role="alert"/)
})

test('restart-interrupted automatic project shows its reason and regenerates from the project page (RC156 #13)', async () => {
  const visited = []
  const buttons = {}
  const restart = USER_MESSAGES.service_restarted
  const html = renderCard('failed', restart, null, {
    project: { error_code: 'service_restarted', settings: { smart_import: { auto_start: true }, studio_generation_status: 'failed' } },
    onButton: (label, onClick) => { buttons[label] = onClick },
  }, (to) => visited.push(to))
  assert.match(html, /role="alert"/)
  assert.ok(html.includes(restart))
  assert.match(html, />Regenerate</)
  await buttons['Regenerate']()
  assert.deepEqual(visited, ['/project/test'])
})

test('managed project without a finished generation still reopens import review', async () => {
  const visited = []
  const buttons = {}
  renderCard('failed', 'ImportFailed', null, {
    project: { settings: { smart_import: { auto_start: false } } },
    onButton: (label, onClick) => { buttons[label] = onClick },
  }, (to) => visited.push(to))
  await buttons['Retry']()
  assert.deepEqual(visited, ['/import/test'])
})


test('X2 home card: whisper gates lead with install_asr CTA Install transcription', () => {
  for (const code of ['whisper_not_installed', 'whisper_install_failed', 'whisper_model_missing', 'whisper_model_failed']) {
    const visited = []
    const buttons = {}
    renderCard('failed', 'Local transcription is not installed.', null, {
      project: { error_code: code },
      onButton: (label, onClick, variant) => { buttons[label] = { onClick, variant } },
    }, to => visited.push(to))
    assert.equal(buttons['Install transcription'].variant, 'cta', code)
    assert.equal(buttons['Try another model'], undefined, code)
    buttons['Install transcription'].onClick()
    assert.deepEqual(visited, ['/settings?section=speech'])
  }
})

test('X2 home card: switchable upstream + ≥2 connections offers Try another model', () => {
  const switched = []
  const buttons = {}
  const options = [
    { connectionId: 'c1', model: 'm1', displayName: 'A', providerId: 'api88', success_rate: 0.9 },
    { connectionId: 'c2', model: 'm2', displayName: 'B', providerId: 'infistar', success_rate: 0.8 },
  ]
  renderCard('failed', 'Too many requests', null, {
    project: { error_code: 'rate_limited', upstream_error_type: 'rate_limited' },
    onButton: (label, onClick, variant) => { buttons[label] = { onClick, variant } },
  }, () => {}, {
    connectionCount: 2,
    switchOptions: options,
    onSwitchAndRetry: (id, choice) => { switched.push({ id, choice }) },
  })
  assert.equal(buttons['Try another model'].variant, 'cta')
  assert.equal(typeof buttons['Retry'].onClick, 'function')
  // Without a real dialog stub capturing open, openSwitchDialog sets switchOpen;
  // SwitchModelDialog is stubbed null so confirm path is covered via onSwitchAndRetry with choice in HomePage.
  buttons['Try another model'].onClick()
})

test('X2 home card: switchable upstream + 1 connection offers Open settings (add provider)', () => {
  const visited = []
  const buttons = {}
  renderCard('failed', 'Upstream timeout', null, {
    project: { error_code: 'timeout', upstream_error_type: 'timeout' },
    onButton: (label, onClick, variant) => { buttons[label] = { onClick, variant } },
  }, to => visited.push(to), { connectionCount: 1 })
  assert.equal(buttons['Open settings'].variant, 'cta')
  assert.equal(buttons['Try another model'], undefined)
  buttons['Open settings'].onClick()
  assert.deepEqual(visited, ['/settings?section=analysis'])
})

test('X2/X3 home card: insufficient_quota + sponsor offers Go 88API Top up', () => {
  const visited = []
  const buttons = {}
  const extra = {
    project: { error_code: 'provider_error', upstream_error_type: 'insufficient_quota' },
    onButton: (label, onClick, variant) => { buttons[label] = { onClick, variant } },
  }
  renderCard('failed', 'Insufficient balance', null, extra, to => visited.push(to), { analysisProvider: 'api88' })
  assert.equal(buttons['Go 88API Top up'].variant, 'cta')
  buttons['Go 88API Top up'].onClick()
  assert.deepEqual(visited, [])
  assert.ok(extra.opened.some(url => url.includes('88api.ai')))
})


test('failed card with empty/bare message still shows step-level human copy (#491 tip soft)', () => {
  const restart = USER_MESSAGES.service_restarted
  for (const [error, code] of [[null, 'service_restarted'], ['', 'timeout'], ['Error', 'provider_error'], ['Failed', null]]) {
    const html = renderCard('failed', error, null, { project: { error_code: code } })
    assert.match(html, /role="alert"/, String(error))
    assert.match(html, /[DownloadTranscriptionAnalysisProduction]：/, String(error))
    assert.doesNotMatch(html, /role="alert"[^>]*>\s*<span[^>]*>Error<\/span>/, String(error))
    if (code === 'service_restarted') assert.ok(html.includes(restart))
  }
})

test('failed card with a timeout code keeps the English reason and step prefix', () => {
  const timeout = USER_MESSAGES.timeout
  const html = renderCard('failed', timeout, null, {
    project: { error_code: 'timeout', processing_config: { failure_stage: 'highlight' } },
  })
  assert.match(html, /Analysis：/)
  assert.ok(html.includes(timeout))
})


test('failed card with billable_calls_before_failure shows Consumed this time (#491 tip soft)', () => {
  const html = renderCard('failed', 'Error', null, {
    project: {
      error_code: 'provider_error',
      processing_config: { billable_calls_before_failure: 3, failure_stage: 'analyze' },
    },
  })
  assert.match(html, /Analysis：/)
  assert.match(html, /ac-project-billing/)
  assert.match(html, /Consumed this time 3 Requests/)
  const quiet = renderCard('failed', 'Error', null, {
    project: { error_code: 'provider_error', processing_config: { billable_calls_before_failure: 0 } },
  })
  assert.doesNotMatch(quiet, /Consumed this time/)
  const viaSettings = renderCard('failed', 'Error', null, {
    project: { error_code: 'provider_error', settings: { billable_calls_before_failure: 2 } },
  })
  assert.match(viaSettings, /Consumed this time 2 Requests/)
})
