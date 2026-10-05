const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const resource = file => fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const secret = 'PRIVATE-person-address-token';

test('debug extraction never reads values or option contents, including excluded controls', async () => {
  const field = type => ({
    tagName: type.startsWith('select') ? 'SELECT' : 'INPUT', type, name: secret, id: secret,
    readOnly: false, maxLength: 7, labels: [], parentElement: null,
    matches: () => false, closest: () => null, getClientRects: () => [{}],
    getAttribute: () => secret,
    get value() { throw Error('value must never be read'); },
    options: { length: 2, get 0() { throw Error('options must never be read'); } }
  });
  const controls = [field('text'), field('select-one'), field('password'), field('email'), field('tel')];
  const context = { Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: { querySelectorAll: selector => selector === 'iframe' ? [{}] : controls } };
  vm.createContext(context);
  vm.runInContext(resource('debug-page.js'), context);
  const capture = () => vm.runInContext(`(${context.FormFillCapturePage.toString()})(null)`, context);
  const result = plain(capture());
  assert.equal(result.controlCount, 5);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.iframeCount, 1);
  assert.equal(result.fields[1].optionCount, 2);
  assert.equal(result.fields[2].eligible, false);
  assert.equal(result.fields[0].fieldID, 'f0');
  // Comment nodes near excluded controls must not be treated as Elements.
  controls[2].parentElement = { matches: () => false };
  controls[2].previousSibling = { nodeType: 8, textContent: secret };
  assert.ok(Array.isArray(capture().fields));

  context.__formFillDiagnosticsInstalled = true;
  assert.equal(capture().contentVersion, 1, 'collector works with a legacy page handler');
  assert.equal(JSON.stringify(result).includes(secret), false);
  controls.push(...Array.from({ length: 210 }, () => field('text')));
  const bounded = capture();
  assert.equal(bounded.fields.length, 200);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.fields[45].fieldID, null);
  context.document.querySelectorAll = () => { throw Error(secret); };
  const failed = plain(capture());
  assert.equal(failed.collectorError, 'query_controls');
  assert.equal(failed.collectorVersion, 4);
  assert.equal(JSON.stringify(failed).includes(secret), false);

});

test('clipboard boundary discards arbitrary page, model, URL, label and exception strings', () => {
  const context = {};
  vm.runInNewContext(resource('debug-info.js'), context);
  const debug = context.FormFillDebug;
  const result = debug.report({ version: 1, url: secret, title: secret, fields: [{
    index: 0, fieldID: secret, type: secret, tag: secret, maxLength: secret,
    hasLabel: secret, label: secret, name: secret, value: secret, pattern: secret, options: [{ text: secret, value: secret }]
  }] }, { status: secret, reason: secret, items: [{ id: secret, kind: secret, source: secret, value: secret, label: secret }],
    skipped: [{ id: 'f1', label: secret, reason: secret }] }, secret);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.page.fields[0].fieldID, null);
  assert.equal(result.page.fields[0].hasLabel, false);
  const analysis = debug.analysis('success', { modelFailed: true, items: [{ id: 'f0', kind: 'family', source: 'rule', value: secret }],
    skipped: [{ id: 'f1', reason: '既存の入力を保持', label: secret }, { id: 'f2', reason: '__proto__' }] });
  const safe = plain(debug.report({ version: 1, fields: [] }, analysis, '0.1.0'));
  assert.deepEqual(safe.lastAnalysis.items, [{ id: 'f0', kind: 'family', source: 'rule', overwritesExisting: false }]);
  assert.deepEqual(safe.lastAnalysis.skipped, [{ id: 'f1', kind: 'unknown', source: 'unknown', reason: 'existing_input' }, { id: 'f2', kind: 'unknown', source: 'unknown', reason: 'unknown' }]);
  assert.equal(safe.lastAnalysis.modelFailed, true);
  assert.equal(JSON.stringify(safe).includes(secret), false);
});

function popup({ denyAccess = false, denyClipboard = false, noFields = false, unavailable = false, denyDebug = false } = {}) {
  const nodes = {};
  const copied = [];
  const messages = [];
  const context = { setTimeout, clearTimeout, URL,
    navigator: { clipboard: { writeText: async value => { if (denyClipboard) throw Error(secret); copied.push(value); } } },
    document: { querySelector: selector => nodes[selector] ||= { hidden: false, value: '', textContent: '', disabled: false,
      addEventListener: (_, fn) => { nodes[selector].click = fn; }, replaceChildren() {}, append() {}, focus() {}, select() {} },
      createElement: () => ({}) },
    browser: { tabs: { query: async () => [{ id: 5, url: `https://example.test/${secret}?token=${secret}` }],
      sendMessage: async (_, message) => { messages.push(message.type); if (denyDebug && message.type === 'debugInfo') throw Error(secret); return message.type === 'extract'
        ? { version: 1, requestID: secret, fields: noFields ? [] : [{ id: 'f0', label: '住所', placeholder: `例：東京都千代田区千代田1-1 ${secret}`, value: secret, occupied: true }] }
        : { version: 1, fields: [{ index: 0, fieldID: 'f0', tag: 'input', type: 'text', value: secret, label: secret }] }; } },
      scripting: { executeScript: async options => {
        if (denyAccess) throw Error(secret);
        if (options.func) {
          if (denyDebug) throw Error(secret);
          return [{ frameId: 17, result: { version: 1, collectorVersion: 1, contentVersion: 3,
            fields: [{ index: 0, fieldID: 'f0', tag: 'input', type: 'text', value: secret, label: secret }] } }];
        }
      } },
      runtime: { getManifest: () => ({ version: '0.1.0' }), sendMessage: async message => unavailable
        ? { version: 1, error: 'model_unavailable', reason: 'model_not_ready' }
        : { version: 1, ok: true, requestID: message.requestID, items: [{ id: 'f0', kind: 'family', source: 'rule', label: secret, value: secret, displayValue: secret }], skipped: [] } }
    } };
  vm.createContext(context);
  vm.runInContext(resource('debug-info.js'), context);
  vm.runInContext(resource('debug-page.js'), context);
  vm.runInContext(resource('popup.js'), context);
  return { nodes, copied, messages };
}

