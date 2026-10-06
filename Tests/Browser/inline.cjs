const { webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
    const source = fs.readFileSync('SafariExtension/Resources/content.js', 'utf8');
    async function load() {
      await page.goto('about:blank');
      await page.setContent('<form><fieldset><label>姓<input id="family"></label><label>名<input id="given"></label><label>電話<input id="phone" type="tel"></label><label>不明<input id="unknown"></label></fieldset><fieldset><label>姓<input id="other"></label></fieldset></form>');
      await page.evaluate(() => {
        window.calls = [];
        const original = document.querySelectorAll.bind(document);
        window.scans = 0;
        document.querySelectorAll = (...args) => { window.scans++; return original(...args); };
        window.browser = { runtime: { id: 'test', onMessage: { addListener(fn) { window.listener = fn; }, removeListener() {} },
          async sendMessage(message) {
            window.calls.push(message);
            if (window.delay) await new Promise(resolve => { window.resolveAnalysis = resolve; });
            return { version: 1, ok: true, requestID: message.requestID, items: message.fields.filter(field => ['姓', '名'].includes(field.label))
              .map(field => ({ id: field.id, kind: field.label === '姓' ? 'family' : 'given', value: field.label === '姓' ? '山田' : '太郎' })) };
          } } };
      });
      await page.addScriptTag({ content: source });
    }
    const host = () => page.locator('[data-form-fill-inline]');
    async function tap() { const box = await host().boundingBox(); await page.mouse.click(box.x + 40, box.y + 24); }
    await load();
    assert.equal(await host().count(), 0);
    for (const id of ['phone', 'unknown']) { await page.locator(`#${id}`).focus(); assert.equal(await host().count(), 0); }
    await page.evaluate(() => Object.defineProperty(document.querySelector('#family'), 'value', { configurable: true, get() { throw new Error('focus must not read values'); } }));
    await page.locator('#family').focus();
    assert.equal(await host().count(), 1);
    await page.evaluate(() => delete document.querySelector('#family').value);
    assert.deepEqual(await page.evaluate(() => [window.scans, window.calls.length]), [0, 0]);
    assert.equal(await host().evaluate(node => node.shadowRoot), null);
    let box = await host().boundingBox();
    assert.equal(box.height, 48);
    assert.ok(box.x >= 0 && box.x + box.width <= 320);
    const fieldBox = await page.locator('#family').boundingBox();
    assert.equal(box.y, fieldBox.y + fieldBox.height + 2);
    await page.addScriptTag({ content: source });
    assert.equal(await host().count(), 1);
    await tap();
    await page.waitForFunction(() => document.querySelector('#given').value === '太郎');
    assert.equal(await page.locator('#family').inputValue(), '山田');
    assert.equal(await page.locator('#other').inputValue(), '');
    assert.equal(await page.locator('#phone').inputValue(), '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'family');
    await page.keyboard.press('Escape');
    assert.equal(await host().count(), 0);
    await page.locator('#given').focus();
    assert.equal(await host().count(), 1);
    await page.locator('#unknown').focus();
    assert.equal(await host().count(), 0);

    await load();
    await page.evaluate(() => { window.delay = true; });
    await page.locator('#family').focus();
    await tap();
    await page.waitForFunction(() => window.resolveAnalysis);
    await page.locator('#given').focus();
    await page.evaluate(() => window.resolveAnalysis());
    assert.equal(await page.locator('#family').inputValue(), '');
    assert.equal(await page.locator('#given').inputValue(), '');

    await load();
    await page.evaluate(() => { window.delay = true; });
    await page.locator('#family').focus();
    await tap();
    await page.waitForFunction(() => window.resolveAnalysis);
    await page.locator('#family').fill('変更');
    await page.evaluate(() => window.resolveAnalysis());
    assert.equal(await page.locator('#family').inputValue(), '変更');
    assert.equal(await page.locator('#given').inputValue(), '');
    await load();
    await page.evaluate(() => {
      const section = document.createElement('fieldset');
      section.innerHTML = '<label>不明<input></label>'.repeat(45);
      document.querySelector('form').prepend(section);
      document.body.style.paddingBottom = '100px';
      document.querySelector('#other').scrollIntoView({ block: 'center' });
    });
    await page.locator('#other').focus();
    await tap();
    await page.waitForFunction(() => document.querySelector('#other').value === '山田');
    assert.equal(await page.locator('#family').inputValue(), '');
    await page.locator('#family').focus();
    await page.evaluate(() => { document.body.style.paddingTop = '800px'; window.scrollTo(0, 700); });
    await page.waitForFunction(() => {
      const control = document.querySelector('#family').getBoundingClientRect();
      const ui = document.querySelector('[data-form-fill-inline]').getBoundingClientRect();
      return Math.abs(ui.top - control.bottom - 2) < 1;
    });
    console.log('Inline WebKit checks passed: no focus scan/native calls, one tap, group scope, focus retention, 48px layout, reinjection, stale/focus cancellation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
