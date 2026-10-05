import { candidates, metadata } from './fields';
import { newRequestID } from '../shared/request-id';
import { createApply } from './apply';
import type { Snapshot, Entry, PageRequest, Sender, Extraction, DiagnosticRecord } from '../shared/contracts';
(() => {
    const installed = globalThis.__formFillContentHandler;
    if (installed?.version === 9)
        return;
    if (installed) {
        browser.runtime.onMessage.removeListener(installed.listener);
        // Clean up the focus UI if this page still has the previous release installed.
        installed.disposeInline?.();
    }
    // Old releases did not retain the listener reference. Keep their in-flight
    // preview intact; a page reload installs the current handler safely.
    else if (globalThis.__formFillDiagnosticsInstalled)
        return;
    globalThis.__formFillDiagnosticsInstalled = true;
    let snapshot: Snapshot | undefined;
    const apply = createApply(() => { const saved = snapshot; snapshot = undefined; return saved; }, () => developerRecord);
    let developerRecord: DiagnosticRecord | undefined;
    let developerEntries: Entry[] = [];
    const extract = (detailed = false): Extraction => {
        const all = candidates();
        const requestID = newRequestID();
        const entries = all.slice(0, 40).map((element, index) => ({ element, field: metadata(element, `f${index}`), initialValue: element.value }));
        snapshot = { requestID, entries, all, url: location.href };
        developerEntries = detailed ? entries : [];
        developerRecord = detailed ? {
            requestID, url: location.href, capturedAt: new Date().toISOString(),
            fields: entries.map(entry => ({ ...entry.field, initialValue: entry.initialValue })),
            truncated: all.length > entries.length, analysis: { status: 'running' }
        } : undefined;
        return { version: 1, requestID, fields: entries.map(entry => entry.field), truncated: all.length > entries.length };
    };
    const listener = (message: PageRequest, sender: Sender) => {
        if (sender.id !== browser.runtime.id)
            return;
        if (message?.type === 'saveDeveloperAnalysis') {
            if (!developerRecord || message.requestID !== developerRecord.requestID || developerRecord.url !== location.href)
                return Promise.resolve({ ok: false });
            developerRecord.analysis = { ...developerRecord.analysis, ...message.analysis };
            if (message.page)
                developerRecord.analysisPage = message.page;
            developerRecord.analysisCompletedAt = new Date().toISOString();
            return Promise.resolve({ ok: true });
        }
        if (message?.type === 'inspect')
            return Promise.resolve({ version: 1, fieldCount: candidates().length });
        if (message?.type === 'extract')
            return Promise.resolve(extract(message.developerDiagnostics === true));
        if (message?.type === 'applyFill')
            return apply(message);
    };
    browser.runtime.onMessage.addListener(listener);
    globalThis.__formFillContentHandler = { version: 9, listener,
        developerFieldID: element => developerRecord?.url === location.href ? developerEntries.find(entry => entry.element === element)?.field.id ?? null : null,
        developerRecord: () => developerRecord?.url === location.href ? developerRecord : null,
        matchesSnapshot: (requestID, all) => Boolean(snapshot && requestID === snapshot.requestID && snapshot.url === location.href
            && all.length === snapshot.all.length && all.every((element, index) => element === snapshot!.all[index]))
    };
})();
