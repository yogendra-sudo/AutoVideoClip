const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const { runInSandbox } = require('./vm-sandbox.cjs')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function render(automatic, phase, status = 'running', buttons = [], calls = [], errorCode, failureStage, error = 'failure', message = 'screening') {
  const workspace = {
    analysis: { status, phase, message, error, error_code: errorCode, failure_stage: failureStage },
    generation: generationOverride.value || (automatic ? { auto_start: true, status: status === 'failed' ? 'failed' : 'screening' } : null),
    drafts: [], jobs: [], events: [], output_variants: [], attempts: attemptsOverride.value || undefined,
  }
  const exportsObject = {}
  const children = ({ children }) => React.createElement('div', null, children)
  const empty = () => null
  const moduleRequire = (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name)
    if (name === 'react-i18next') return { useTranslation() {} }
    if (name === 'react-router-dom') return { useNavigate: () => to => navigations.push(to), useLocation: () => ({ search: routeSearch.value }) }
    if (name === './settingsReturn') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/settingsReturn.ts'))
    if (name === './failureAction') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/failureAction.ts'))
    if (name === './studioProgress') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/studioProgress.ts'))
    if (name === '../../i18n') return { t: value => value, getLocale: () => 'zh' }
    if (name === '../../ui') return { Btn: props => { buttons.push(props); return React.createElement('button', null, props.children) },
      Section: ({ children, description, right }) => React.createElement('section', null, description, right, children),
      Dialog: empty, fmtDuration: String }
    if (name === './useWorkspace') return { useWorkspace: () => ({ workspace, loaded: true, loading: false, refresh() {} }) }
    if (name === './api') return { studioApi: { source: () => '/test.mp4', analyze: async (...args) => calls.push(args), retry: async (...args) => calls.push(['retry', ...args]) }, errorText: String }
    if (name === '../../utils/llmFailure') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/utils/llmFailure.ts'))
    if (name === '../../utils/timelineFailure') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/utils/timelineFailure.ts'))
    if (name === './importReadiness') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/importReadiness.ts'))
    if (name === './browserCookieRecovery') return require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/browserCookieRecovery.ts'))
    if (name === './platformLabel') return { platformLabel: String }
    if (name === '../../analytics/flags') return { flagEnabled: () => false, flagAssigned: () => false }
    if (name === '../../analytics/studio') return { trackLegacyEntry() {} }
    if (name === './legacyEntrypoints') return { legacyEntrypointsHidden: () => false }
    if (name === './FailureActions') return loadTsx('../src/features/studio/FailureActions.tsx', moduleRequire)
    if (name === './SwitchModelDialog') return { __esModule: true, default: empty }
    if (name === './switchModelOptions') return {
      listSwitchModelOptions: () => [],
      usableConnectionCount: () => null,
      analysisProviderId: () => null,
    }
    if (name === '../../utils/externalLinks') return { openExternalLink: async () => {} }
    if (name === '../settings/modelSettingsApi') return { modelSettingsApi: { get: async () => null, save: async v => v }, forSave: x => x }
    if (name === '../settings/modelSettingsLogic') return { forSave: x => x }
    if (name === '../settings/modelDefaults') return { syncFollowingCover: (_a, b) => b }
    if (name === './etaModel') return { recordSuccess: () => {}, estimate: () => ({}) }
    if (name === './platformMemory') return {
      dismissMorePlatformBanner: () => {},
      hasSuccessHistory: () => false,
      morePlatformBannerSeen: () => true,
      stashReuseImport: () => {},
      suggestAnotherPlatform: () => 'douyin',
    }
    if (name === './noticeRuntime') return { clearCompletionBadge: () => {}, subscribeCompletionNotice: () => () => {} }
    if (name === './completionNotice') return { noticeCopy: s => s }
    if (name === './overrides') return { followOutputLeave: () => {} }
    if (name === '../../analytics/observer') return { workflow: { emit: () => {} } }
    if (name === './ExportHistory') return { __esModule: true, default: empty }
    if (name === './DraftResultCard') return { __esModule: true, default: empty }
    if (name === './OutputVariantCard') return { __esModule: true, default: empty }
    if (name === './studio.css' || name === './quick-output.css') return {}
    return { default: empty }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/features/studio/StudioResults.tsx'), 'utf8')
  runInSandbox(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: exportsObject, require: moduleRequire, URLSearchParams })
  return renderToStaticMarkup(React.createElement(exportsObject.default, {
    project: { id: 'test', status: 'processing', settings: { smart_import: {} }, clips: [], collections: [] },
    onCreateCollection() {}, onReload() {},
  }))
}