test('copy works before analysis and after success, no fields, unavailable model or denied access', async () => {
  for (const options of [{}, { noFields: true }, { unavailable: true }, { denyAccess: true }]) {
    const p = popup(options);
    await p.nodes['#copy-debug'].click();
    assert.equal(JSON.parse(p.copied[0]).lastAnalysis.status, 'not_run');
    await p.nodes['#analyze'].click();
    await p.nodes['#copy-debug'].click();
    const report = JSON.parse(p.copied[1]);
    assert.equal(report.lastAnalysis.status, options.denyAccess ? 'failed' : options.noFields ? 'no_fields' : options.unavailable ? 'model_unavailable' : 'success');
    assert.equal(p.copied.join('').includes(secret), false);
    assert.equal(p.nodes['#copy-debug'].disabled, false);
    assert.equal(p.nodes['#debug-output'].hidden, true);
    if (options.denyAccess) assert.equal(report.page.status, 'unavailable');
    else assert.equal(report.page.collectorVersion, 1);
  }
});

test('clipboard denial exposes only sanitized selectable JSON for manual copying', async () => {
  const p = popup({ denyClipboard: true });
  await p.nodes['#analyze'].click();
  await p.nodes['#copy-debug'].click();
  assert.equal(p.copied.length, 0);
  assert.equal(p.nodes['#debug-output'].hidden, false);
  assert.equal(p.nodes['#debug-output'].value.includes(secret), false);
  assert.equal(JSON.parse(p.nodes['#debug-output'].value).lastAnalysis.status, 'success');
  assert.match(p.nodes['#debug-status'].textContent, /自動コピーできませんでした/);
  assert.equal(p.nodes['#copy-debug'].disabled, false);
});

test('placeholder and sibling hints remain useful without copying personal data or arbitrary strings', () => {
  const context = {};
  vm.runInNewContext(resource('debug-info.js'), context);
  const fields = context.FormFillDebug.fieldMetadata([{ id: 'f0', tag: 'input', type: 'text', occupied: true,
    label: '住所1（市区町村・町名・番地）', placeholder: `例：東京都千代田区千代田1-1 ${secret}`,
    autocomplete: `section-${secret} address-line1`, options: [], pattern: secret,
    get value() { throw Error('must not read values'); } }]);
  const report = plain(context.FormFillDebug.report(undefined, { status: 'success', skipped: [{ id: 'f0', kind: 'municipalityLocalityStreet', source: 'rule', reason: 'existing_input' }] }, '0.1.0', fields, 'message_failed'));
  const serialized = JSON.stringify(report);
  for (const sensitive of [secret, '東京都', '千代田区', '千代田1-1', '住所1（市区町村・町名・番地）']) assert.equal(serialized.includes(sensitive), false);
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.analysisFields[0].autocomplete, 'address-line1');
  assert.ok(report.analysisFields[0].placeholder.hints.includes('example_prefecture'));
  assert.ok(report.analysisFields[0].placeholder.hints.includes('example_city_ward'));
  assert.ok(report.analysisFields[0].placeholder.hints.includes('example_number'));
  assert.ok(report.analysisFields[0].label.hints.includes('municipality'));
  assert.equal(report.lastAnalysis.skipped[0].kind, 'municipalityLocalityStreet');
  assert.equal(report.lastAnalysis.skipped[0].source, 'rule');
  assert.equal(report.legend.kinds.municipalityLocalityStreet, '市区町村＋町名＋番地');
  assert.equal(report.legend.hints.example_prefecture, '都道府県を含む例');
  fields[0].placeholder.hints.push(secret);
  fields[0].placeholder.raw = secret;
  assert.equal(JSON.stringify(context.FormFillDebug.report(undefined, {}, '0.1.0', fields)).includes(secret), false);
});

