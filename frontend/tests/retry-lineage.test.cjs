// Behavior tests for retry_of on the retry button.

// retry-lineage.test.cjs
;(() => {
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./load-ts.cjs')

function harness() {
  const workflow = loadTs(path.resolve(__dirname, '../src/analytics/workflow.ts'))
  const events = []
  const tracker = new workflow.WorkflowTracker({ getItem: () => null, setItem() {}, removeItem() {} },
    () => true, (event, props) => { events.push({ event, props }); return true })
  const studio = {
    observeStudioOperation: async (_name, action, accepted = () => {}, props = {}) => { const r = await action(); accepted(r, { ...props }); return r },
    studioImportProperties: () => ({}), studioGoals: () => ({}), observeStudioWorkspace: () => {},
  }
  const api = loadTs(path.resolve(__dirname, '../src/features/studio/api.ts'), {
    '../../analytics/posthog': { captureBusinessEvent() {} },
    '../../analytics/workflow': workflow,
    '../../analytics/studio': studio,
    '../../analytics/observer': { workflow: tracker },
    '../../services/api': { default: { post: async () => ({ analysis_run_id: 'r-next' }), put: async () => ({}), get: async () => ({}) }, __esModule: true },
    './noticeRuntime': { noteWorkspaceCompletion() {} },
    './subtitleState': { effectiveSubtitles: x => x },
  })
  const finished = name => events.filter(e => e.event === name).map(e => e.props)
  const watchOf = kind => tracker.list().filter(w => w.kind === kind).at(-1)
  return { tracker, studioApi: api.studioApi, finished, watchOf }
}
const failedGen = { material_origin: 'user', generation: { status: 'failed', error_code: 'service_restarted' }, analysis: { status: 'failed', phase: 'production', error_code: 'service_restarted' } }
const okGen = { ...failedGen, generation: { status: 'completed' }, analysis: { status: 'completed' } }

test('1.5.7 retry_of only from the Retry button and only when the previous attempt failed', async () => {
  // not from a plain re-analyze / re-plan restart
  let h = harness()
  h.tracker.watch('studio-generation', 'p1'); h.tracker.observeStudio(h.watchOf('studio-generation'), failedGen)
  await h.studioApi.analyze('p1', true)
  await h.studioApi.correctPlan('p1', {})
  h.tracker.watch('framing-runtime', 'p1', 'p1', undefined, {}, true)
  for (const w of h.tracker.list()) assert.equal(w.properties.retry_of, undefined, w.kind)
  // not when the previous attempt succeeded
  h = harness()
  h.tracker.watch('studio-generation', 'p1'); h.tracker.observeStudio(h.watchOf('studio-generation'), okGen)
  await h.studioApi.analyze('p1', true, true)
  assert.equal(h.watchOf('studio-generation').properties.retry_of, undefined)
  // not when the previous attempt is still running
  h = harness()
  h.tracker.watch('studio-generation', 'p1')
  await h.studioApi.analyze('p1', true, true)
  assert.equal(h.watchOf('studio-generation').properties.retry_of, undefined)
})

test('1.5.7 failed-state action per code: user-cause codes get 「Open settings」, whisper gates open install, everything else keeps Retry', () => {
  const fs = require('node:fs')
  const fa = loadTs(path.resolve(__dirname, '../src/features/studio/failureAction.ts'))
  const settings = { authentication: 'The API key is invalid or expired. Update it in Settings, then try again.', llm_auth_invalid: 'The API key is invalid or expired. Update it in Settings, then try again.', invalid_key: 'The API key is invalid or expired. Update it in Settings, then try again.', insufficient_quota: 'Your balance or token quota is used up. Top up or replace the token, then try again.', llm_not_configured: 'No AI model is configured. Add a provider and API key in Settings.' }
  for (const [code, reason] of Object.entries(settings)) {
    // 1.5.9 3B: insufficient_quota locks bare retry → settings CTA labelled Check balance and test connection
    if (code === 'insufficient_quota') {
      assert.deepEqual(
        { ...fa.failureAction(code) },
        { kind: 'settings', reason, destination: '/settings?section=analysis', label: 'Check balance and test connection' },
        code,
      )
      continue
    }
    assert.deepEqual({ ...fa.failureAction(code) }, { kind: 'settings', reason, destination: '/settings?section=analysis' }, code)
  }
  assert.equal(fa.failureAction('provider_error', 'permission_denied').kind, 'settings')
  assert.equal(fa.failureAction('provider_error', 'invalid_key').reason, settings.invalid_key)
  for (const code of ['service_restarted', 'timeout', 'connection', 'rate_limited', 'provider_error', 'model_not_found', 'bad_endpoint', 'source_too_short', 'unexpected', '', undefined, null]) {
    assert.equal(fa.failureAction(code).kind, 'retry', String(code))
  }
  for (const code of fa.WHISPER_GATE_CODES) {
    const action = fa.failureAction(code)
    assert.equal(action.kind, 'install_asr', code)
    assert.equal(action.destination, '/settings?section=speech', code)
  }
  assert.equal(fa.failureAction('timeout', 'rate_limited').kind, 'retry')
  // single shared source: TS mirrors event_catalog attribution.user_cause (both copies)
  for (const file of ['../../backend/core/event_catalog.json', '../../docs/analytics/event_catalog.json']) {
    const uc = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8')).attribution.user_cause
    assert.deepEqual([...fa.USER_CAUSE_ERROR_CODES], uc.error_codes, file)
    assert.deepEqual([...fa.USER_CAUSE_UPSTREAM_TYPES], uc.upstream_types, file)
    const v4 = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf8')).attribution.success_rate_v4
    if (v4) {  // once #416 lands: user_cause == v4 overall exclusion minus cancellation
      assert.deepEqual([...uc.error_codes].sort(), v4.overall_excluded_error_codes.filter(c => !/cancel/.test(c)).sort())
      assert.deepEqual([...uc.upstream_types].sort(), [...v4.overall_excluded_upstream_types].sort())
    }
  }
  // reasons + button copy in every locale catalog
  for (const lang of ['en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh']) {
    const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../src/i18n/locales/${lang}.json`), 'utf8'))
    for (const key of ['Open settings', 'Continue', 'Install transcription', ...new Set([...Object.values(settings), "This token can't use that model. In the provider console, enable the model or switch groups."])]) assert.ok(data[key], `${lang}: ${key}`)
  }
  // UI wiring: rendered behaviour (FailureActions) is covered in studio-results-status
})
})()