function loadTsx(rel, moduleRequire, globals = {}) {
  const exportsObject = {}
  const src = fs.readFileSync(path.join(__dirname, rel), 'utf8')
  runInSandbox(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports: exportsObject, require: moduleRequire, URLSearchParams, ...globals })
  return exportsObject
}

const navigations = []
const generationOverride = { value: null }
const attemptsOverride = { value: null }
const routeSearch = { value: '' }

test('automatic screening never asks for a manual confirmation', () => {
  assert.doesNotMatch(render(true, 'screening'), /Confirm the content types after identification/)
})
test('manual screening keeps its confirmation guidance', () => {
  assert.match(render(false, 'screening'), /Confirm the content types after identification\. Editing has not started\./)
})
test('failed automatic generation does not claim AI is still producing', () => {
  assert.doesNotMatch(render(true, 'screening', 'failed'), /AI is making videos for the platforms you chose/)
})

test('X1 two same-code failures lead with diagnose and keep retry secondary', () => {
  generationOverride.value = { auto_start: true, status: 'failed', repeat_failure: { count: 2, same_code: true } }
  try {
    const buttons = []
    render(true, 'production', 'failed', buttons, [], 'timeout', 'analyze')
    const diagnose = buttons.find(button => button.children === 'See what went wrong')
    const retry = buttons.find(button => button.children === 'Retry')
    assert.ok(diagnose)
    assert.equal(diagnose.variant, 'cta')
    assert.ok(retry)
    assert.notEqual(retry.variant, 'cta')
    assert.ok(buttons.indexOf(diagnose) < buttons.indexOf(retry))
  } finally {
    generationOverride.value = null
  }
})

test('failed automatic output exposes a retry that reuses the project and automatic route', async () => {
  const buttons = [], calls = []
  render(true, 'production', 'failed', buttons, calls)
  const retry = buttons.find(button => button.children === 'Retry')
  assert.ok(retry, 'failed automatic output must have a retry entry')
  await retry.onClick()
  assert.equal(JSON.stringify(calls), JSON.stringify([['retry', 'test', { retry_kind: 'same' }]]))  // #419: the one backend retry command
})
test('active automatic output never offers a second analysis submission', () => {
  const buttons = []
  render(true, 'production', 'running', buttons)
  assert.equal(buttons.some(button => button.children === 'Retry'), false)
})


test('#428 studio keeps a one-line reason and does not offer a second model picker', () => {
  const buttons = []
  navigations.length = 0
  const weak = 'Timeline extraction failed: no valid time interval was returned (82 tags and 14 subtitle blocks). This model often cannot produce a structured timeline, and automatic retries are exhausted. Switch to a cloud model or a larger model.'
  const html = render(true, 'production', 'failed', buttons, [], 'invalid_response', 'analyze', weak)
  assert.match(html, /The current local model could not return a usable timeline./)
  assert.doesNotMatch(html, /82|Hashtags|SubtitlesBlock|AutoRetryAlready used up|Switch and retry/)
  assert.equal(buttons.some(button => button.children === 'Model settings'), false)
  const retry = buttons.find(button => button.children === 'Retry')
  assert.ok(retry)
  assert.notEqual(retry.variant, 'cta')
  assert.deepEqual(navigations, [])
})

test('invalid API key renders the new copy instead of missing-key guidance', () => {
  const html = render(true, 'production', 'failed', [], [], 'llm_auth_invalid')
  assert.match(html, /The API key is invalid or expired. Update it in Settings, then try again./)
  assert.doesNotMatch(html, /You need your own API Key|Self-provided/)
})

test('R22 #212 / B2: a whisper gate failure leads with Install transcription, retry stays secondary', () => {
  for (const code of ['whisper_not_installed', 'whisper_install_failed', 'whisper_model_missing', 'whisper_model_failed']) {
    const buttons = []
    navigations.length = 0
    render(true, 'screening', 'failed', buttons, [], code)
    const entry = buttons.find(button => button.children === 'Install transcription')
    assert.ok(entry, `${code}: the failure page must lead with install transcription`)
    assert.equal(entry.variant, 'cta', code)
    const retry = buttons.find(button => button.children === 'Retry')
    assert.ok(retry, `${code}: retry stays available beside install`)
    assert.notEqual(retry.variant, 'cta', code)
    assert.equal(buttons.some(button => button.children === 'Open transcription settings' || button.children === 'Model settings' || button.children === 'Open settings'), false, code)
    entry.onClick()
    assert.deepEqual(navigations, ['/settings?section=speech'])
  }
  const waiting = []
  render(true, 'screening', 'failed', waiting, [], 'whisper_installing')
  assert.ok(waiting.find(button => button.children === 'Open transcription settings'))
  assert.equal(waiting.some(button => button.children === 'Install transcription'), false)
  const buttons = []
  navigations.length = 0
  render(true, 'screening', 'failed', buttons, [], 'llm_not_configured')
  buttons.find(button => button.children === 'Model settings').onClick()
  assert.deepEqual(navigations, ['/settings?section=ai'])
})

