const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = `${__dirname}/../../`;
test('explicit detailed capture is packaged without automatic console tracing', () => {
  for (const name of ['developer-ui.js', 'developer-page.js']) assert.ok(fs.existsSync(`${root}SafariExtension/Resources/${name}`));
  const html = fs.readFileSync(`${root}SafariExtension/Resources/popup.html`, 'utf8');
  assert.doesNotMatch(html, /id="developer-record"/);
  assert.match(html, /id="save-developer"/);
  const classifier = fs.readFileSync(`${root}SafariExtension/FormClassifier.swift`, 'utf8');
  assert.doesNotMatch(classifier, /print\(|Logger\(/);
  assert.match(classifier, /if detailed/);
});
