import { eligible, visible, postalControl, nearbyLabel, headings } from '../content/fields';
import type { Control } from '../content/types';

// Inject the bundled file before invoking this function in the isolated world.
// The bundle shares DOM detection with content without depending on its installed version.
export const capturePage = (requestID: string | null) => {
    let stage = 'query_controls';
    try {
        const controls = [...document.querySelectorAll<Control>('input, select, textarea')];
        stage = 'filter_candidates';
        const all = controls.filter(eligible);
        stage = 'field_metadata';
        const fields = controls.slice(0, 200).map((element, index) => {
            const candidateIndex = all.indexOf(element);
            const tag = element.tagName.toLowerCase();
            return {
                index, fieldID: requestID ? globalThis.__formFillContentHandler?.fieldID?.(requestID, element) ?? null : null, tag,
                type: ['text', 'number', 'search', 'select-one', 'select-multiple', 'textarea', 'tel', 'email', 'password', 'hidden', 'checkbox', 'radio', 'file', 'submit', 'button', 'date', 'time', 'url'].includes(element.type) ? element.type : 'other',
                eligible: candidateIndex >= 0, disabled: element.matches(':disabled'), readOnly: 'readOnly' in element && element.readOnly === true,
                visible: visible(element), postalControl: element.type === 'tel' && postalControl(element),
                hasLabel: Boolean(element.labels?.length), hasNearbyLabel: Boolean(nearbyLabel(element)),
                hasAriaLabel: Boolean(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')),
                hasName: Boolean(element.name), hasID: Boolean(element.id), hasPlaceholder: Boolean(element.getAttribute('placeholder')),
                hasAutocomplete: Boolean(element.getAttribute('autocomplete')), hasContext: headings(element).length > 0,
                hasPattern: Boolean(element.getAttribute('pattern')),
                maxLength: 'maxLength' in element && Number.isInteger(element.maxLength) && element.maxLength > 0 ? Math.min(element.maxLength, 100000) : 0,
                optionCount: tag === 'select' ? (element as HTMLSelectElement).options.length : 0
            };
        });
        const installed = globalThis.__formFillContentHandler;
        stage = 'snapshot_match';
        return { version: 1, collectorVersion: 5, contentVersion: installed?.version ?? (globalThis.__formFillDiagnosticsInstalled ? 1 : 0),
            controlCount: controls.length, eligibleCount: all.length, iframeCount: document.querySelectorAll('iframe').length,
            truncated: controls.length > fields.length, analysisMatchesPage: installed?.matchesSnapshot?.(requestID ?? '') === true, fields };
    }
    catch {
        // Never return exception messages: DOM/framework errors can contain secrets.
        return { version: 1, collectorVersion: 5, collectorError: stage };
    }
};
