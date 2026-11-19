const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInSandbox } = require('./vm-sandbox.cjs')
const ts = require('typescript')

function loadClassifier() {
  const file = path.join(__dirname, '../src/utils/subtitleFailure.ts')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  runInSandbox(code, { module, exports: module.exports })
  return module.exports
}

const { classifySubtitleFailure } = loadClassifier()

const LEGACY = 'No captions to analyze: the video has no subtitles, and local transcription produced no results. Install Whisper from Settings → Default models → Speech to subtitles, or import an SRT file and retry.'

test('classifies structured codes and the four user-facing cases', () => {
  assert.equal(classifySubtitleFailure('anything', 'whisper_not_installed'), 'whisper_not_installed')
  assert.equal(classifySubtitleFailure('anything', 'whisper_install_failed'), 'whisper_install_failed')
  assert.equal(classifySubtitleFailure('anything', 'transcription_empty'), 'transcription_empty')
  assert.equal(classifySubtitleFailure('Graphics cardFailed', 'subtitle_setup'), 'subtitle_setup')
  assert.equal(classifySubtitleFailure(LEGACY), 'subtitle_unknown')
  assert.equal(
    classifySubtitleFailure('No captions to analyze: the video has no subtitles, and Whisper is not installed. Install it from Settings → Default models → Speech to subtitles.'),
    'whisper_not_installed',
  )
  assert.equal(
    classifySubtitleFailure('No captions to analyze: the video has no subtitles, and Whisper installation failed.'),
    'whisper_install_failed',
  )
  assert.equal(
    classifySubtitleFailure('No captions to analyze: Whisper is installed, but no subtitles were generated.'),
    'transcription_empty',
  )
  assert.equal(classifySubtitleFailure('Subtitle file does not exist on this system.'), 'subtitle_unknown')
})

test('does not treat unrelated failures as a transcription settings problem', () => {
  assert.equal(classifySubtitleFailure('No AI model is configured. Check Settings → Providers and models.'), null)
  assert.equal(classifySubtitleFailure('No clips passed the score filter. Lower the minimum score in Settings and retry.'), null)
  const timeline = 'Timeline extraction is empty. No usable segments remained after filtering; try a longer video or provide more complete subtitles.'
  assert.equal(classifySubtitleFailure(timeline), null)
  assert.equal(classifySubtitleFailure(timeline, 'timeline_empty'), null)
  assert.equal(classifySubtitleFailure(''), null)
  assert.equal(classifySubtitleFailure(null, 'not_a_code'), null)
})


test('safe cloud ASR failures keep the generic failure view and never request Whisper installation', () => {
  const hint = 'Check the selected cloud transcription service, API key, and model in Settings → Default models → Speech to subtitles, then retry or import an SRT file.'
  const messages = [
    'Cloud transcription request failed (HTTP 409). Check the API key, quota, and model permissions.',
    'Cloud transcription connection failed or returned an invalid response. Please retry later.',
    'The transcription result is empty; there may be no recognizable speech in the audio.',
    'No transcription result is available yet.',
  ]
  for (const message of messages) {
    assert.equal(classifySubtitleFailure(`Cloud transcription failed: ${message} ${hint}`, 'provider_error'), null)
  }
})

test('source_too_short / source_no_audio never open transcription settings (RC156 #10 #11)', () => {
  const noAudio = 'This video has no sound, so subtitles cannot be generated. Attach an SRT file and import it again. To edit from the picture, switch to a vision-capable model in Settings → Providers and models.'
  assert.equal(classifySubtitleFailure(noAudio, 'source_no_audio'), null)
  assert.equal(classifySubtitleFailure('This video is too short: under 20 seconds there is not enough material for a complete subtitle-based clip. Please use a video of at least 20 seconds.', 'source_too_short'), null)
  // Even text mentioning transcription settings stays out when the code says it is the source.
  assert.equal(classifySubtitleFailure('Subtitles Settings → Default models → Speech to subtitles', 'source_no_audio'), null)
})
