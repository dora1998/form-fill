import type { Control, FormField } from '../shared/contracts';
const postalControl = (element: Control) => (element.autocomplete || '').split(/\s+/).includes('postal-code')
    || /(?:zip|postal|postcode|郵便番号)/i.test(`${element.name} ${element.id}`)
    || /郵便番号/.test(`${fieldLabel(element)} ${element.getAttribute('aria-label') || ''}`);
const eligible = (element: Control) => {
    const visibility = getComputedStyle(element).visibility;
    return !element.matches(':disabled') && !('readOnly' in element && element.readOnly)
        && (['', 'text', 'number', 'search', 'select-one', 'textarea'].includes((element.type || '').toLowerCase())
            || element.type === 'tel' && postalControl(element))
        && !['hidden', 'collapse'].includes(visibility) && element.getClientRects().length > 0;
};
const candidates = () => [...document.querySelectorAll<Control>('input, select, textarea')].filter(eligible);
const text = (value: unknown) => String(value || '').trim().slice(0, 120);
const labelText = (node: Node | null | undefined): string => {
    if (node?.nodeType === Node.TEXT_NODE)
        return node.textContent || '';
    if (!node || !(node instanceof Element) || node.matches('input, select, textarea'))
        return '';
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('input, select, textarea, script, style').forEach(child => child.remove());
    return copy.textContent || '';
};
// Stacked table forms put the heading in the immediately preceding row.
const previousRowHeading = (element: Control) => {
    const row = element.closest('tr');
    const previous = row?.previousElementSibling;
    return previous?.matches('tr') && !previous.querySelector('input, select, textarea') ? previous.querySelector('th') : null;
};
const headings = (element: Control) => [
    element.closest('fieldset')?.querySelector('legend'),
    element.closest('tr')?.querySelector('th') || previousRowHeading(element),
    element.closest('dl')?.querySelector('dt'),
    element.closest('.field, .form-group, .form-item, .form-row')?.querySelector('.field_head, .field-label, .label')
].map(labelText).filter(Boolean);
const isExample = (value: string) => /^(?:例\s*[)）:：]|e\.?g\.?\s*[:：]?)/i.test(value.trim());
const nearbyLabel = (element: Control) => {
    let node: Element | null = element;
    for (let depth = 0; depth < 3 && node?.parentElement && !node.parentElement.matches('form, body'); depth++, node = node.parentElement) {
        let sibling = node.previousSibling;
        for (let count = 0; sibling && count < 6; count++, sibling = sibling.previousSibling) {
            if (sibling instanceof Element && (sibling.matches('input, select, textarea') || sibling.querySelector('input, select, textarea')))
                break;
            if (sibling instanceof Element && sibling.matches('.err, .error, .invalid-feedback, script, style'))
                continue;
            const value = (labelText(sibling) || '').trim();
            if (!isExample(value) && value.length <= 80 && /[\p{L}]/u.test(value))
                return value;
        }
    }
    return headings(element).at(-1) || '';
};
const fieldLabel = (element: Control) => {
    const explicit = [...element.labels || []].map(labelText).filter(value => value && !isExample(value)).join(' ');
    return explicit || nearbyLabel(element) || [...element.labels || []].map(labelText).join(' ');
};
const metadata = (element: Control, id: string): FormField => ({
    id, tag: element.tagName.toLowerCase(), type: element.type || '',
    label: text(fieldLabel(element)),
    ariaLabel: text(element.getAttribute('aria-label') || (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => labelText(document.getElementById(id))).join(' ')),
    name: text(element.name), htmlID: text(element.id), placeholder: text(element.getAttribute('placeholder') || element.getAttribute('title')),
    autocomplete: text(element.getAttribute('autocomplete')),
    context: text(headings(element).join(' ')),
    maxLength: 'maxLength' in element && element.maxLength > 0 ? element.maxLength : 0,
    pattern: text(element.getAttribute('pattern')),
    occupied: element instanceof HTMLSelectElement ? Boolean(element.value) && !/^(選択|選んで|都道府県を選|please select|select\b|--)/i.test(element.selectedOptions[0]?.text.trim() || '') : Boolean(element.value),
    options: element instanceof HTMLSelectElement ? [...element.options].slice(0, 60).map(option => ({ value: text(option.value), text: text(option.text), disabled: option.disabled || Boolean((option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)) })) : []
});
export { candidates, eligible, metadata, fieldLabel, headings };
