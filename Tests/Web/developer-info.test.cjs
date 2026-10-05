const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const resource = name => fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/${name}`, 'utf8');

test('developer trace flag is opt-in and rejected from content scripts', async () => {
  let listener;
  const requests = [];
  const browser = { runtime: { id: 'extension', onMessage: { addListener: fn => listener = fn },
    sendNativeMessage: async (_, request) => { requests.push(request); } } };
  vm.runInNewContext(resource('background.js'), { browser });
  for (const flag of [undefined, 'true', true]) {
    await listener({ type: 'analyzeForm', requestID: 'id', fields: [], developerDiagnostics: flag }, { id: 'extension' });
  }
  assert.equal(requests[0].developerDiagnostics, undefined);
  assert.equal(requests[1].developerDiagnostics, undefined);
  assert.equal(requests[2].developerDiagnostics, true);
  await listener({ type: 'analyzeForm', requestID: 'id', fields: [], developerDiagnostics: true }, { id: 'extension', tab: { id: 1 } });
  assert.equal(requests.length, 3);
});

test('saving sends full JSON to the app without clipboard access, including failed captures', async () => {
  for (const mode of ['success', 'capture_failed', 'save_failed', 'transport_failed', 'too_large', 'no_analysis']) {
    const nodes = {};
    let saved;
    const raw = '住所・モデル応答'.repeat(100_000);
    const context = { Date, FormFillCaptureDeveloperPage() {},
      navigator: { clipboard: { writeText() { assert.fail('save must not use clipboard'); } } },
      document: { querySelector: selector => nodes[selector] ||= { addEventListener: (_, fn) => nodes[selector].click = fn } },
      browser: {
        runtime: { getManifest: () => ({ version: '0.1.0' }), sendMessage: async message => {
          saved = message;
          if (mode === 'transport_failed') throw Error('transport');
          return { version: 1, ok: !['save_failed', 'too_large'].includes(mode),
            error: mode === 'too_large' ? 'report_too_large' : 'report_save_failed' };
        } },
        tabs: { query: async () => [{ id: 1, url: 'https://example.test/form?token=raw' }] },
        scripting: { executeScript: async () => {
          if (mode === 'capture_failed') throw Error('capture error');
          return [{ result: { version: 1, documents: [{ html: raw }], lastRun: mode === 'no_analysis' ? null : { analysis: { prompt: raw } } } }];
        } }
      }
    };
    vm.runInNewContext(resource('developer-ui.js'), context);
    await nodes['#save-developer'].click();
    assert.equal(saved.type, 'saveDeveloperReport');
    const report = JSON.parse(saved.report);
    if (mode === 'capture_failed') assert.equal(report.captureStatus, 'failed');
    else {
      assert.equal(report.page.documents[0].html, raw);
      if (mode === 'no_analysis') assert.match(nodes['#developer-status'].textContent, /記録はありません/);
      else assert.equal(report.page.lastRun.analysis.prompt, raw);
    }
    assert.equal(nodes['#save-developer'].disabled, false);
    assert.equal(nodes['#copy-developer'], undefined);
    assert.equal(nodes['#developer-output'], undefined);
    assert.match(nodes['#developer-status'].textContent, mode === 'save_failed' ? /保存できません/
      : mode === 'transport_failed' ? /保存に失敗/ : mode === 'too_large' ? /20 MiB/ : /アプリに保存しました/);
  }
});

test('saved reports are accepted only from the extension and only the report is forwarded', async () => {
  let listener;
  const forwarded = [];
  vm.runInNewContext(resource('background.js'), { browser: { runtime: {
    id: 'extension', onMessage: { addListener: fn => listener = fn },
    sendNativeMessage: async (_, request) => { forwarded.push(request); return { version: 1, ok: true }; }
  } } });
  const message = { type: 'saveDeveloperReport', report: '{"raw":"original"}', filename: '../../outside' };
  await listener(message, { id: 'extension', tab: { id: 1 } });
  await listener(message, { id: 'other' });
  await listener({ type: 'saveDeveloperReport', report: {} }, { id: 'extension' });
  assert.equal(forwarded.length, 0);
  await listener(message, { id: 'extension' });
  assert.deepEqual(JSON.parse(JSON.stringify(forwarded)), [{ version: 1, type: 'saveDeveloperReport', report: message.report }]);
  const large = await listener({ type: 'saveDeveloperReport', report: 'x'.repeat(20 * 1024 * 1024 + 1) }, { id: 'extension' });
  assert.equal(large.error, 'report_too_large');
  assert.equal(forwarded.length, 1);
});
