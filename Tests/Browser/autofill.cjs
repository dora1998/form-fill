// Run with Playwright available in NODE_PATH. Uses a real WebKit DOM, not a Safari extension process.
const { webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    const source = fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/content.js'), 'utf8');
    const developerSource = fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/developer-page.js'), 'utf8');
    const captureSource = fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/debug-page.js'), 'utf8');
    async function load(html) {
      await page.goto('about:blank');
      await page.setContent(html);
      await page.evaluate(() => {
        window.browser = { runtime: { id: 'test', onMessage: { addListener: listener => { window.listener = listener; } } } };
      });
      await page.addScriptTag({ content: source });
      await page.addScriptTag({ content: captureSource });
      await page.addScriptTag({ content: developerSource });
    }
    const send = message => message.type === 'debugInfo'
      ? page.evaluate(requestID => FormFillCapturePage(requestID), message.requestID ?? null)
      : page.evaluate(message => window.listener(message, { id: 'test' }), message);
    const fixture = fs.readFileSync(path.join(__dirname, '../../Fixtures/japanese-address.html'), 'utf8');
    await load(fixture);
    let extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields.length, 9);
    assert.equal(extracted.fields[0].label, '姓');
    assert.equal(JSON.stringify(extracted).includes('fixture-token'), false);
    const values = ['山田', '太郎', 'ヤマダ', 'タロウ', '100-0001', '13', '千代田区', '千代田1-1', 'テストマンション101号室'];
    const result = await send({ type: 'applyFill', requestID: extracted.requestID, items: extracted.fields.map((field, i) => ({ id: field.id, value: values[i] })) });
    assert.equal(result.results.filter(item => item.status === 'filled').length, 9);
    assert.deepEqual(await page.locator('input:not([type]),select').evaluateAll(nodes => nodes.map(node => node.value)), values);
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [] })).error, 'stale_plan');

    await load('<label>姓<input value="入力済み"></label><input type="password"><input style="display:none"><input disabled><input readonly><input type="email"><input type="tel">');
    extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields.length, 1);
    assert.equal(extracted.fields[0].occupied, true);
    assert.equal(JSON.stringify(extracted).includes('入力済み'), false);
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'family', value: '山田' }] })).results[0].status, 'filled');
    assert.equal(await page.locator('input').first().inputValue(), '山田');
    await load('<label>住所<textarea>元の住所</textarea></label>');
    extracted = await send({ type: 'extract' });
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'fullAddress', value: '東京都千代田区千代田1-1' }] })).results[0].status, 'filled');
    assert.equal(await page.locator('textarea').inputValue(), '東京都千代田区千代田1-1');

    // Sanitized reproduction of stacked rows and watermark labels. Opaque IDs
    // ensure detection comes from the visible heading, not site-specific names.
    await load(fs.readFileSync(path.join(__dirname, '../../Fixtures/watermark-address.html'), 'utf8'));
    extracted = await send({ type: 'extract' });
    assert.deepEqual(extracted.fields.map(field => field.label), ['郵便番号', '検索結果が一覧表示されます。該当する住所を選択して下さい', '番地', '方書・マンション名', 'ニックネーム']);
    assert.equal(extracted.fields[0].type, 'tel');
    assert.equal(extracted.fields[2].placeholder, '例）4-9');
    assert.equal(extracted.fields[3].placeholder, '例）テストハイツ510号室');
    let diagnostics = await send({ type: 'debugInfo', requestID: extracted.requestID });
    assert.equal(diagnostics.eligibleCount, 5);
    assert.equal(diagnostics.analysisMatchesPage, true);
    const watermarkFill = await send({ type: 'applyFill', requestID: extracted.requestID, items: [
      { id: 'f0', value: '1000001' }, { id: 'f2', value: '1-1' }, { id: 'f3', value: 'テストマンション101号室' }
    ] });
    assert.deepEqual(watermarkFill.results.map(item => item.status), ['filled', 'filled', 'filled']);
    assert.equal(await page.locator('#contact').inputValue(), '');
    assert.equal(await page.evaluate(() => window.submissions || 0), 0);
    await load('<p>番地</p><label for="explicit">建物名</label><input id="explicit">');
    assert.equal((await send({ type: 'extract' })).fields[0].label, '建物名');

    const defaultPrefecture = '<label>都道府県<select><option value="13">東京都</option><option selected value="14">神奈川県</option></select></label>';
    await load(defaultPrefecture);
    extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields[0].occupied, true);
    const overwritten = await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'prefecture', value: '13' }] });
    assert.equal(overwritten.results[0].status, 'filled');
    assert.equal(await page.locator('select').inputValue(), '13');
    await load('<label>職業<select><option selected value="a">会社員</option><option value="b">学生</option></select></label>');
    extracted = await send({ type: 'extract' });
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'prefecture', value: '13' }] })).error, 'invalid_plan');
    await load(defaultPrefecture);
    extracted = await send({ type: 'extract' });
    await page.locator('select').selectOption('13');
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'prefecture', value: '13' }] })).error, 'stale_plan');

    for (const mutate of [() => { document.querySelector('input').value = '手動変更'; }, () => { document.querySelector('label').firstChild.textContent = '別の項目'; }, () => { document.querySelector('input').outerHTML = '<input>'; }, () => { document.body.append(document.createElement('input')); }]) {
      await load('<label>姓<input></label>');
      extracted = await send({ type: 'extract' });
      await page.evaluate(mutate);
      assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '山田' }] })).error, 'stale_plan');
    }
    await load('<label>姓<input></label><label>名<input></label><script>document.querySelector("input").addEventListener("input", () => { document.querySelectorAll("input")[1].value = "サイト補完"; });</script>');
    extracted = await send({ type: 'extract' });
    const changed = await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '山田' }, { id: 'f1', value: '太郎' }] });
    assert.deepEqual(changed.results.map(item => item.status), ['filled', 'changed_by_page']);
    assert.equal(await page.locator('input').nth(1).inputValue(), 'サイト補完');

    await load('<input maxlength="1"><select><option value="">選択</option><option disabled value="13">東京都</option></select>');
    extracted = await send({ type: 'extract' });
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '山田' }] })).error, 'invalid_plan');
    extracted = await send({ type: 'extract' });
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f1', value: '13' }] })).error, 'invalid_plan');
    await load('<input pattern="[0-9]{7}">');
    extracted = await send({ type: 'extract' });
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '100-0001' }] })).error, 'invalid_plan');

    await load('<label>住所<textarea>private-address</textarea></label>');
    extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields[0].label, '住所');
    assert.equal(JSON.stringify(extracted).includes('private-address'), false);

    // Public forms commonly use spans/table headers/dl instead of HTML labels.
    await load(`<div class="field"><div class="label"><div class="field_head">フリガナ</div></div><div class="value"><span>姓</span><input name="kana[0]"><span>名</span><input name="kana[1]"></div></div>
      <table><tr><th>住所</th><td><dl><dt>市区町村・番地</dt><dd><input name="town"></dd></dl></td></tr></table>
      <div class="col"><span class="req">フリガナ(姓)</span><span class="form"><input name="kana1"></span></div>
      <div class="col"><span>ご住所</span><span class="form"><input name="zip" type="tel" maxlength="8"></span></div>
      <input name="tel1" type="tel"><input name="tel2" type="tel">`);
    extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields.length, 5);
    assert.deepEqual(extracted.fields.map(field => field.label), ['姓', '名', '市区町村・番地', 'フリガナ(姓)', 'ご住所']);
    assert.equal(extracted.fields[0].context, 'フリガナ');
    assert.equal(extracted.fields[1].context, 'フリガナ');
    assert.equal(extracted.fields[2].context, '住所 市区町村・番地');
    assert.equal(extracted.fields[4].type, 'tel');

    // A framework-style own setter must not suppress native value/input/change updates.
    await load('<input><script>window.events=[];const input=document.querySelector("input"); Object.defineProperty(input,"value",{get(){return ""},set(){throw Error("own setter")},configurable:true});input.addEventListener("input",()=>{delete input.value;events.push(input.value)});input.addEventListener("change",()=>events.push("change"));</script>');
    extracted = await send({ type: 'extract' });
    const framework = await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '山田' }] });
    assert.equal(framework.results[0].status, 'filled');
    assert.deepEqual(await page.evaluate(() => events), ['山田', 'change']);
    await load(fixture);
    await page.locator('input:not([type])').first().fill('元の姓');
    const popup = await browser.newPage();
    await popup.setContent(fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/popup.html'), 'utf8').replace(/<script.*?<\/script>/gs, ''));
    await popup.exposeFunction('sendToTarget', send);
    await popup.exposeFunction('captureDeveloper', () => page.evaluate(() => FormFillCaptureDeveloperPage()));
    await popup.exposeFunction('captureTarget', requestID => send({ type: 'debugInfo', requestID }));
    await popup.evaluate(values => {
      window.browser = {
        tabs: { query: async () => [{ id: 5, url: 'https://fixture.example/form' }], sendMessage: async (_, message) => sendToTarget(message) },
        scripting: { executeScript: async options => options.func ? [{ frameId: 0, result: options.func === window.FormFillCaptureDeveloperPage ? await captureDeveloper() : await captureTarget(options.args[0]) }] : [] },
        runtime: { getManifest: () => ({ version: '0.1.0' }), sendMessage: async message => {
          if (message.type === 'saveDeveloperReport') {
            window.savedDeveloperReport = message.report;
            return { version: 1, ok: true };
          }
          return { version: 1, ok: true, requestID: message.requestID,
          developerDiagnostics: message.developerDiagnostics ? { trace: [{ message: 'raw prompt and output' }] } : undefined,
          items: message.fields.map((field, i) => ({ id: field.id, label: field.label, value: values[i], displayValue: values[i], source: 'rule', overwritesExisting: field.occupied })), skipped: [] }; } }
      };
    }, values);
    await popup.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/debug-info.js'), 'utf8') });
    await popup.addScriptTag({ content: captureSource });
    await popup.addScriptTag({ content: developerSource });
    await popup.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/popup.js'), 'utf8') });
    await popup.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/developer-ui.js'), 'utf8') });
    await popup.locator('summary').click();
    await popup.locator('#developer-record').check();
    await popup.locator('#analyze').click();
    await popup.locator('#fill:not([disabled])').waitFor();
    assert.equal(await popup.locator('#plan li').count(), 9);
    assert.match(await popup.locator('#plan li').first().textContent(), /既存の値を上書き/);
    assert.equal(await popup.locator('#site').textContent(), '入力先: fixture.example');
    await popup.locator('#copy-debug').click();
    await popup.waitForFunction(() => !document.querySelector('#copy-debug').disabled);
    // An insecure test popup cannot write the clipboard: verify the manual path.
    assert.equal(await popup.locator('#debug-output').isVisible(), true);
    const debugReport = JSON.parse(await popup.locator('#debug-output').inputValue());
    assert.equal(debugReport.lastAnalysis.status, 'success');
    assert.equal(debugReport.page.analysisMatchesPage, true);
    assert.equal(debugReport.page.eligibleCount, 9);
    assert.equal(debugReport.analysisURL.url, 'https://fixture.example/form');
    assert.equal(debugReport.currentPageURL.url, 'https://fixture.example/form');
    assert.equal(debugReport.summary.analysis, '解析完了');
    assert.equal(debugReport.summary.overwriteFields, 1);
    for (const value of values) assert.equal(JSON.stringify(debugReport).includes(value), false);
    await popup.locator('#fill').click();
    await popup.waitForFunction(() => document.querySelector('#fill-status').textContent.includes('9欄に入力しました'));
    assert.deepEqual(await page.locator('input:not([type]),select').evaluateAll(nodes => nodes.map(node => node.value)), values);
    await popup.locator('#save-developer').click();
    await popup.waitForFunction(() => !document.querySelector('#save-developer').disabled);
    const rawPopupReport = JSON.parse(await popup.evaluate(() => window.savedDeveloperReport));
    assert.equal(await popup.locator('#copy-developer, #developer-output').count(), 0);
    assert.match(await popup.locator('#developer-status').textContent(), /アプリに保存しました/);
    assert.equal(rawPopupReport.page.lastRun.analysis.response.developerDiagnostics.trace[0].message, 'raw prompt and output');
    assert.equal(rawPopupReport.page.lastRun.fill.after[0].value, '山田');
    assert.equal(rawPopupReport.page.lastRun.analysisPage.documents[0].controls[0].value, '元の姓');
    await popup.close();
    assert.equal((await page.evaluate(() => FormFillCaptureDeveloperPage())).lastRun.fill.after[0].value, '山田');
    // Secrets can occur in any DOM string, including labels and option metadata.
    const secret = 'PRIVATE-person-address-token';
    await load(`<label>${secret}<input id="${secret}" name="${secret}" value="${secret}" placeholder="${secret}" aria-label="${secret}" pattern="${secret}" autocomplete="section-${secret} name"></label>
      <textarea>${secret}</textarea><select><option value="${secret}">${secret}</option></select>
      <input type="password" value="${secret}"><input type="hidden" value="${secret}"><input type="email" value="${secret}"><iframe src="about:blank#${secret}"></iframe>`);
    const debug = await send({ type: 'debugInfo' });
    assert.equal(JSON.stringify(debug).includes(secret), false);
    assert.equal(debug.controlCount, 6);
    assert.equal(debug.eligibleCount, 3);
    assert.equal(debug.iframeCount, 1);
    assert.equal(debug.fields[2].optionCount, 1);
    assert.equal(await page.locator('textarea').inputValue(), secret);
    // Raw development export retains original text/live values, while the safe
    // report above still excludes them. A reopened popup reads the page record.
    let raw = await page.evaluate(() => FormFillCaptureDeveloperPage());
    assert.ok(raw.documents[0].html.includes(secret));
    assert.equal(raw.documents[0].controls[1].value, secret);
    assert.equal(raw.lastRun, null);
    assert.ok(raw.documents.some(doc => doc.path.includes('/frame')));
    await load('<label>住所<input value="元の住所"></label><input id="other"><script>document.querySelector("input").addEventListener("input",()=>{document.querySelector("#other").value="サイト補完"})</script>');
    extracted = await send({ type: 'extract', developerDiagnostics: true });
    raw = await page.evaluate(() => FormFillCaptureDeveloperPage());
    assert.equal(raw.lastRun.fields[0].initialValue, '元の住所');
    assert.equal(raw.documents[0].controls[0].fieldID, 'f0');
    const nativeResponse = { ok: true, developerDiagnostics: { trace: [{ message: 'prompt_raw=住所の原文' }] } };
    assert.equal((await send({ type: 'saveDeveloperAnalysis', requestID: 'wrong', analysis: nativeResponse })).ok, false);
    await send({ type: 'saveDeveloperAnalysis', requestID: extracted.requestID, analysis: { response: nativeResponse }, page: raw });
    await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '東京都' }, { id: 'f1', value: '番地' }] });
    await page.addScriptTag({ content: source }); // Reopening/injecting retains the run.
    raw = await page.evaluate(() => FormFillCaptureDeveloperPage());
    assert.equal(raw.lastRun.analysis.response.developerDiagnostics.trace[0].message, 'prompt_raw=住所の原文');
    assert.equal(raw.lastRun.analysisPage.documents[0].controls[0].value, '元の住所');
    assert.equal(raw.lastRun.fill.before[0].value, '元の住所');
    assert.equal(raw.lastRun.fill.after[0].value, '東京都');
    assert.equal(raw.documents[0].controls[0].fieldID, 'f0');
    assert.equal(raw.lastRun.fill.after[1].value, 'サイト補完');
    assert.equal(raw.lastRun.fill.response.results[1].status, 'changed_by_page');
    assert.equal(raw.lastRun.fill.events.find(event => event.stage === 'after_input_event').values[1].value, 'サイト補完');
    await send({ type: 'extract' });
    assert.equal((await page.evaluate(() => FormFillCaptureDeveloperPage())).lastRun, null);
    await page.evaluate(async () => {
      const host = document.createElement('div'); document.body.append(host);
      host.attachShadow({mode:'open'}).innerHTML = '<label>影の住所<input value="影の値"></label>';
      const frame = document.createElement('iframe'); frame.setAttribute('sandbox', ''); frame.srcdoc = '<input>';
      await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
      document.body.append(...Array.from({length: 1005}, () => document.createElement('input')));
    });
    raw = await page.evaluate(() => FormFillCaptureDeveloperPage());
    assert.ok(raw.documents.some(doc => doc.path.includes('/shadow') && doc.controls[0].value === '影の値'));
    assert.ok(raw.unavailable.some(frame => frame.reason === 'cross_origin_or_unloaded'));
    assert.ok(raw.documents[0].truncated.includes('controls'));
    assert.ok(raw.documents.reduce((n, doc) => n + doc.controls.length, 0) <= raw.limits.controls);
    await load(fs.readFileSync(path.join(__dirname, '../../Fixtures/numbered-address.html'), 'utf8'));
    extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields.length, 4);
    assert.deepEqual(extracted.fields.slice(1).map(field => field.placeholder), ['住所１（必須）', '住所２', '住所３']);
    assert.ok(extracted.fields.every(field => field.occupied));
    assert.equal(JSON.stringify(extracted).includes('元の住所'), false);
    const numberedValues = ['1000001', '東京都千代田区', '千代田1-1', 'テストマンション101号室'];
    const numberedKinds = ['postal', 'prefectureMunicipality', 'localityStreet', 'building'];
    const numberedResult = await send({ type: 'applyFill', requestID: extracted.requestID,
      items: extracted.fields.map((field, i) => ({ id: field.id, kind: numberedKinds[i], value: numberedValues[i] })) });
    assert.equal(numberedResult.results.filter(item => item.status === 'filled').length, 4);
    assert.deepEqual(await page.locator('#zip,#addr1,#addr2,#addr3').evaluateAll(nodes => nodes.map(node => node.value)), numberedValues);
    assert.equal(await page.locator('input[name=phone]').inputValue(), '');
    console.log('WebKit DOM: extraction, 9-field fill, events, stale previews, preservation and constraints passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
