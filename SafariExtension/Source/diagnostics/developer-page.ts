import type { Control } from '../content/types';
import type { DiagnosticRecord } from '../shared/contracts';
// Self-contained for scripting.executeScript; no page code is evaluated.
export const captureDeveloperPage = () => {
    const limits = { documents: 20, nodes: 30000, controls: 1000, options: 1000, htmlCharacters: 2000000 };
    let remainingNodes = limits.nodes;
    let remainingControls = limits.controls;
    let remainingHTML = limits.htmlCharacters;
    const documents: DiagnosticRecord[] = [];
    const unavailable: DiagnosticRecord[] = [];
    const errors: DiagnosticRecord[] = [];
    const errorText = (error: unknown) => String(error instanceof Error ? error.stack : error).slice(0, 4000);
    const capture = (root: Document | ShadowRoot, path: string, doc: Document): void => {
        if (documents.length >= limits.documents) {
            unavailable.push({ path, reason: 'document_limit' });
            return;
        }
        const entry: DiagnosticRecord = { path, url: doc.URL, title: doc.title, controls: [], shadows: [], truncated: [] };
        documents.push(entry);
        try {
            const html = root instanceof Document ? root.documentElement?.outerHTML || '' : root.innerHTML;
            entry.html = html.slice(0, remainingHTML);
            remainingHTML -= entry.html.length;
            if (entry.html.length < html.length)
                entry.truncated.push('html');
            const nodes = root.querySelectorAll('*');
            for (let index = 0; index < nodes.length; index++) {
                if (remainingNodes-- <= 0) {
                    entry.truncated.push('nodes');
                    break;
                }
                const element = nodes[index] as Element & Partial<HTMLInputElement & HTMLSelectElement & HTMLIFrameElement>;
                if (element.matches('input, select, textarea')) {
                    if (remainingControls <= 0) {
                        if (!entry.truncated.includes('controls'))
                            entry.truncated.push('controls');
                    }
                    else {
                        remainingControls--;
                        if ((element.options?.length ?? 0) > limits.options)
                            entry.truncated.push(`options:node[${index}]`);
                        const rect = element.getBoundingClientRect();
                        const style = doc.defaultView!.getComputedStyle(element);
                        const validity = element.validity;
                        entry.controls.push({ nodeIndex: index, fieldID: globalThis.__formFillContentHandler?.developerFieldID?.(element as Control) ?? null, tag: element.localName,
                            attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])),
                            value: element.value, checked: element.checked, selectedIndex: element.selectedIndex,
                            options: element.options ? [...element.options].slice(0, limits.options).map(option => ({ value: option.value, text: option.text, selected: option.selected, disabled: option.disabled })) : undefined,
                            labels: [...element.labels || []].map(label => label.textContent),
                            disabled: element.matches(':disabled'), readOnly: element.readOnly,
                            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                            style: { display: style.display, visibility: style.visibility, opacity: style.opacity },
                            validity: validity ? Object.fromEntries(['valid', 'valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError'].map(key => [key, validity[key as keyof ValidityState]])) : undefined,
                            validationMessage: element.validationMessage
                        });
                    }
                }
                if (element.shadowRoot) {
                    const shadowPath = `${path}/node[${index}]/shadow`;
                    entry.shadows.push({ nodeIndex: index, path: shadowPath });
                    capture(element.shadowRoot, shadowPath, doc);
                }
                if (element.matches('iframe, frame')) {
                    const framePath = `${path}/node[${index}]/frame`;
                    try {
                        const frameDoc = element.contentDocument;
                        if (!frameDoc?.documentElement)
                            unavailable.push({ path: framePath, src: element.getAttribute('src'), reason: 'cross_origin_or_unloaded' });
                        else
                            capture(frameDoc, framePath, frameDoc);
                    }
                    catch (error) {
                        unavailable.push({ path: framePath, reason: 'frame_access', error: errorText(error) });
                    }
                }
            }
        }
        catch (error) {
            errors.push({ path, error: errorText(error) });
        }
    };
    capture(document, 'top', document);
    let lastRun = null;
    try {
        lastRun = globalThis.__formFillContentHandler?.developerRecord?.() ?? null;
    }
    catch (error) {
        errors.push({ path: 'lastRun', error: errorText(error) });
    }
    return { version: 1, collectorVersion: 1, capturedAt: new Date().toISOString(),
        url: location.href, userAgent: navigator.userAgent, language: navigator.language,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, scrollX, scrollY },
        contentVersion: globalThis.__formFillContentHandler?.version ?? 0,
        limits, documents, unavailable, errors, lastRun,
        limitations: ['DOM snapshot includes personal data and may include embedded credentials.',
            'Cookies, browser storage, network bodies, JS heap, event listeners and pre-existing console logs are not collected.',
            'Cross-origin frames and closed shadow roots are inaccessible. Collection limits are reported per document.',
            'HTML contains site scripts. Inspect as text; do not run as a trusted page. Dynamic site behaviour requires the original site.',
            'lastRun is the latest opted-in analysis in this top document, cleared by normal analysis or document reload; no automatic disk storage; explicit exports are saved in the app.'] };
};
