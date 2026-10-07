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
    console.log('Inline popup entry, focus, layout, reinjection, HTTPS and sender boundaries passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
