// Behavior tests for the re-run line in every locale.

// rerun-line-i18n.test.cjs
;(() => {
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')

// the count sits after a colon, so the sentence reads right for N=1 and N>1 in languages with plurals.
const KEY = 'This re-run finished. Earlier unfinished versions you can still retry: {{count}}'
for (const lang of ['en', 'es', 'fr', 'pt', 'ru']) {
  test(`R29 #443 ${lang}: the re-run line does not depend on singular/plural`, () => {
    const text = JSON.parse(fs.readFileSync(path.join(__dirname, `../src/i18n/locales/${lang}.json`), 'utf8'))[KEY]
    assert.ok(text, 'translated')
    assert.match(text, /:\s*\{\{count\}\}$/, 'count is a trailing label value, not inside a plural noun phrase')
  })
}
})()
