// F1/F2: exercise the real TypeScript errorText (not a mirror).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./load-ts.cjs')

const { errorText } = loadTs(path.join(__dirname, '../src/features/studio/errorText.ts'))
const fail = data => ({ message: 'Request failed with status code 422', response: { data } })

test('string detail wins', () => {
  assert.equal(errorText(fail({ detail: 'Please go to「Settings → Service Provider andModel」ChangeKey', error: { message: 'General' } })), 'Please go to「Settings → Service Provider andModel」ChangeKey')
})

test('validation array: the specific field hint beats the generic envelope (F2)', () => {
  const data = {
    detail: [{ field: 'body.connections.0.base_url', message: 'Please fill in without secret keys or query parameters HTTP(S) API endpoint' }],
    error: { code: 'VALIDATION_ERROR', message: 'Request parameter validationFailed' },
  }
  assert.equal(errorText(fail(data)), 'Please fill in without secret keys or query parameters HTTP(S) API endpoint')
  assert.equal(errorText(fail({ detail: [{ msg: 'FastAPI Native msg' }] })), 'FastAPI Native msg')
})

test('envelope only, then axios message fallback', () => {
  assert.equal(errorText(fail({ error: { message: 'ConnectionFailed validation' } })), 'ConnectionFailed validation')
  assert.equal(errorText(fail({})), 'Request failed with status code 422')
  assert.equal(errorText(null), 'Request failed. Try again.')
})
