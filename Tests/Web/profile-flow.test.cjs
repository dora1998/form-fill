const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness() {
  const h = { tab: { id: 5, url: 'https://example.test/form' }, valid: true, requests: [], page: [] };
  const browser = {
    runtime: { id: 'extension', getURL: path => `safari-web-extension://test/${path}`,
      onMessage: { addListener: fn => h.listener = fn },
      sendNativeMessage: async (_, message) => {
        h.requests.push(message);
        if (h.onNative) await h.onNative(message);
        return { version: 1, ok: true, requestID: message.requestID, sessionID: 'session',
          items: [{ id: 'f0', kind: 'family', value: '合成テスト', displayValue: '合成テスト' }], skipped: [] };
      } },
    tabs: { query: async () => [h.tab], sendMessage: async (id, message) => {
      h.page.push({ id, message });
      return message.type === 'validateSnapshot' ? { ok: h.valid } : { ok: true, results: [{ id: 'f0', status: 'filled' }] };
    } }
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/background.js`, 'utf8'), { browser, URL, TextEncoder });
  h.sender = { id: 'extension', url: browser.runtime.getURL('popup.html') };
  h.send = message => h.listener(message, h.sender);
  h.message = { type: 'analyzeForm', tabID: 5, requestID: 'request', fields: [{ id: 'f0', label: '姓', value: 'private', options: [] }] };
  return h;
}
test('only the exact extension popup can request native services', async () => {
  const h = harness();
  for (const sender of [{ id: 'other' }, { ...h.sender, tab: { id: 5 } }, { id: 'extension' },
    { ...h.sender, url: 'https://example.test/popup.html' }, { ...h.sender, url: 'safari-web-extension://test/other.html' }]) {
    assert.equal((await h.listener(h.message, sender)).error, 'unsupported_request');
  }
  for (const type of ['analyzeInline', 'getProfile'])
    assert.equal((await h.send({ ...h.message, type })).error, 'unsupported_request');
  assert.equal(h.requests.length, 0);
  await h.send({ type: 'health', value: 'private' });
  assert.equal(JSON.stringify(h.requests), '[{"version":1,"type":"health"}]');
});
test('analysis binds browser scope and drops values, raw tracing and claimed origins', async () => {
  const h = harness();
  await h.send({ ...h.message, origin: 'https://forged.test', developerDiagnostics: true, url: 'private' });
  assert.equal(h.requests[0].origin, 'https://example.test');
  assert.equal(JSON.stringify(h.requests).includes('private'), false);
  assert.equal(h.requests[0].developerDiagnostics, true);
  h.tab.url = 'http://example.test/form';
  assert.equal((await h.send(h.message)).error, 'https_required');
  h.tab.url = 'https://example.test/form'; h.valid = false;
  assert.equal((await h.send(h.message)).error, 'stale_plan');
  assert.equal(h.requests.length, 1);
});
test('commit uses only native-authorized values and never returns values to popup', async () => {
  const h = harness();
  const result = await h.send({ ...h.message, type: 'commitFill', sessionID: 'session', items: [{ id: 'f0', value: 'forged' }] });
  assert.equal(result.ok, true);
  assert.equal(result.items, undefined);
  assert.equal(h.page.at(-1).message.items[0].value, '合成テスト');
  assert.equal(JSON.stringify(h.requests).includes('forged'), false);
});
test('navigation during authentication cancels disclosure and does not fill', async () => {
  const h = harness();
  h.onNative = async message => { if (message.type === 'commitFill') h.tab = { id: 6, url: 'https://attacker.test/' }; };
  assert.equal((await h.send({ ...h.message, type: 'commitFill', sessionID: 'session' })).error, 'stale_plan');
  assert.equal(h.page.some(entry => entry.message.type === 'applyFill'), false);
});

test('detailed report only forwards from popup and enforces size/type', async () => {
  const h = harness();
  assert.equal((await h.send({type: 'saveDeveloperReport', report: {raw: true}})).error, 'report_too_large');
  assert.equal(h.requests.length, 0);
  await h.send({type: 'saveDeveloperReport', report: '{"test":"raw memory only"}'});
  assert.equal(h.requests[0].type, 'saveDeveloperReport');
  assert.equal(h.requests[0].version, 1);
});
