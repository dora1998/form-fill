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
    async function load(html) {
      await page.goto('about:blank');
      await page.setContent(html);
      await page.evaluate(() => {
        window.browser = { runtime: { id: 'test', onMessage: { addListener: listener => { window.listener = listener; } } } };
      });
      await page.addScriptTag({ content: source });
    }
    const send = message => page.evaluate(message => window.listener(message, { id: 'test' }), message);
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
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '山田' }] })).error, 'invalid_plan');

    const defaultPrefecture = '<label>都道府県<select><option value="13">東京都</option><option selected value="14">神奈川県</option></select></label>';
    await load(defaultPrefecture);
    extracted = await send({ type: 'extract' });
    assert.equal(extracted.fields[0].occupied, true);
    const overwritten = await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'prefecture', value: '13' }] });
    assert.equal(overwritten.results[0].status, 'filled');
    assert.equal(await page.locator('select').inputValue(), '13');
    await load('<label>職業<select><option selected value="a">会社員</option><option value="b">学生</option></select></label>');
    extracted = await send({ type: 'extract' });
    assert.equal((await send({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', kind: 'prefecture', value: 'b' }] })).error, 'invalid_plan');
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
    const popup = await browser.newPage();
    await popup.setContent(fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/popup.html'), 'utf8').replace(/<script.*?<\/script>/gs, ''));
    await popup.exposeFunction('sendToTarget', send);
    await popup.evaluate(values => {
      window.browser = {
        tabs: { query: async () => [{ id: 5, url: 'https://fixture.example/form' }], sendMessage: async (_, message) => sendToTarget(message) },
        scripting: { executeScript: async () => {} },
        runtime: { sendMessage: async message => ({ version: 1, ok: true, requestID: message.requestID,
          items: message.fields.map((field, i) => ({ id: field.id, label: field.label, value: values[i], displayValue: values[i], source: 'rule' })), skipped: [] }) }
      };
    }, values);
    await popup.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../../SafariExtension/Resources/popup.js'), 'utf8') });
    await popup.locator('#analyze').click();
    await popup.locator('#fill:not([disabled])').waitFor();
    assert.equal(await popup.locator('#plan li').count(), 9);
    assert.equal(await popup.locator('#site').textContent(), '入力先: fixture.example');
    await popup.locator('#fill').click();
    await popup.waitForFunction(() => document.querySelector('#fill-status').textContent.includes('9欄に入力しました'));
    assert.deepEqual(await page.locator('input:not([type]),select').evaluateAll(nodes => nodes.map(node => node.value)), values);
    await popup.close();
    console.log('WebKit DOM: extraction, 9-field fill, events, stale previews, preservation and constraints passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
