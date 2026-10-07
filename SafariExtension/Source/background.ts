import type { AnalysisResult, FormField, FillResponse, Sender } from './shared/contracts';
const failure = (error: string) => ({ version: 1, ok: false, error });
const fieldKeys = ['id', 'groupID', 'tag', 'type', 'label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'autocomplete', 'context', 'maxLength', 'pattern', 'occupied', 'options'] as const;
const native = (message: unknown) => browser.runtime.sendNativeMessage('dev.formfill.app.extension', message) as Promise<AnalysisResult>;

let inlineStart: { tabID: number; url: string; expires: number; ready: Promise<void> } | undefined;
// Only our packaged popup may request registered data. Page/content messages,
// including the former one-step inline path, are rejected.
browser.runtime.onMessage.addListener(async (payload: unknown, sender: Sender) => {
    // Content may open the trusted popup, but cannot request any native service.
    if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).type === 'openFillPopup') {
        if (sender.id !== browser.runtime.id || sender.tab?.id == null || sender.frameId !== 0
            || !sender.url || !/^https:\/\//.test(sender.url)) return failure('unsupported_request');
        try {
            const ready = browser.action.openPopup();
            inlineStart = { tabID: sender.tab.id, url: sender.url, expires: Date.now() + 10000, ready };
            await ready;
            return { version: 1, ok: true };
        } catch { inlineStart = undefined; return failure('popup_unavailable'); }
    }
    if (sender.id !== browser.runtime.id || sender.tab || sender.url !== browser.runtime.getURL('popup.html')
        || !payload || typeof payload !== 'object') return failure('unsupported_request');
    const message = payload as Record<string, unknown>;
    const type = String(message.type);
    if (type === 'consumeInlineStart') {
        const start = inlineStart;
        inlineStart = undefined;
        if (!start || start.expires <= Date.now()) return { version: 1, ok: true };
        // Do not present OS authentication during Safari's popup transition.
        try { await start.ready; } catch { return failure('popup_unavailable'); }
        if (start.expires <= Date.now()) return failure('stale_plan');
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id !== start.tabID || tab.url !== start.url) return failure('stale_plan');
        return { version: 1, ok: true, tabID: start.tabID, url: start.url };
    }
    if (type === 'saveDeveloperReport') {
        if (typeof message.report !== 'string' || new TextEncoder().encode(message.report).length > 20 * 1024 * 1024)
            return failure('report_too_large');
        return native({ version: 1, type, report: message.report });
    }
    if (['health', 'modelProbe'].includes(type)) return native({ version: 1, type });
    if (!['analyzeForm', 'prepareFill', 'commitFill', 'quickFill', 'cancelFill'].includes(type)) return failure('unsupported_request');
    if (typeof message.requestID !== 'string' || message.requestID.length > 80
        || !Number.isInteger(message.tabID)) return failure('invalid_request');
    if (type !== 'analyzeForm' && (typeof message.sessionID !== 'string' || message.sessionID.length > 80)) return failure('invalid_request');
    if (type === 'cancelFill') {
        // Cancellation grants no access. Use the original scope even after navigation.
        return native({ version: 1, type, requestID: message.requestID, sessionID: message.sessionID,
            tabID: message.tabID, origin: message.origin });
    }
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id !== message.tabID || !tab.url) return failure('stale_plan');
        const url = new URL(tab.url);
        if (url.protocol !== 'https:' || url.username || url.password) return failure('https_required');
        const request: Record<string, unknown> = { version: 1, type, requestID: message.requestID,
            tabID: tab.id, origin: url.origin };
        if (type === 'analyzeForm') {
            if (!Array.isArray(message.fields) || message.fields.length > 40
                || message.fields.some(field => !field || typeof field !== 'object')) return failure('invalid_request');
            request.developerDiagnostics = message.developerDiagnostics === true;
            request.fields = message.fields.map((field: Record<string, unknown>) => Object.fromEntries(fieldKeys.map(key => [key, field[key]])));
        } else request.sessionID = message.sessionID;
        const valid = () => browser.tabs.sendMessage(tab.id!, { type: 'validateSnapshot', requestID: message.requestID as string });
        if (!(await valid()).ok) return failure('stale_plan');
        const result = await native(request);
        if (!result.ok) return result;
        const [current] = await browser.tabs.query({ active: true, currentWindow: true });
        if (current?.id !== tab.id || current.url !== tab.url || !(await valid()).ok) {
            if (result.sessionID) await native({ ...request, type: 'cancelFill', sessionID: result.sessionID });
            return failure('stale_plan');
        }
        if (type === 'commitFill' || type === 'quickFill') {
            if (result.requestID !== message.requestID || !Array.isArray(result.items)) return failure('invalid_response');
            // Values come from the authenticated native result, never from popup input.
            const response: FillResponse = await browser.tabs.sendMessage(tab.id!, {
                type: 'applyFill', requestID: result.requestID,
                items: result.items.map(({ id, kind, value }) => ({ id, kind, value }))
            });
            return response;
        }
        return result;
    } catch { return failure('request_failed'); }
});
