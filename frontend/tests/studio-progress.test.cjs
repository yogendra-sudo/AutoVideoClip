const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./load-ts.cjs')

const progress = loadTs(path.resolve(__dirname, '../src/features/studio/studioProgress.ts'))
const failure = loadTs(path.resolve(__dirname, '../src/features/studio/failureAction.ts'))

const NOW = Date.parse('2026-10-26T12:00:00Z')

test('transcription audio percent maps into the subtitle band and never reads as 100', () => {
  const view = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'production', message: 'Generating subtitles', percent: 100, progress_stage: 'SUBTITLE' },
  }, NOW)
  assert.equal(view.label, 'Processing subtitles')
  assert.equal(view.approximate, false)
  assert.ok(view.percent > 10 && view.percent < 30)
  assert.notEqual(view.percent, 100)
})

test('a long approximate stage eases toward the band and stops short of done', () => {
  const start = Date.parse('2026-10-26T00:00:00Z')
  const early = progress.studioRunProgress({
    analysis: {
      status: 'running', phase: 'production', message: 'Producing ready-to-post videos',
      progress_stage: 'ANALYZE', progress_approximate: true, progress_since: start / 1000,
      created_at: new Date(start).toISOString(),
    },
  }, start + 1000)
  const later = progress.studioRunProgress({
    analysis: {
      status: 'running', phase: 'production', message: 'Producing ready-to-post videos',
      progress_stage: 'ANALYZE', progress_approximate: true, progress_since: start / 1000,
      created_at: new Date(start).toISOString(),
    },
  }, start + 10 * 60 * 60 * 1000)
  assert.equal(early.approximate, true)
  assert.ok(later.percent >= early.percent)
  assert.ok(later.percent < 99)
  assert.ok(later.percent <= 95)
  assert.equal(progress.easePercent('ANALYZE', 25, 1e9) < progress.stageBand('ANALYZE').end, true)
  assert.equal(later.elapsedMinutes, 600)
})

test('a reported percent never moves backward and a finished run hides the bar', () => {
  const view = progress.studioRunProgress({
    analysis: {
      status: 'running', phase: 'production', message: 'Producing ready-to-post videos',
      progress_percent: 70, progress_stage: 'HIGHLIGHT', progress_approximate: false,
    },
  }, NOW)
  assert.equal(view.percent, 70)
  assert.equal(view.approximate, false)
  assert.equal(progress.studioRunProgress({
    analysis: { status: 'completed', phase: 'production', progress_percent: 100, progress_stage: 'DONE' },
  }, NOW), null)
})

test('the 20-minute model cap applies only to analysis stages', () => {
  const download = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'screening', percent: 40, message: 'Downloading media' },
  }, NOW)
  assert.equal(download.modelBudget, false)
  const whisper = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'production', message: 'Generating subtitles', percent: 10, progress_stage: 'SUBTITLE' },
  }, NOW)
  assert.equal(whisper.modelBudget, false)
  const rendering = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'rendering', message: 'Rendering ready-to-post videos' },
    jobs: [{ status: 'running', percent: 10 }],
  }, NOW)
  assert.equal(rendering.modelBudget, false)
  const analyze = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'production', message: 'Producing ready-to-post videos', progress_stage: 'ANALYZE', progress_approximate: true },
  }, NOW)
  assert.equal(analyze.modelBudget, true)
  const highlight = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'production', progress_stage: 'HIGHLIGHT' },
  }, NOW)
  assert.equal(highlight.modelBudget, true)
})

test('merge leaves the capped download percent and keeps elapsed time', () => {
  const merging = progress.studioRunProgress({
    analysis: {
      status: 'running', phase: 'screening', message: 'Merging audio and video', percent: 99,
      created_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
    },
  }, NOW)
  assert.equal(merging.label, 'Merging audio and video')
  assert.equal(merging.indeterminate, true)
  assert.equal(merging.approximate, false)
  assert.equal(merging.modelBudget, false)
  assert.equal(merging.elapsedMinutes, 5)
  const shown = progress.displayedProgress(merging, 95)
  assert.equal(shown.floor, 95)
  assert.equal(shown.view.indeterminate, true)
  const downloading = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'screening', message: 'Preparing media', percent: 99 },
  }, NOW)
  assert.equal(downloading.label, 'Downloading')
  assert.equal(downloading.percent, 95)
  assert.equal(downloading.indeterminate, undefined)
  assert.equal(progress.displayedProgress(downloading, 40).view.percent, 95)
})

test('download percent is the screening bar; rendering keeps the export band under 100', () => {
  const download = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'screening', percent: 40, message: 'Downloading media' },
  }, NOW)
  assert.equal(download.label, 'Downloading')
  assert.equal(download.percent, 40)
  assert.equal(download.approximate, false)
  const rendering = progress.studioRunProgress({
    analysis: { status: 'running', phase: 'rendering', message: 'Rendering ready-to-post videos', progress_percent: 70, progress_since: NOW / 1000 },
    jobs: [{ status: 'running', percent: 100 }],
  }, NOW + 60_000)
  assert.equal(rendering.label, 'Exporting video')
  assert.ok(rendering.percent >= 70 && rendering.percent < 100)
  assert.equal(rendering.approximate, false)
})

test('failure copy names the step and adds billing guidance only after a billable call', () => {
  assert.equal(failure.failureStep('subtitle', 'production', 'timeout'), 'Transcription')
  assert.equal(failure.failureStep(undefined, 'screening', 'source_unreadable'), 'Download')
  assert.equal(failure.failureStep(undefined, 'screening', 'file_locked'), 'Download')
  assert.equal(failure.failureStep(undefined, 'screening', 'whisper_not_installed'), 'Transcription')
  assert.equal(failure.failureStep(undefined, 'screening', 'llm_not_configured'), 'Analysis')
  assert.equal(failure.failureStep('analyze', 'production', 'invalid_response'), 'Analysis')
  assert.equal(failure.failureStep(undefined, 'rendering', 'timeout'), 'Production')
  const billed = failure.presentedFailure({ error: 'Error', error_code: 'invalid_response', failure_stage: 'analyze', billable_calls_before_failure: 1 })
  assert.equal(billed.step, 'Analysis')
  assert.notEqual(billed.reason, 'Error')
  assert.equal(billed.reason, 'The model returned an unusable response. Try again later.')
  assert.match(billed.billing, /Consumed this time 1 Requests/)
  assert.equal(billed.billing.includes('Yuan'), false)
  const quiet = failure.presentedFailure({ error: 'Error', error_code: 'invalid_response', failure_stage: 'analyze', billable_calls_before_failure: 0 })
  assert.equal(quiet.billing, null)
})


test('R1 ETA fields appear when provider and source duration are known', () => {
  const started = new Date(NOW - 60_000).toISOString()
  const view = progress.studioRunProgress({
    analysis: {
      status: 'running', phase: 'production', message: 'Producing ready-to-post videos',
      progress_stage: 'SUBTITLE', progress_approximate: true, provider: 'ollama', run_id: 'run-eta',
      created_at: started,
    },
    generation: { created_at: started, provider: 'ollama', attempt_id: 't-aaaaaaaaaaaaaaaa' },
    source_duration_sec: 600,
    concurrency: 1,
  }, NOW)
  assert.equal(view.canLeave, true)
  assert.equal(typeof view.etaOverrun, 'boolean')
  assert.ok('etaMin' in view)
  assert.ok('etaInitialMin' in view)
  assert.equal(view.etaMin != null || view.etaOverrun || view.etaInitialMin != null, true)
})
