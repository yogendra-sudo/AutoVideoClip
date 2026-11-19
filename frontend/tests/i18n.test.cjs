const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createInstance } = require('i18next')

const root = path.join(__dirname, '../src/i18n')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'))
const localeDir = path.join(root, 'locales')
const locales = fs.readdirSync(localeDir).filter(name => name.endsWith('.json'))

test('English is the only supported interface locale', () => {
  const source = fs.readFileSync(path.join(root, 'index.ts'), 'utf8')
  assert.match(source, /lng:\s*'en'/)
  assert.match(source, /supportedLngs:\s*\['en'\]/)
  assert.match(source, /document\.documentElement\.lang\s*=\s*'en'/)

  const header = fs.readFileSync(path.join(__dirname, '../src/components/Header.tsx'), 'utf8')
  assert.doesNotMatch(header, /LanguageSelect/)
})

test('English catalog entries are unique, nonempty, and contain no non-English scripts', () => {
  const source = ts.parseJsonText('en.json', fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'))
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = node.properties.map(property => property.name.text)
      assert.equal(new Set(keys).size, keys.length, 'duplicate English catalog keys')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  for (const [key, value] of Object.entries(catalog)) {
    assert.ok(value.trim(), `${key}: translation must not be empty`)
    assert.ok(!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Hebrew}]/u.test(value), `${key}: translation must be English`)
  }

  for (const locale of locales) {
    const messages = JSON.parse(fs.readFileSync(path.join(root, 'locales', locale), 'utf8'))
    assert.deepEqual(messages, catalog, `${locale}: all interface text must be English`)
  }
})

test('every static translation call has an English catalog entry', () => {
  const scan = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? scan(path.join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : [],
  )

  for (const file of scan(path.join(__dirname, '../src'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' &&
          node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(Object.hasOwn(catalog, node.arguments[0].text), `${file}: ${node.arguments[0].text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
})

test('English translations preserve interpolated user content and feedback disclosures', async () => {
  const instance = createInstance()
  await instance.init({
    resources: { en: { translation: catalog } },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en'],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })

  assert.equal(instance.t('My projects'), 'My projects')
  const userTitle = '<img src=x> OriginalTitle & título'
  assert.ok(instance.t('Deleted {{value1}}', { value1: userTitle }).includes(userTitle))
  assert.ok(catalog['Your message and contact details are sent to the developers so they can reply and create a GitHub Issue.'].includes('GitHub Issue'))
  assert.ok(catalog['Received. This note goes to PostHog first, then appears publicly on GitHub.'].includes('PostHog'))
})