test('#481 source_blocked leads with the signed-in browser action', () => {
  const hint = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts')).USER_MESSAGES.source_blocked
  const buttons = []
  navigations.length = 0
  const html = render(true, 'screening', 'failed', buttons, [], 'source_blocked', 'ingest', hint)
  assert.match(html, /Download：/)
  assert.ok(html.includes(hint))
  assert.match(html, /Next: go back to import, choose a signed-in browser, then generate again./)
  assert.doesNotMatch(html, /No videos available yet|Model settings|Open settings|Open transcription settings/)
  assert.equal(buttons.some(b => b.children === 'Model settings' || b.children === 'Open settings' || b.children === 'Open transcription settings'), false)
  const go = buttons.find(b => b.children === 'Choose a signed-in browser')
  assert.equal(go.variant, 'cta')
  go.onClick()
  assert.deepEqual(navigations, ['/?focus=browser-cookies'])
  const retry = buttons.find(b => b.children === 'Retry')
  assert.ok(retry)
  assert.notEqual(retry.variant, 'cta')
  assert.ok(buttons.some(b => b.children === 'Use another video'))
})

test('R24 #231: an unreadable source is shown at once as a source problem: no spinner, no retry, no settings, pick another file', () => {
  const UNREADABLE = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts')).USER_MESSAGES.source_unreadable
  for (const automatic of [true, false]) {
    const buttons = []
    navigations.length = 0
    const html = render(automatic, 'screening', 'failed', buttons, [], 'source_unreadable', undefined, UNREADABLE)
    assert.match(html, /This source can&#x27;t be used/)
    assert.ok(html.includes(UNREADABLE), 'the unreadable message itself is on the page')
    assert.doesNotMatch(html, /class="spin"|Production did not complete/)
    assert.equal(buttons.some(b => b.children === 'Retry'), false, 'retrying the same file cannot help')
    assert.equal(buttons.some(b => b.children === 'Model settings' || b.children === 'Open transcription settings'), false)
    buttons.find(b => b.children === 'Use another video').onClick()
    assert.deepEqual(navigations, ['/'])
  }
})

for (const [code, automatic] of [['llm_auth_invalid', true], ['insufficient_quota', true], ['llm_not_configured', false], ['invalid_key', true]]) {
  test(`1.5.7 user-cause failure ${code} shows settings CTA with reason, no direct retry`, () => {
    const buttons = []
    const html = render(automatic, 'production', 'failed', buttons, [], code)
    assert.equal(buttons.some(b => b.children === 'Retry'), false)
    // 1.5.9 3B: insufficient_quota uses Check balance and test connection; other user-cause codes keep 「Open settings」.
    // Navigation target stays /settings?section=analysis&return_project=test either way.
    const label = code === 'insufficient_quota' ? 'Check balance and test connection' : 'Open settings'
    const go = buttons.find(b => b.children === label)
    assert.ok(go, `expected button ${label} for ${code}`)
    assert.match(html, /Please|Balance|Model/)
    navigations.length = 0
    go.onClick()
    assert.deepEqual(navigations, ['/settings?section=analysis&return_project=test'])
  })
}
for (const code of ['service_restarted', 'timeout', 'provider_error', 'model_not_found']) {
  test(`1.5.7 non-user failure ${code} keeps Retry and no 「Open settings」`, () => {
    const buttons = []
    render(true, 'production', 'failed', buttons, [], code)
    assert.ok(buttons.some(b => b.children === 'Retry'))
    assert.equal(buttons.some(b => b.children === 'Open settings'), false)
  })
}

for (const [stage, destination] of [['subtitle', '/settings?section=speech'], ['analyze', '/settings?section=analysis'], ['screening', '/settings?section=analysis'], [undefined, '/settings?section=analysis']]) {
  test(`1.5.7 「Open settings」 for a user-cause failure at stage ${stage} opens ${destination}`, () => {
    const buttons = []
    render(true, 'production', 'failed', buttons, [], 'invalid_key', stage)
    navigations.length = 0
    buttons.find(b => b.children === 'Open settings').onClick()
    assert.deepEqual(navigations, [destination + '&return_project=test'])
  })
}

test('1.5.7 settings page resolves both 「Open settings」 targets to their own rows (no fallback to the top)', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/SettingsPage.tsx'), 'utf8')
  const aliases = page.slice(page.indexOf('const SECTION_ALIASES'), page.indexOf('}\n', page.indexOf('const SECTION_ALIASES')))
  assert.match(aliases, /analysis: \{ section: 'ai', anchor: 'ai-defaults-analysis' \}/)
  assert.match(aliases, /speech: \{ section: 'ai', anchor: 'ai-defaults-transcription' \}/)
  const fa = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/failureAction.ts'))
  for (const dest of [fa.SETTINGS_DESTINATION, fa.TRANSCRIPTION_SETTINGS_DESTINATION]) {
    const section = new URLSearchParams(dest.split('?')[1]).get('section')
    assert.ok(new RegExp(`\\n\\s+${section}: \\{ section: 'ai', anchor: '`).test(aliases), dest)
  }
})

