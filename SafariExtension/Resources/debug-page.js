// Passed to scripting.executeScript as a self-contained function. This avoids
// runtime message routing and works even when an older content handler remains.
globalThis.FormFillCapturePage = requestID => {
  let stage = 'query_controls';
  try {
    const postal = element => (element.autocomplete || '').split(/\s+/).includes('postal-code')
      || /(?:zip|postal|postcode|郵便番号)/i.test(`${element.name} ${element.id}`)
      || /郵便番号/.test(`${fieldLabel(element)} ${element.getAttribute('aria-label') || ''}`);
    const visible = element => !['hidden', 'collapse'].includes(getComputedStyle(element).visibility) && element.getClientRects().length > 0;
    const eligible = element => !element.matches(':disabled') && !element.readOnly && visible(element)
      && (['', 'text', 'number', 'search', 'select-one', 'textarea'].includes((element.type || '').toLowerCase()) || element.type === 'tel' && postal(element));
    const labelText = node => {
      if (node?.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!node || node.nodeType !== Node.ELEMENT_NODE || node.matches('input, select, textarea')) return '';
      const copy = node.cloneNode(true);
      copy.querySelectorAll('input, select, textarea, script, style').forEach(child => child.remove());
      return copy.textContent;
    };
    // Stacked table forms put the heading in the immediately preceding row.
    const previousRowHeading = element => {
      const row = element.closest('tr');
      const previous = row?.previousElementSibling;
      return previous?.matches('tr') && !previous.querySelector('input, select, textarea') ? previous.querySelector('th') : null;
    };
    const headings = element => [element.closest('fieldset')?.querySelector('legend'), element.closest('tr')?.querySelector('th') || previousRowHeading(element),
      element.closest('dl')?.querySelector('dt'), element.closest('.field, .form-group, .form-item, .form-row')?.querySelector('.field_head, .field-label, .label')]
      .map(labelText).filter(Boolean);
    const isExample = value => /^(?:例\s*[)）:：]|e\.?g\.?\s*[:：]?)/i.test(value.trim());
    const nearbyLabel = element => {
      let node = element;
      for (let depth = 0; depth < 3 && node?.parentElement && !node.parentElement.matches('form, body'); depth++, node = node.parentElement) {
        let sibling = node.previousSibling;
        for (let count = 0; sibling && count < 6; count++, sibling = sibling.previousSibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && (sibling.matches('input, select, textarea') || sibling.querySelector('input, select, textarea'))) break;
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.matches('.err, .error, .invalid-feedback, script, style')) continue;
          const value = (labelText(sibling) || '').trim();
          if (!isExample(value) && value.length <= 80 && /[\p{L}]/u.test(value)) return value;
        }
      }
      return headings(element).at(-1) || '';
    };
    const fieldLabel = element => {
      const explicit = [...element.labels || []].map(labelText).filter(value => value && !isExample(value)).join(' ');
      return explicit || nearbyLabel(element) || [...element.labels || []].map(labelText).join(' ');
    };
    const controls = [...document.querySelectorAll('input, select, textarea')];
    stage = 'filter_candidates';
    const all = controls.filter(eligible);
    stage = 'field_metadata';
    const fields = controls.slice(0, 200).map((element, index) => {
      const candidateIndex = all.indexOf(element);
      const tag = element.tagName.toLowerCase();
      return {
        index, fieldID: candidateIndex >= 0 && candidateIndex < 40 ? `f${candidateIndex}` : null, tag,
        type: ['text', 'number', 'search', 'select-one', 'select-multiple', 'textarea', 'tel', 'email', 'password', 'hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'date', 'time', 'url'].includes(element.type) ? element.type : 'other',
        eligible: candidateIndex >= 0, disabled: element.matches(':disabled'), readOnly: element.readOnly === true,
        visible: visible(element), postalControl: element.type === 'tel' && postal(element),
        hasLabel: Boolean(element.labels?.length), hasNearbyLabel: Boolean(nearbyLabel(element)),
        hasAriaLabel: Boolean(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')),
        hasName: Boolean(element.name), hasID: Boolean(element.id), hasPlaceholder: Boolean(element.getAttribute('placeholder')),
        hasAutocomplete: Boolean(element.getAttribute('autocomplete')), hasContext: headings(element).length > 0,
        hasPattern: Boolean(element.getAttribute('pattern')),
        maxLength: Number.isInteger(element.maxLength) && element.maxLength > 0 ? Math.min(element.maxLength, 100000) : 0,
        optionCount: tag === 'select' ? element.options.length : 0
      };
    });
    const installed = globalThis.__formFillContentHandler;
    stage = 'snapshot_match';
    return { version: 1, collectorVersion: 4, contentVersion: installed?.version ?? (globalThis.__formFillDiagnosticsInstalled ? 1 : 0),
      controlCount: controls.length, eligibleCount: all.length, iframeCount: document.querySelectorAll('iframe').length,
      truncated: controls.length > fields.length, analysisMatchesPage: installed?.matchesSnapshot?.(requestID, all) === true, fields };
  } catch {
    // Never return exception messages: DOM/framework errors can contain secrets.
    return { version: 1, collectorVersion: 4, collectorError: stage };
  }
};
