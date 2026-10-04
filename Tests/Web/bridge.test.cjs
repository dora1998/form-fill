const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const resource = file => fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources', file), 'utf8');

test('native bridge forwards only a fixed health request from the extension popup', async () => {
  let listener;
  const forwarded = [];
  const browser = { runtime: {
    id: 'extension-id',
    onMessage: { addListener: fn => { listener = fn; } },
    sendNativeMessage: async (app, message) => { forwarded.push({ app, message }); return { ok: true }; }
  } };
  vm.runInNewContext(resource('background.js'), { browser });
  const result = await listener({ type: 'health', privateValue: 'must not be forwarded' }, { id: 'extension-id' });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(forwarded)), [{
    app: 'dev.formfill.app.extension', message: { version: 1, type: 'health' }
  }]);
  await listener({ type: 'health' }, { id: 'extension-id', tab: { id: 1 } });
  await listener({ type: 'health' }, { id: 'other-extension' });
  await listener({ type: 'fill' }, { id: 'extension-id' });
  assert.equal(forwarded.length, 1);
});

test('page diagnostics exclude sensitive or unusable inputs and never access values', async () => {
  let listener;
  let installs = 0;
  const field = (type, disabled = false, visible = true, readOnly = false, visibility = 'visible') => ({
    type, disabled, readOnly, getClientRects: () => visible ? [{}] : [],
    visibility, matches: selector => selector === ':disabled' && disabled,
    get value() { throw new Error('must not read a value'); }
  });
  const fields = [field('text'), field('select-one'), field('textarea'), field('password'),
    field('hidden'), field('text', true), field('text', false, false), field('file'),
    field('radio'), field('checkbox'), field('submit'), field('text', false, true, true),
    field('text', false, true, false, 'hidden'), field('text', false, true, false, 'collapse')];
  const context = vm.createContext({
    browser: { runtime: { id: 'extension-id', onMessage: { addListener: fn => { listener = fn; installs++; } } } },
    getComputedStyle: element => ({ visibility: element.visibility }),
    document: { querySelectorAll: () => fields }
  });
  vm.runInContext(resource('content.js'), context);
  vm.runInContext(resource('content.js'), context);
  assert.equal(installs, 1, 'repeated checks do not register duplicate handlers');
  const response = await listener({ type: 'inspect' }, { id: 'extension-id' });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { version: 1, fieldCount: 3 });
  assert.equal(listener({ type: 'inspect' }, { id: 'external' }), undefined);
});

function popupContext(nativeResponse, failInjection = false) {
  let click;
  const button = { disabled: false, addEventListener: (_, fn) => { click = fn; } };
  const status = { textContent: '' };
  const context = { document: { querySelector: selector => selector === '#check' ? button : status },
    browser: {
      runtime: { sendMessage: async () => nativeResponse },
      tabs: { query: async () => [{ id: 5 }], sendMessage: async () => ({ version: 1, fieldCount: 4 }) },
      scripting: { executeScript: async () => { if (failInjection) throw new Error('access denied'); } }
    }
  };
  vm.runInNewContext(resource('popup.js'), context);
  return { button, status, click: () => click() };
}

test('popup shows successful native and page diagnostics', async () => {
  const popup = popupContext({ version: 1, ok: true });
  await popup.click();
  assert.match(popup.status.textContent, /ネイティブ連携OK.*4個/);
  assert.equal(popup.button.disabled, false);
});

test('popup recovers from native failures and denied page access', async () => {
  for (const popup of [popupContext({ version: 1, ok: false }), popupContext({ version: 1, ok: true }, true)]) {
    await popup.click();
    assert.match(popup.status.textContent, /確認できませんでした/);
    assert.equal(popup.button.disabled, false);
  }
});
