const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const resource = file => fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources', file), 'utf8');

test('page diagnostics exclude sensitive or unusable inputs and never access values', async () => {
  let listener;
  let installs = 0;
  const field = (type, disabled = false, visible = true, readOnly = false, visibility = 'visible') => ({
    type, disabled, readOnly, closest: () => null, getClientRects: () => visible ? [{}] : [],
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
    location: { protocol: 'https:' },
    document: { querySelectorAll: () => fields, addEventListener() {}, activeElement: null },
    window: { addEventListener() {} }, HTMLInputElement: class {}, HTMLSelectElement: class {}, HTMLTextAreaElement: class {}, cancelAnimationFrame() {}
  });
  vm.runInContext(resource('content.js'), context);
  vm.runInContext(resource('content.js'), context);
  assert.equal(installs, 1, 'repeated checks do not register duplicate handlers');
  const response = await listener({ type: 'inspect' }, { id: 'extension-id' });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { version: 1, fieldCount: 3 });
  assert.equal(listener({ type: 'inspect' }, { id: 'external' }), undefined);
});

function popupContext(nativeResponse, failInjection = false, modelResponse = null) {
  let click;
  let clickModel;
  const button = { disabled: false, addEventListener: (_, fn) => { click = fn; } };
  const status = { textContent: '' };
  const modelButton = { disabled: false, addEventListener: (_, fn) => { clickModel = fn; } };
  const modelStatus = { textContent: '' };
  const context = { window: { addEventListener() {} }, document: { querySelector: selector => selector === '#check' ? button : status },
    browser: {
      runtime: { sendMessage: async message => message.type === 'modelProbe' ? modelResponse : nativeResponse },
      tabs: { query: async () => [{ id: 5 }], sendMessage: async () => ({ version: 1, fieldCount: 4 }) },
      scripting: { executeScript: async () => { if (failInjection) throw new Error('access denied'); } }
    }
  };
  context.document.querySelector = selector => ({
    '#check': button, '#status': status, '#check-model': modelButton, '#model-status': modelStatus,
    '#analyze': { addEventListener() {} }, '#unlock': { addEventListener() {} }, '#fill': { addEventListener() {} }, '#fill-status': {}, '#preview': {},
    '#target-group': { addEventListener() {} }, '#analyze-target': { addEventListener() {} }, '#targets': {}, '#target-fields': {},
    '#progress': {}, '#progress-title': {}, '#progress-detail': {}, '#save-developer': { addEventListener() {} },
    '#developer-status': {}, '#copy-debug': { addEventListener() {} }, '#debug-status': {}, '#debug-output': {}
  })[selector];
  context.document.body = { dataset: { mode: 'opening' } };
  context.document.addEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(resource('debug-info.js'), context);
  vm.runInContext(resource('popup.js'), context);
  return { button, status, modelButton, modelStatus, click: () => click(), clickModel: () => clickModel() };
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

test('popup reports a model response returned by the native extension process', async () => {
  const popup = popupContext(null, false, {
    version: 1, ok: true, available: true, process: 'safari_web_extension', result: 'FORM_FILL_LOCAL_MODEL_OK'
  });
  await popup.clickModel();
  assert.match(popup.modelStatus.textContent, /拡張プロセスから生成成功.*FORM_FILL_LOCAL_MODEL_OK/);
  assert.equal(popup.modelButton.disabled, false);
});

test('popup explains unavailable models and recovers from model errors', async () => {
  const unavailable = popupContext(null, false, { version: 1, ok: true, available: false, reason: 'model_not_ready' });
  await unavailable.clickModel();
  assert.match(unavailable.modelStatus.textContent, /まだ準備できていません/);
  const failed = popupContext(null, false, { version: 1, ok: false, error: 'generation_failed' });
  await failed.clickModel();
  assert.match(failed.modelStatus.textContent, /モデル呼び出しに失敗しました/);
});
