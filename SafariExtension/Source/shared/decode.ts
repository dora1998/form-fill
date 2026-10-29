import type { AnalyzeResponse, PrepareResponse, FillResponse, Failure, AddressComponent, FillItem, SkippedField, Classification } from './contracts';
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const components = (value: unknown): value is AddressComponent[] => Array.isArray(value)
    && value.every(part => ['prefecture', 'municipality', 'locality', 'street', 'building'].includes(part));
export const invalidResponse = (): Failure => ({ version: 1, ok: false, error: 'invalid_response' });
const failure = (value: Record<string, unknown>): Failure | undefined => value.version === 1 && value.ok === false && typeof value.error === 'string'
    ? { version: 1, ok: false, error: value.error, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) } : undefined;
const classification = (value: unknown): value is Classification => object(value) && typeof value.id === 'string'
    && typeof value.kind === 'string' && typeof value.label === 'string' && components(value.components) && typeof value.source === 'string';
const fillItem = (value: unknown): value is FillItem => object(value) && typeof value.id === 'string'
    && typeof value.value === 'string' && value.value.length <= 300 && typeof value.label === 'string' && typeof value.displayValue === 'string';
const skippedField = (value: unknown): value is SkippedField => object(value) && typeof value.id === 'string'
    && typeof value.label === 'string' && typeof value.reason === 'string';
/** Decode at the native boundary. Keep optional diagnostics for the allowlisted report builder. */
export function decodeAnalyzeResponse(value: unknown): AnalyzeResponse {
    if (!object(value)) return invalidResponse();
    const failed = failure(value);
    if (failed) return failed;
    if (value.version !== 1 || value.ok !== true || typeof value.requestID !== 'string' || typeof value.sessionID !== 'string'
        || !Array.isArray(value.classifications) || value.classifications.length > 40 || !value.classifications.every(classification)) return invalidResponse();
    return value as unknown as AnalyzeResponse;
}
export function decodePrepareResponse(value: unknown): PrepareResponse {
    if (!object(value)) return invalidResponse();
    const failed = failure(value);
    if (failed) return failed;
    if (value.version !== 1 || value.ok !== true || typeof value.requestID !== 'string' || typeof value.sessionID !== 'string'
        || !Array.isArray(value.items) || value.items.length > 40 || !value.items.every(fillItem)
        || !Array.isArray(value.skipped) || !value.skipped.every(skippedField)) return invalidResponse();
    return value as unknown as PrepareResponse;
}

/** Validate the same metadata envelope accepted by BridgeContract.decodeAnalysis. */
export function isAnalyzeRequest(value: unknown): boolean {
    if (!object(value) || value.version !== 1 || value.type !== 'analyzeForm'
        || typeof value.requestID !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.requestID)
        || !Number.isInteger(value.tabID) || (value.tabID as number) < 0 || typeof value.origin !== 'string'
        || value.origin.length > 2048 || !/^https:\/\/[^/?#@]+$/.test(value.origin)) return false;
    try { if (!new URL(value.origin).hostname) return false; } catch { return false; }
    if (!Array.isArray(value.fields) || value.fields.length > 40) return false;
    try { if (new TextEncoder().encode(JSON.stringify(value.fields)).length > 100_000) return false; } catch { return false; }
    const textKeys = ['label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'autocomplete', 'context', 'pattern'];
    // Swift String.count counts extended grapheme clusters, not UTF-16 code units.
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    const shortText = (text: unknown): text is string => typeof text === 'string' && [...segmenter.segment(text)].length <= 120;
    const ids = new Set<string>();
    return value.fields.every(field => {
        if (!object(field) || typeof field.id !== 'string' || !/^f[0-9]{1,2}$/.test(field.id) || ids.has(field.id)) return false;
        ids.add(field.id);
        if (typeof field.tag !== 'string' || typeof field.type !== 'string'
            || !['input', 'select', 'textarea'].includes(field.tag) || textKeys.some(key => !shortText(field[key]))) return false;
        const postal = String(field.autocomplete).split(' ').includes('postal-code')
            || /zip|postal|postcode|郵便番号/i.test(`${field.name} ${field.htmlID}`) || /郵便番号/.test(`${field.label} ${field.ariaLabel}`);
        return (['text', 'number', 'search', 'select-one', 'textarea', ''].includes(field.type) || field.type === 'tel' && postal)
            && (field.groupID == null || typeof field.groupID === 'string' && /^g[0-9]{1,2}$/.test(field.groupID))
            && Number.isInteger(field.maxLength) && (field.maxLength as number) >= 0 && (field.maxLength as number) <= 100_000
            && typeof field.occupied === 'boolean' && Array.isArray(field.options) && field.options.length <= 60
            && field.options.every(option => object(option) && shortText(option.value) && shortText(option.text) && typeof option.disabled === 'boolean');
    });
}

export function decodeFillResponse(value: unknown): FillResponse {
    if (!object(value)) return invalidResponse();
    const failed = failure(value);
    if (failed) return failed;
    if (value.version !== 1 || value.ok !== true || !Array.isArray(value.results) || value.results.length > 40
        || !value.results.every(result => object(result) && typeof result.id === 'string'
            && typeof result.status === 'string' && ['filled', 'changed_by_page', 'failed'].includes(result.status))) return invalidResponse();
    // Page replies cannot smuggle registered values back into popup state.
    return { version: 1, ok: true, results: value.results.map(result => ({ id: result.id, status: result.status })) };
}