test('analysis-time diagnostics survive live capture failure', async () => {
  const p = popup({ denyDebug: true });
  await p.nodes['#analyze'].click();
  await p.nodes['#copy-debug'].click();
  const report = JSON.parse(p.copied[0]);
  assert.equal(report.page.status, 'unavailable');
  assert.equal(report.captureStatus, 'injection_failed');
  assert.equal(report.analysisFields[0].id, 'f0');
  assert.equal(report.analysisFields[0].occupied, true);
  assert.ok(report.analysisFields[0].placeholder.hints.includes('example_prefecture'));
  assert.equal(p.copied[0].includes(secret), false);
  assert.match(p.nodes['#debug-status'].textContent, /解析時の情報をコピー/);
  assert.equal(report.analysisURL.url, 'https://example.test/[redacted]');
  assert.equal(report.currentPageURL.url, 'https://example.test/[redacted]');
  assert.equal(report.summary.analysis, '解析完了');
  assert.equal(report.summary.currentPageCapture, 'スクリプト注入失敗');
});

test('URL keeps the au route while removing queries, hashes and credentials', () => {
  const context = { URL };
  vm.runInNewContext(resource('debug-info.js'), context);
  const debug = context.FormFillDebug;
  const expected = 'https://id.auone.jp/id/userinfo/cinfo_set.html';
  const result = debug.pageURL(`https://user:${secret}@id.auone.jp/id/userinfo/cinfo_set.html?email=${secret}#${secret}`);
  assert.equal(result.url, expected);
  assert.equal(result.pathRedacted, false);
  assert.deepEqual(plain(debug.pageURL(result.url)), plain(result));
  const report = debug.report(undefined, { status: 'not_run' }, '0.1.0', [], 'injection_failed', {
    analysis: `https://id.auone.jp/id/userinfo/cinfo_set.html?token=${secret}`,
    current: `https://id.auone.jp/account/settings?token=${secret}`
  });
  assert.equal(report.analysisURL.url, expected);
  assert.equal(report.currentPageURL.url, 'https://id.auone.jp/account/settings');
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('URL redacts arbitrary path identifiers including encoded PII and session parameters', () => {
  const context = { URL };
  vm.runInNewContext(resource('debug-info.js'), context);
  const debug = context.FormFillDebug;
  for (const segment of ['alice', 'alice.html', '12345678', 'person@example.test', '550e8400-e29b-41d4-a716-446655440000',
    encodeURIComponent('東京都千代田区'), encodeURIComponent('alice@example.test'), secret, '%ZZ', '%2Fprivate']) {
    const result = debug.pageURL(`https://example.test/users/${segment}/address?token=${secret}`);
    assert.equal(result.url, 'https://example.test/users/[redacted]/address');
    assert.equal(result.pathRedacted, true);
    assert.deepEqual(plain(debug.pageURL(result.url)), plain(result));
  }
  assert.equal(debug.pageURL(`https://example.test/form;jsessionid=${secret}/edit`).url, 'https://example.test/form/edit');
  for (const value of [null, secret, 'javascript:alert(1)', `file:///private/${secret}`, `data:text/plain,${secret}`]) {
    assert.equal(debug.pageURL(value).url, null);
  }
});

test('model failure diagnostics retain fixed reasons and discard exception or model strings', () => {
  const context = {};
  vm.runInNewContext(resource('debug-info.js'), context);
  const debug = context.FormFillDebug;
  const result = debug.analysis('success', { modelFailed: true, classifierVersion: 2, modelDiagnostics: {
    available: true, requestedFields: 3, attemptedBatches: 1,
    failures: [{ fieldIDs: ['f1', 'f2', 'f3', secret], reason: 'decoding_failure', errorDescription: secret },
      { fieldIDs: [secret], reason: secret, modelOutput: secret }]
  } });
  const fields = debug.fieldMetadata([{ id: 'f3', placeholder: `住所３ ${secret}` }, { id: 'f0', placeholder: '半角数字7ケタ' }]);
  const report = plain(debug.report(undefined, result, '0.1.0', fields));
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.deepEqual(report.lastAnalysis.modelDiagnostics.failures[0], { fieldIDs: ['f1', 'f2', 'f3'], reason: 'decoding_failure', validationCodes: [] });
  assert.equal(report.lastAnalysis.modelDiagnostics.failures[1].reason, 'unknown');
  assert.equal(report.summary.modelFailureCount, 2);
  assert.equal(report.lastAnalysis.classifierVersion, 2);
  assert.equal(report.legend.modelFailures.decoding_failure, '構造化出力の復元失敗');
  assert.deepEqual(report.analysisFields[0].placeholder.hints, ['address', 'address_line3']);
  assert.deepEqual(report.analysisFields[1].placeholder.hints, ['postal_digits7']);
});

test('capture diagnostics export only fixed stages and response shape', () => {
  const context = {};
  vm.runInNewContext(resource('debug-info.js'), context);
  const report = plain(context.FormFillDebug.report(undefined, {}, '0.1.0', [], 'invalid_response', {}, {
    resultCount: 1, resultType: 'object', hasInjectionError: true, collectorError: 'field_metadata', error: secret
  }));
  assert.deepEqual(report.captureDiagnostics, {
    resultCount: 1, resultType: 'object', hasInjectionError: true, collectorError: 'field_metadata'
  });
  assert.equal(JSON.stringify(report).includes(secret), false);
});
