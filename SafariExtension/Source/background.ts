import type { FormField, Sender } from './shared/contracts';
const failure = (error: string) => Promise.resolve({ version: 1, ok: false, error });
const fieldKeys = ['id', 'groupID', 'tag', 'type', 'label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'autocomplete', 'context', 'maxLength', 'pattern', 'occupied', 'options'] as const;
/** Only the rules-only inline request is accepted from top-level content scripts. */
browser.runtime.onMessage.addListener((payload: unknown, sender: Sender) => {
    if (!payload || typeof payload !== 'object' || sender.id !== browser.runtime.id)
        return failure('unsupported_request');
    const message = payload as Record<string, unknown>;
    const inline = message.type === 'analyzeInline' && Boolean(sender.tab?.id) && sender.frameId === 0 && /^https?:\/\//.test(sender.url || '');
    if ((sender.tab && !inline) || (message.type === 'analyzeInline' && !inline))
        return failure('unsupported_request');
    if (!['health', 'modelProbe', 'analyzeForm', 'analyzeInline', 'saveDeveloperReport'].includes(String(message.type)))
        return failure('unsupported_request');
    const request: {
        version: number;
        type: unknown;
        report?: string;
        requestID?: string;
        fields?: Partial<FormField>[];
        developerDiagnostics?: boolean;
    } = { version: 1, type: message.type };
    if (message.type === 'saveDeveloperReport') {
        if (typeof message.report !== 'string')
            return failure('invalid_request');
        if (message.report.length > 20 * 1024 * 1024)
            return failure('report_too_large');
        request.report = message.report;
    }
    if (request.type === 'analyzeForm' || request.type === 'analyzeInline') {
        if (typeof message.requestID !== 'string' || !message.requestID.length || message.requestID.length > 80
            || !Array.isArray(message.fields) || message.fields.length > 40
            || message.fields.some(field => !field || typeof field !== 'object'))
            return failure('invalid_request');
        request.requestID = message.requestID;
        if (!inline && message.developerDiagnostics === true)
            request.developerDiagnostics = true;
        request.fields = message.fields.map((field: Record<string, unknown>) => Object.fromEntries(fieldKeys.map(key => [key, field[key]])));
    }
    return browser.runtime.sendNativeMessage('dev.formfill.app.extension', request);
});
