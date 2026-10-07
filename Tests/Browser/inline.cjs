// Real WebKit checks for the inline entry; authentication stays in extension UI.
const { webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
    const source = fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/content.js`, 'utf8');
    await page.route('https://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body:
      '<label>姓<input autocomplete="family-name"></label><label>名<input autocomplete="given-name"></label><input type="password">' }));
    await page.goto('https://fixture.example/form');
    await page.evaluate(() => {
      window.requests = [];
      window.browser = { runtime: { id: 'test', onMessage: { addListener: fn => window.listener = fn, removeListener() {} },
        sendMessage: async message => { requests.push(message); return { version: 1, ok: !window.popupError }; } } };
    });
    await page.addScriptTag({ content: source });
    assert.equal(await page.locator('[data-form-fill-inline]').count(), 0);
    await page.locator('input').first().focus();
    const host = page.locator('[data-form-fill-inline]');
    assert.equal(await host.count(), 1);
    assert.equal(await host.evaluate(el => el.shadowRoot), null, 'closed shadow root');
    assert.deepEqual(await page.evaluate(() => requests), [], 'focus does not send messages');
    const box = await host.boundingBox();
    const field = await page.locator('input').first().boundingBox();
    assert.equal(box.height, 48);
    assert.equal(box.y, field.y + field.height + 2);
    assert.ok(box.x >= 0 && box.x + box.width <= 320);
    await page.mouse.click(box.x + box.width / 2, box.y + 24);
    assert.deepEqual(await page.evaluate(() => requests), [{ type: 'openFillPopup' }]);
    assert.equal(await page.locator('input').first().inputValue(), '');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('input')), true);
    await page.addScriptTag({ content: source });
    assert.equal(await host.count(), 1, 'reinjection does not duplicate UI');
    await page.keyboard.press('Escape');
    assert.equal(await host.count(), 0);
    await page.locator('input').nth(1).focus();
    assert.equal(await host.count(), 1);
    await page.locator('input').nth(2).focus();
    assert.equal(await host.count(), 0, 'password fields have no entry');
    await page.evaluate(() => window.popupError = true);
    await page.locator('input').first().focus();
    const retryBox = await host.boundingBox();
    await page.mouse.click(retryBox.x + retryBox.width / 2, retryBox.y + 24);
    assert.equal(await host.count(), 1, 'popup failure retains entry');
    assert.equal(await page.locator('input').first().inputValue(), '');
    assert.equal(await page.evaluate(() => listener({ type: 'extract' }, { id: 'test', tab: { id: 1 } })), undefined);
    await page.route('https://fixture.example/grouped', route => route.fulfill({ contentType: 'text/html', body:
      '<form><fieldset><legend>配送先</legend><label>姓<input autocomplete="family-name"></label></fieldset><fieldset><legend>請求先</legend><label>姓<input autocomplete="family-name"></label></fieldset></form>' }));
    await page.goto('https://fixture.example/grouped');
    await page.evaluate(() => window.browser = { runtime: { id: 'test', onMessage: { addListener: fn => window.listener = fn, removeListener() {} }, sendMessage: async () => ({ ok: true }) } });
    await page.addScriptTag({ content: source });
    await page.locator('input').nth(1).focus();
    const groupedBox = await page.locator('[data-form-fill-inline]').boundingBox();
    await page.mouse.click(groupedBox.x + groupedBox.width / 2, groupedBox.y + 24);
    await page.addScriptTag({ content: source });
    await page.locator('input').first().focus();
    const scoped = await page.evaluate(() => listener({ type: 'extract', inlineTarget: true }, { id: 'test' }));
    assert.equal(scoped.fields.length, 1);
    assert.equal(scoped.fields[0].groupID, 'g1');
    assert.equal((await page.evaluate(() => listener({ type: 'extract', inlineTarget: true }, { id: 'test' }))).fields.length, 0, 'target is consumed once');
    await page.locator('input').nth(1).focus();
    const removedBox = await page.locator('[data-form-fill-inline]').boundingBox();
    await page.mouse.click(removedBox.x + removedBox.width / 2, removedBox.y + 24);
    await page.locator('input').nth(1).evaluate(element => element.remove());
    assert.equal((await page.evaluate(() => listener({ type: 'extract', inlineTarget: true }, { id: 'test' }))).fields.length, 0, 'removed target never falls back to another group');
    await page.route('http://fixture.example/**', route => route.fulfill({ contentType: 'text/html', body: '<label>姓<input></label>' }));
    await page.goto('http://fixture.example/form');
    await page.evaluate(() => window.browser = { runtime: { id: 'test', onMessage: { addListener: fn => window.listener = fn } } });
    await page.addScriptTag({ content: source });
    await page.locator('input').focus();
    assert.equal(await page.locator('[data-form-fill-inline]').count(), 0);
    const result = await page.evaluate(async () => {
      const extracted = await listener({ type: 'extract' }, { id: 'test' });
      return listener({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '合成試験' }] }, { id: 'test' });
    });
    assert.equal(result.error, 'stale_plan');
    const popup = await browser.newPage();
    const popupHTML = fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/popup.html`, 'utf8').replace(/<script[^>]*>.*?<\/script>/gs, '');
    await popup.route('https://popup.example/**', route => route.fulfill({ contentType: 'text/html', body: popupHTML }));
    async function loadPopup(mode = 'quick') {
      await popup.goto('https://popup.example/');
      await popup.addStyleTag({ content: fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/popup.css`, 'utf8') });
      await popup.evaluate(mode => {
        window.requests = [];
        window.close = () => window.closedByFill = true;
        window.browser = {
          runtime: { getManifest: () => ({ version: 'test' }), sendMessage: async message => {
            requests.push(message);
            if (message.type === 'consumeInlineStart') return { ok: true, ...(['manual', 'groups', 'groups-stale'].includes(mode) ? {} : { tabID: 5, url: mode === 'stale' ? 'https://fixture.example/other' : 'https://fixture.example/form' }) };
            if (message.type === 'analyzeForm') {
              if (mode === 'cancel') await new Promise(resolve => window.finishAnalysis = resolve);
              return { ok: true, requestID: message.requestID, sessionID: 'session', classifications: [{ id: 'f0', kind: 'family', label: '姓' }] };
            }
            if (message.type === 'quickFill') return mode === 'denied' ? { ok: false, error: 'authentication_failed' } : { ok: true, results: [{ id: 'f0', status: 'filled' }] };
            return { ok: true };
          } },
          tabs: { query: async () => [{ id: 5, url: 'https://fixture.example/form' }], sendMessage: async (_, message) => {
            if (message.type === 'extract') {
              if (mode === 'groups-stale' && message.groupID) throw new Error('stale_plan');
              if (mode.startsWith('groups')) return { requestID: 'request', fields: message.groupID ? [{ id: 'f0', groupID: message.groupID }] : [{ id: 'f0', groupID: 'g0' }, { id: 'f1', groupID: 'g1' }],
                groups: [{ id: 'g0', label: '配送先', fields: ['姓'] }, { id: 'g1', label: '請求先', fields: ['姓2'] }] };
              return { requestID: 'request', fields: [{ id: 'f0' }] };
            }
            return { ok: true };
          } },
          scripting: { executeScript: async () => [] }
        };
      }, mode);
      await popup.addScriptTag({ content: fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/debug-info.js`, 'utf8') });
      await popup.addScriptTag({ content: fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/popup.js`, 'utf8') });
    }
    await loadPopup();
    await popup.waitForFunction(() => document.querySelector('#fill-status').textContent.includes('1欄に入力しました'));
    assert.deepEqual(await popup.evaluate(() => requests.map(item => item.type).filter(type => type !== 'cancelFill')), ['consumeInlineStart', 'analyzeForm', 'quickFill']);
    assert.equal(await popup.evaluate(() => window.closedByFill), true);
    await loadPopup('manual');
    assert.deepEqual(await popup.evaluate(() => requests.map(item => item.type)), ['consumeInlineStart']);
    assert.equal(await popup.locator('#cancel-quick').isVisible(), false);
    assert.equal(await popup.locator('#open-settings').getAttribute('href'), 'formfill://settings');
    assert.equal(await popup.locator('#open-settings').getAttribute('aria-label'), 'アプリの設定を開く');
    assert.equal(await popup.locator('.setup-note').count(), 0);
    assert.equal(await popup.locator('.main-card').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    for (const width of [320, 360, 600]) {
      await popup.setViewportSize({ width, height: 800 });
      const shell = await popup.locator('.popup-shell').boundingBox();
      assert.ok(Math.abs(shell.x + shell.width / 2 - width / 2) < 1, 'popup is centered');
      assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    }
    await loadPopup('groups');
    await popup.locator('#analyze').click();
    await popup.locator('#targets').waitFor({ state: 'visible' });
    assert.equal(await popup.evaluate(() => requests.some(item => item.type === 'analyzeForm')), false);
    await popup.locator('#target-group').selectOption('g1');
    assert.equal(await popup.locator('#target-fields').textContent(), '姓2');
    await popup.locator('#analyze-target').click();
    await popup.locator('#preview').waitFor({ state: 'visible' });
    assert.deepEqual(await popup.evaluate(() => requests.find(item => item.type === 'analyzeForm').fields.map(field => field.groupID)), ['g1']);
    assert.equal(await popup.evaluate(() => requests.some(item => item.type === 'quickFill')), false);
    await loadPopup('groups-stale');
    await popup.locator('#analyze').click();
    await popup.locator('#targets').waitFor({ state: 'visible' });
    await popup.locator('#analyze-target').click();
    await popup.waitForFunction(() => document.querySelector('#fill-status').textContent.includes('ページが変わった'));
    assert.equal(await popup.evaluate(() => requests.some(item => item.type === 'analyzeForm')), false);
    await loadPopup('stale');
    await popup.waitForFunction(() => document.querySelector('#fill-status').textContent.includes('ページが変わった'));
    assert.deepEqual(await popup.evaluate(() => requests.map(item => item.type)), ['consumeInlineStart']);
    await loadPopup('denied');
    await popup.waitForFunction(() => document.querySelector('#fill-status').textContent.includes('認証できませんでした'));
    assert.equal(await popup.locator('#cancel-quick').isVisible(), false);
    assert.equal(await popup.evaluate(() => Boolean(window.closedByFill)), false);
    await loadPopup('cancel');
    await popup.waitForFunction(() => Boolean(window.finishAnalysis));
    assert.equal(await popup.locator('#analyze').isVisible(), false);
    assert.equal(await popup.locator('#developer-tools').isVisible(), false);
    assert.equal(await popup.locator('#preview').isVisible(), false);
    assert.equal(await popup.locator('#progress').isVisible(), true);
    assert.equal(await popup.locator('#fill-status').isVisible(), false);
    assert.equal(await popup.locator('#open-settings').isVisible(), false);
    assert.equal(await popup.locator('#cancel-quick').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 33, 58)');
    assert.match(await popup.locator('#progress-title').textContent(), /解析中/);
    assert.equal(await popup.locator('button:visible').count(), 1);
    await popup.locator('#cancel-quick').click();
    await popup.evaluate(() => finishAnalysis());
    await popup.waitForFunction(() => requests.some(item => item.type === 'cancelFill'));
    assert.equal(await popup.evaluate(() => requests.some(item => item.type === 'quickFill')), false);
    assert.match(await popup.locator('#fill-status').textContent(), /キャンセル/);
    assert.equal(await popup.locator('#analyze').isEnabled(), true);
    await popup.close();
    console.log('Inline popup entry, focus, layout, reinjection, HTTPS and sender boundaries passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
