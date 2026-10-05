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

test('raw copy supports missing analysis, clipboard denial, capture failures and retained native traces', async () => {
  for (const mode of ['success', 'manual', 'failed', 'no_analysis']) {
    const nodes = {};
    let copied;
    const context = { Date, navigator: { clipboard: { writeText: async value => { if (mode === 'manual') throw Error('denied'); copied = value; } } },
      FormFillCaptureDeveloperPage() {},
      document: { querySelector: selector => nodes[selector] ||= { addEventListener: (_, fn) => { nodes[selector].click = fn; }, focus() {}, select() {} } },
      browser: { runtime: { getManifest: () => ({ version: '0.1.0' }) }, tabs: { query: async () => [{ id: 1, url: 'https://example.test/address?raw=query' }] },
        scripting: { executeScript: async () => {
          if (mode === 'failed') throw Error('raw exception');
          return [{ result: { version: 1, documents: [{ html: '<label>原文住所</label>', controls: [{ value: '原文値' }] }],
            lastRun: mode === 'no_analysis' ? null : { analysis: { developerDiagnostics: { trace: ['raw prompt', 'raw output'] } } } } }];
        } } } };
    vm.runInNewContext(resource('developer-ui.js'), context);
    await nodes['#copy-developer'].click();
    const report = JSON.parse(copied || nodes['#developer-output'].value);
    assert.equal(report.currentPageURL, 'https://example.test/address?raw=query');
    assert.equal(nodes['#copy-developer'].disabled, false);
    if (mode === 'failed') assert.match(report.error, /raw exception/);
    else assert.equal(report.page.documents[0].controls[0].value, '原文値');
    if (mode === 'manual') assert.equal(nodes['#developer-output'].hidden, false);
    if (mode === 'no_analysis') assert.match(nodes['#developer-status'].textContent, /記録はありません/);
  }
});