test('1.5.7 manual failed run hides Retry once a collection exists (R18 82)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/features/studio/StudioResults.tsx'), 'utf8')
  assert.ok(src.includes('project.collections?.length || workspace.jobs?.some'))
})
for (const [code, stage, destination] of [['authentication', 'subtitle', '/settings?section=speech'], ['provider_error', 'subtitle', null]]) {
  test(`1.5.7 cloud ASR ${code} at ${stage} -> ${destination || 'Retry'} (R18 80)`, () => {
    const buttons = []
    render(true, 'production', 'failed', buttons, [], code, stage)
    const go = buttons.find(b => b.children === 'Open settings')
    if (!destination) { assert.equal(go, undefined); assert.ok(buttons.some(b => b.children === 'Retry')); return }
    navigations.length = 0; go.onClick(); assert.deepEqual(navigations, [destination + '&return_project=test'])
  })
}
test('R19 #106 manual mode: transcription 401 (authentication @ subtitle) -> 「Open settings」 opens speech', () => {
  const buttons = []
  render(false, 'production', 'failed', buttons, [], 'authentication', 'subtitle')
  assert.equal(buttons.some(b => b.children === 'Retry'), false)
  navigations.length = 0
  buttons.find(b => b.children === 'Open settings').onClick()
  assert.deepEqual(navigations, ['/settings?section=speech&return_project=test'])
})

