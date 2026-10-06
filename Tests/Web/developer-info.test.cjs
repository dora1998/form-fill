const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = `${__dirname}/../../`;
test('packaged build has no raw capture entrypoints or native trace exports', () => {
  for (const name of ['developer-ui.js', 'developer-page.js'])
    assert.equal(fs.existsSync(`${root}SafariExtension/Resources/${name}`), false);
  const html = fs.readFileSync(`${root}SafariExtension/Resources/popup.html`, 'utf8');
  assert.doesNotMatch(html, /developer-record|save-developer|developer-page/);
  const classifier = fs.readFileSync(`${root}SafariExtension/FormClassifier.swift`, 'utf8');
  assert.doesNotMatch(classifier, /print\(|Logger\(|developerDiagnostics|_raw=/);
  const content = fs.readFileSync(`${root}SafariExtension/Resources/content.js`, 'utf8');
  assert.doesNotMatch(content, /fill\.events|analysisPage|initialValue: entry.initialValue/);
});
