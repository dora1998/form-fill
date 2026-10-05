import type { FormField, Sender } from './shared/contracts';
const failure = (error: string) => Promise.resolve({ version: 1, ok: false, error });
const fieldKeys = ['id', 'tag', 'type', 'label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'autocomplete', 'context', 'maxLength', 'pattern', 'occupied', 'options'] as const;
/** Native requests are accepted only from extension pages such as the popup. */
browser.runtime.onMessage.addListener((payload: unknown, sender: Sender) => {
    if (!payload || typeof payload !== 'object' || sender.id !== browser.runtime.id || sender.tab)
        return failure('unsupported_request');
    const message = payload as Record<string, unknown>;
    if (!['health', 'modelProbe', 'analyzeForm', 'saveDeveloperReport'].includes(String(message.type)))
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
    if (request.type === 'analyzeForm') {
        if (typeof message.requestID !== 'string' || !message.requestID.length || message.requestID.length > 80
            || !Array.isArray(message.fields) || message.fields.length > 40
            || message.fields.some(field => !field || typeof field !== 'object'))
            return failure('invalid_request');
        request.requestID = message.requestID;
        if (message.developerDiagnostics === true)
            request.developerDiagnostics = true;
        request.fields = message.fields.map((field: Record<string, unknown>) => Object.fromEntries(fieldKeys.map(key => [key, field[key]])));
    }
    return browser.runtime.sendNativeMessage('dev.formfill.app.extension', request);
});
