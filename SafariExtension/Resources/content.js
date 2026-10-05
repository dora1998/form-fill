(() => {
  const installed = globalThis.__formFillContentHandler;
  if (installed?.version === 5) return;
  if (installed) browser.runtime.onMessage.removeListener(installed.listener);
  // Old releases did not retain the listener reference. Keep their in-flight
  // preview intact; a page reload installs the current handler safely.
  else if (globalThis.__formFillDiagnosticsInstalled) return;
  globalThis.__formFillDiagnosticsInstalled = true;
  let snapshot;
  const postalControl = element => (element.autocomplete || '').split(/\s+/).includes('postal-code')
    || /(?:zip|postal|postcode|郵便番号)/i.test(`${element.name} ${element.id}`);
  const eligible = element => {
    const visibility = getComputedStyle(element).visibility;
    return !element.matches(':disabled') && !element.readOnly
      && (['', 'text', 'number', 'search', 'select-one', 'textarea'].includes((element.type || '').toLowerCase())
        || element.type === 'tel' && postalControl(element))
      && !['hidden', 'collapse'].includes(visibility) && element.getClientRects().length > 0;
  };
  const candidates = () => [...document.querySelectorAll('input, select, textarea')].filter(eligible);
  const newRequestID = () => {
    // randomUUID is restricted to secure contexts; LAN HTTP fixtures must work too.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const text = value => String(value || '').trim().slice(0, 120);
  const labelText = node => {
    if (node?.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!node || node.nodeType !== Node.ELEMENT_NODE || node.matches('input, select, textarea')) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('input, select, textarea, script, style').forEach(child => child.remove());
    return copy.textContent;
  };
  const headings = element => [
    element.closest('fieldset')?.querySelector('legend'),
    element.closest('tr')?.querySelector('th'),
    element.closest('dl')?.querySelector('dt'),
    element.closest('.field, .form-group, .form-item, .form-row')?.querySelector('.field_head, .field-label, .label')
  ].map(labelText).filter(Boolean);
  const nearbyLabel = element => {
    let node = element;
    for (let depth = 0; depth < 3 && node?.parentElement && !node.parentElement.matches('form, body'); depth++, node = node.parentElement) {
      let sibling = node.previousSibling;
      for (let count = 0; sibling && count < 6; count++, sibling = sibling.previousSibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && (sibling.matches('input, select, textarea') || sibling.querySelector('input, select, textarea'))) break;
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.matches('.err, .error, .invalid-feedback, script, style')) continue;
        const value = (labelText(sibling) || '').trim();
        if (value.length <= 80 && /[\p{L}]/u.test(value)) return value;
      }
    }
    return headings(element).at(-1) || '';
  };
  const metadata = (element, id) => ({
    id, tag: element.tagName.toLowerCase(), type: element.type || '',
    label: text([...element.labels || []].map(label => labelText(label)).join(' ') || nearbyLabel(element)),
    ariaLabel: text(element.getAttribute('aria-label') || (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => labelText(document.getElementById(id))).join(' ')),
    name: text(element.name), htmlID: text(element.id), placeholder: text(element.getAttribute('placeholder')),
    autocomplete: text(element.getAttribute('autocomplete')),
    context: text(headings(element).join(' ')),
    maxLength: element.maxLength > 0 ? element.maxLength : 0,
    pattern: text(element.getAttribute('pattern')),
    occupied: element.tagName === 'SELECT' ? Boolean(element.value) && !/^(選択|選んで|都道府県を選|please select|select\b|--)/i.test(element.selectedOptions[0]?.text.trim() || '') : Boolean(element.value),
    options: element.tagName === 'SELECT' ? [...element.options].slice(0, 60).map(option => ({ value: text(option.value), text: text(option.text), disabled: option.disabled || Boolean(option.parentElement?.disabled) })) : []
  });
  const unchanged = entry => entry.element.isConnected && eligible(entry.element)
    && JSON.stringify(metadata(entry.element, entry.field.id)) === JSON.stringify(entry.field);
  const listener = (message, sender) => {
    if (sender.id !== browser.runtime.id) return;
    if (message?.type === 'inspect') return Promise.resolve({ version: 1, fieldCount: candidates().length });
    if (message?.type === 'extract') {
      const all = candidates();
      const requestID = newRequestID();
      const entries = all.slice(0, 40).map((element, index) => ({ element, field: metadata(element, `f${index}`), initialValue: element.value }));
      snapshot = { requestID, entries, all, url: location.href };
      return Promise.resolve({ version: 1, requestID, fields: entries.map(entry => entry.field), truncated: all.length > entries.length });
    }
    if (message?.type === 'applyFill') return apply(message);
  };
  browser.runtime.onMessage.addListener(listener);
  globalThis.__formFillContentHandler = { version: 5, listener,
    matchesSnapshot: (requestID, all) => Boolean(snapshot && requestID === snapshot.requestID && snapshot.url === location.href
      && all.length === snapshot.all.length && all.every((element, index) => element === snapshot.all[index]))
  };
  async function apply(message) {
    const saved = snapshot;
    snapshot = null; // A preview can be applied only once.
    if (!saved || message.requestID !== saved.requestID || saved.url !== location.href
      || !Array.isArray(message.items) || message.items.length > 40
      || saved.entries.some(entry => !unchanged(entry) || entry.element.value !== entry.initialValue)
      || candidates().length !== saved.all.length
      || candidates().some((element, index) => element !== saved.all[index])) {
      return { version: 1, ok: false, error: 'stale_plan' };
    }
    const ids = new Set();
    const targets = [];
    for (const item of message.items) {
      const entry = saved.entries.find(entry => entry.field.id === item.id);
      if (!entry || ids.has(item.id) || typeof item.value !== 'string' || item.value.length > 300) {
        return { version: 1, ok: false, error: 'invalid_plan' };
      }
      ids.add(item.id);
      if (entry.field.maxLength > 0 && item.value.length > entry.field.maxLength) return { version: 1, ok: false, error: 'invalid_plan' };
      if (entry.field.pattern) {
        try {
          if (!new RegExp(`^(?:${entry.field.pattern})$`, 'v').test(item.value)) return { version: 1, ok: false, error: 'invalid_plan' };
        } catch { return { version: 1, ok: false, error: 'invalid_plan' }; }
      }
      if (entry.field.tag === 'select' && !entry.field.options.some(option => !option.disabled && option.value === item.value)) {
        return { version: 1, ok: false, error: 'invalid_plan' };
      }
      targets.push({ entry, item });
    }
    const results = [];
    for (const { entry, item } of targets) {
      // Site address completion may have changed another field after an earlier input.
      if (!unchanged(entry) || entry.element.value !== entry.initialValue) {
        results.push({ id: item.id, status: 'changed_by_page' });
        continue;
      }
      const prototype = entry.field.tag === 'select' ? HTMLSelectElement.prototype
        : entry.field.tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      try {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(entry.element, item.value);
        entry.element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        entry.element.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ id: item.id, status: 'filled' });
      } catch { results.push({ id: item.id, status: 'failed' }); }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    for (const result of results) {
      const target = targets.find(target => target.item.id === result.id);
      if (result.status === 'filled' && (!target.entry.element.isConnected || target.entry.element.value !== target.item.value)) result.status = 'changed_by_page';
    }
    return { version: 1, ok: true, results };
  }
})();
