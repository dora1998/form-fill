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
    action: { openPopup: async () => { h.opened = (h.opened || 0) + 1; if (h.popupError) throw Error('unavailable'); if (h.waitPopup) await h.waitPopup; } },
    tabs: { query: async () => [h.tab], sendMessage: async (id, message) => {
      h.page.push({ id, message });
      return message.type === 'validateSnapshot' ? { ok: h.valid } : { ok: true, results: [{ id: 'f0', status: 'filled' }] };
    } }
  };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/background.js`, 'utf8'), { browser, URL, TextEncoder, Date: { now: () => h.now ?? 0 } });
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

test('inline entry opens trusted popup without requesting native values', async () => {
  const h = harness();
  const sender = { id: 'extension', tab: { id: 5 }, frameId: 0, url: h.tab.url };
  for (const invalid of [{ ...sender, id: 'other' }, { ...sender, frameId: 1 },
    { ...sender, tab: undefined }, { ...sender, url: 'http://example.test/form' }])
    assert.equal((await h.listener({ type: 'openFillPopup' }, invalid)).error, 'unsupported_request');
  assert.equal(h.opened, undefined);
  assert.equal((await h.listener({ type: 'openFillPopup', fields: ['forged'] }, sender)).ok, true);
  assert.equal(h.opened, 1);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.page, []);
  assert.equal((await h.listener({ ...h.message, type: 'prepareFill' }, sender)).error, 'unsupported_request');
  h.popupError = true;
  assert.equal((await h.listener({ type: 'openFillPopup' }, sender)).error, 'popup_unavailable');
});

test('inline start is one-use, short-lived and bound to the active document', async () => {
  const h = harness();
  const sender = { id: 'extension', tab: { id: 5 }, frameId: 0, url: h.tab.url };
  const open = () => h.listener({ type: 'openFillPopup' }, sender);
  const consume = () => h.send({ type: 'consumeInlineStart' });
  assert.equal((await consume()).tabID, undefined);
  await open();
  assert.equal((await h.listener({ type: 'consumeInlineStart' }, sender)).error, 'unsupported_request');
  assert.equal((await consume()).tabID, 5);
  assert.equal((await consume()).tabID, undefined);
  await open(); h.now = 10001;
  assert.equal((await consume()).tabID, undefined);
  await open(); h.tab.url = 'https://example.test/different';
  assert.equal((await consume()).error, 'stale_plan');
  assert.equal((await consume()).tabID, undefined);
  assert.deepEqual(h.requests, []);
});
test('quick fill only applies authenticated native values and revalidates after auth', async () => {
  const h = harness();
  const message = { ...h.message, type: 'quickFill', sessionID: 'session' };
  const result = await h.send(message);
  assert.equal(result.ok, true);
  assert.equal(result.items, undefined);
  assert.equal(h.page.at(-1).message.items[0].value, '合成テスト');
  h.onNative = async () => { h.valid = false; };
  h.page = [];
  assert.equal((await h.send(message)).error, 'stale_plan');
  assert.equal(h.page.some(entry => entry.message.type === 'applyFill'), false);
  assert.equal((await h.listener(message, { ...h.sender, tab: { id: 5 } })).error, 'unsupported_request');
});

test('automatic start waits for Safari popup presentation to complete', async () => {
  const h = harness();
  let ready;
  h.waitPopup = new Promise(resolve => ready = resolve);
  const opening = h.listener({ type: 'openFillPopup' }, { id: 'extension', tab: { id: 5 }, frameId: 0, url: h.tab.url });
  let delivered = false;
  const consuming = h.send({ type: 'consumeInlineStart' }).then(result => { delivered = true; return result; });
  await Promise.resolve();
  assert.equal(delivered, false);
  ready();
  assert.equal((await opening).ok, true);
  assert.equal((await consuming).tabID, 5);
});
