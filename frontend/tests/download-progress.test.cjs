const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runInSandbox } = require('./vm-sandbox.cjs')
const ts = require('typescript')

function load(rel) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  runInSandbox(code, { module, exports: module.exports })
  return module.exports
}

const { readDownloadProgress, isSourceDownloading, displayedDownloadPercent } = load('../src/utils/downloadProgress.ts')

test('API settings.download_progress is the source download percent', () => {
  const project = {
    status: 'pending',
    settings: { download_status: 'downloading', download_progress: 30 },
  }
  assert.equal(readDownloadProgress(project), 30)
  assert.equal(isSourceDownloading(project), true)
})

test('progress 0 while download_status is downloading is still a download, not the 5% placeholder', () => {
  const project = {
    status: 'pending',
    settings: { download_status: 'downloading', download_progress: 0 },
  }
  assert.equal(readDownloadProgress(project), 0)
  assert.equal(isSourceDownloading(project), true)
})

test('a pending upload without download fields is not a source download', () => {
  const project = { status: 'pending', settings: { video_category: 'knowledge' } }
  assert.equal(readDownloadProgress(project), 0)
  assert.equal(isSourceDownloading(project), false)
})

test('finished download and failed projects are not shown as in-progress downloads', () => {
  assert.equal(isSourceDownloading({
    status: 'pending',
    settings: { download_status: 'completed', download_progress: 100 },
  }), false)
  assert.equal(isSourceDownloading({
    status: 'failed',
    settings: { download_status: 'downloading', download_progress: 30 },
  }), false)
})

test('a later list percent replaces the 5% importing placeholder when the download poll has not returned', () => {
  // The card first pending、NoneDownloadCharacterclipsHang up，Progressis hard-coded 5。
  // If the desktop polling hits the shell page, it willFailed，polled Has always been null，Cannot put 5 Retain。
  assert.equal(displayedDownloadPercent(5, null), 5)
  assert.equal(displayedDownloadPercent(0, null), 0)
  assert.equal(displayedDownloadPercent(30, null), 30)
})

test('a successful download poll replaces the placeholder percent', () => {
  assert.equal(displayedDownloadPercent(5, 30), 30)
  assert.equal(displayedDownloadPercent(0, 0), 0)
})

test('legacy processing_config still wins when it actually carries the progress', () => {
  const project = {
    status: 'pending',
    processing_config: { download_progress: 12 },
    settings: { download_progress: 80 },
  }
  assert.equal(readDownloadProgress(project), 12)
  assert.equal(isSourceDownloading(project), true)
})