// after an auth failure the user fixes the key; there must be a way to continue the same project.
test('R20 #125 auth failure: 「Continue」 sits beside 「Open settings」 and reuses the retry API (retry=true)', async () => {
  routeSearch.value = ''
  const buttons = [], calls = []
  render(true, 'production', 'failed', buttons, calls, 'invalid_key', 'subtitle')
  assert.equal(buttons.find(b => b.variant === 'cta').children, 'Open settings')
  const cont = buttons.find(b => b.children === 'Continue')
  assert.ok(cont, 'auth failure must offer Continue')
  await cont.onClick()
  assert.equal(JSON.stringify(calls), JSON.stringify([['retry', 'test', { retry_kind: 'same' }]]))  // #419: backend retry command -> receipt with retry_of + new attempt_id
})
test('R20 #125 back from a successful settings save (?continue=1): 「Continue」 is the primary action', async () => {
  routeSearch.value = '?continue=1'
  const buttons = [], calls = []
  render(false, 'production', 'failed', buttons, calls, 'authentication', 'subtitle')
  routeSearch.value = ''
  assert.equal(buttons.find(b => b.variant === 'cta').children, 'Continue')
  assert.ok(buttons.some(b => b.children === 'Open settings'))
  assert.equal(buttons.some(b => b.children === 'Retry'), false)
  await buttons.find(b => b.children === 'Continue').onClick()
  assert.equal(JSON.stringify(calls), JSON.stringify([['retry', 'test', { retry_kind: 'same' }]]))
})
test('R20 #125 settings save returns to the project only when opened from one and the id is safe', () => {
  const r = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/settingsReturn.ts'))
  assert.equal(r.settingsReturnUrl('/settings?section=speech', 'p-1'), '/settings?section=speech&return_project=p-1')
  assert.equal(r.returnAfterSave('?section=speech&return_project=p-1'), '/project/p-1?continue=1')
  assert.equal(r.returnAfterSave('?section=speech'), null)
  assert.equal(r.returnAfterSave('?return_project=..%2F..%2Fx'), null)
  const fired = []
  r.notifySettingsSaved({ dispatchEvent: e => { fired.push(e.type); return true } })
  assert.deepEqual(fired, [r.SETTINGS_SAVED_EVENT])
})
test('R22 #173: the real listener returns to the project on the one save notification', () => {
  const r = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/settingsReturn.ts'))
  const listeners = {}, navigated = []
  const win = { addEventListener: (n, f) => { listeners[n] = f }, removeEventListener: (n) => { delete listeners[n] }, dispatchEvent: e => { listeners[e.type]?.(e); return true } }
  const effects = []
  const mod = loadTsx('../src/features/studio/SettingsReturnListener.tsx', name => {
    if (name === 'react') return { useEffect: f => effects.push(f) }
    if (name === 'react-router-dom') return { useLocation: () => ({ pathname: '/settings', search: '?section=speech&return_project=p-1' }), useNavigate: () => to => navigated.push(to) }
    if (name === './settingsReturn') return r
    throw new Error(name)
  }, { window: win })
  mod.default(); effects.forEach(f => f())
  r.notifySettingsSaved(win)                        // the function production calls after a validated save
  assert.deepEqual(navigated, ['/project/p-1?continue=1'])
  const hook = fs.readFileSync(path.join(__dirname, '../src/features/settings/useModelSettings.ts'), 'utf8')
  assert.ok(hook.includes('if (!failed && !visionFailed) notifySettingsSaved()'))
  assert.equal(/dispatchEvent|function notifySaved/.test(hook), false, 'no second notification implementation')
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  assert.ok(app.includes('<SettingsReturnListener />'))
})
test('R22 code health: failure state computed once, each button at most once', () => {
  const fa = loadTsx('../src/features/studio/FailureActions.tsx', name => name === './failureAction' ? require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/features/studio/failureAction.ts')) : name === '../../utils/llmFailure' ? require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/utils/llmFailure.ts')) : name === '../../utils/timelineFailure' ? require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/utils/timelineFailure.ts')) : name === '../../utils/externalLinks' ? { openExternalLink: async () => {} } : name === 'react/jsx-runtime' ? require(name) : {})
  const keys = p => JSON.parse(JSON.stringify(p.buttons.map(b => `${b.key}${b.cta ? '*' : ''}`)))
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'authentication' }, true, false)), ['settings*', 'continue'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'authentication' }, true, true)), ['continue*', 'settings'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'authentication' }, false, true)), ['settings*'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'timeout' }, true, false)), ['retry*'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'timeout' }, false, false)), [])
  const repeat = { count: 2, same_code: true }
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'timeout' }, true, false, repeat)), ['diagnose*', 'retry'])
  assert.equal(fa.failurePlan({ error_code: 'timeout' }, true, false, repeat).buttons[0].label, 'See what went wrong')
  assert.equal(fa.failurePlan({ error_code: 'timeout' }, true, false, repeat).buttons[1].cta, false)
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'timeout' }, false, false, repeat)), ['diagnose*'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'timeout' }, true, false, { count: 2, same_code: false })), ['retry*'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'authentication' }, true, false, repeat)), ['settings*', 'continue'])
  const install = fa.failurePlan({ error_code: 'whisper_not_installed' }, true, false)
  assert.deepEqual(keys(install), ['install_asr*', 'retry'])
  assert.equal(install.buttons[0].label, 'Install transcription')
  assert.equal(install.destination, '/settings?section=speech')
  assert.equal(install.buttons.some(button => button.key === 'retry'), true)
  const whisperBack = fa.failurePlan({ error_code: 'whisper_model_failed' }, true, true)
  assert.deepEqual(keys(whisperBack), ['install_asr*', 'retry'])
  assert.equal(whisperBack.buttons[0].label, 'Install transcription')
  assert.equal(fa.failurePlan({ error_code: 'provider_error', upstream_error_type: 'permission_denied' }, true, false).message, "This token can't use that model. In the provider console, enable the model or switch groups.")
  const weak = 'Timeline extraction failed: no valid time interval was returned (82 tags and 14 subtitle blocks). This model often cannot produce a structured timeline, and automatic retries are exhausted. Switch to a cloud model or a larger model.'
  const weakPlan = fa.failurePlan({ error_code: 'invalid_response', error: weak }, true, false)
  assert.equal(weakPlan.message, 'The current local model could not return a usable timeline.')
  assert.equal(weakPlan.message.includes('82'), false)
  assert.equal(weakPlan.destination, null)
  assert.deepEqual(keys(weakPlan), ['retry'])
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'invalid_response', error: weak }, true, true)), ['retry'])
  const generic = 'TimelineModelThe response does not have a valid time interval.（1 ItemHashtags，1 ItemSubtitlesBlock）。 Please switch to a stable oneBackStructured timelineModelAfterRetry；LocalModelNeeds to support currentSubtitlesLength。This step has not yet entered the evaluationpointsor shortestDurationFilter。'
  assert.deepEqual(keys(fa.failurePlan({ error_code: 'invalid_response', error: generic }, true, false)), ['retry*'])
})

// the results-page line for "this re-run finished, N earlier failures" shows only when the round completed
// and settle's not_redone_failed_count > 0; otherwise the original wording.
test('R29 #444 the re-run line shows only for a completed round with earlier failures left', () => {
  const NEW = /This re-run finished\. Earlier unfinished versions you can still retry:/
  const DONE = /Ready-to-publish videos are done for the platforms you chose/
  const at = generation => { generationOverride.value = { auto_start: true, ...generation }; try { return render(true, 'rendering', 'completed') } finally { generationOverride.value = null } }
  const withN = at({ status: 'completed', not_redone_failed_count: 2 })
  assert.match(withN, NEW); assert.doesNotMatch(withN, DONE)
  const zero = at({ status: 'completed', not_redone_failed_count: 0 })
  assert.doesNotMatch(zero, NEW); assert.match(zero, DONE)
  assert.doesNotMatch(at({ status: 'partial', not_redone_failed_count: 2 }), NEW)
})

test('running production shows a stage progress bar, not only spinner text', () => {
  const html = render(true, 'production', 'running')
  assert.match(html, /role="progressbar"/)
  assert.match(html, /Analyzing content/)
  assert.match(html, /\d+%/)
  assert.match(html, /Model steps are capped at about 20 minutes/)
  assert.match(html, /Progress is an estimate; the stage is what counts/)
  assert.doesNotMatch(html, /class="spin"/)
})

test('merge does not keep a download percent on the studio bar', () => {
  const html = render(true, 'screening', 'running', [], [], undefined, undefined, 'failure', 'Merging audio and video')
  assert.match(html, /Merging audio and video/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /studio-progress-fill--busy/)
  assert.doesNotMatch(html, /Downloading/)
  assert.doesNotMatch(html, /\d+%/)
  assert.doesNotMatch(html, /Progress is an estimate; the stage is what counts/)
})

test('download, transcription and export progress omit the 20-minute model cap', () => {
  const download = render(true, 'screening', 'running')
  assert.match(download, /Preparing media/)
  assert.doesNotMatch(download, /Model steps are capped at about 20 minutes/)
  assert.match(download, /Progress is an estimate; the stage is what counts/)
  const transcribe = render(true, 'production', 'running', [], [], undefined, undefined, 'failure', 'Generating subtitles')
  assert.match(transcribe, /Processing subtitles/)
  assert.doesNotMatch(transcribe, /Model steps are capped at about 20 minutes/)
  const exporting = render(true, 'rendering', 'running')
  assert.match(exporting, /Exporting video/)
  assert.doesNotMatch(exporting, /Model steps are capped at about 20 minutes/)
})

test('a bare Error names the step, and a billable call adds the billing sentence', () => {
  const sentence = 'The model service timed out. Try again later.'
  const guidance = 'Consumed this time 2 Requests'
  generationOverride.value = { auto_start: true, status: 'failed', billable_calls_before_failure: 2 }
  try {
    const html = render(true, 'production', 'failed', [], [], 'timeout', 'analyze', 'Error')
    assert.match(html, new RegExp('Analysis：' + sentence))
    assert.match(html, new RegExp(guidance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(html, /<span class="studio-error">Error<\/span>/)
  } finally {
    generationOverride.value = null
  }
  const quiet = render(true, 'production', 'failed', [], [], 'timeout', 'analyze', 'Error')
  assert.match(quiet, new RegExp('Analysis：' + sentence))
  assert.doesNotMatch(quiet, /Consumed this time/)
})

test('1.5.7 results page has no control that appends platforms', () => {
  const html = render(true, 'rendering', 'completed')
  assert.doesNotMatch(html, /AddPlatform/)
})
