import { installInline } from './inline';
import { candidates, metadata, groupIDs } from './fields';
import { newRequestID } from '../shared/request-id';
import { createApply } from './apply';
import { unchanged } from './snapshot';
import type { Snapshot, Entry, DiagnosticRecord, PageRequest, Sender, Extraction } from '../shared/contracts';
(() => {
    const installed = globalThis.__formFillContentHandler;
    if (installed?.version === 14) return;
    if (installed) {
        browser.runtime.onMessage.removeListener(installed.listener);
        installed.disposeInline?.();
    } else if (globalThis.__formFillDiagnosticsInstalled) return;
    globalThis.__formFillDiagnosticsInstalled = true;
    let snapshot: Snapshot | undefined;
    let expires = 0;
    let developerRecord: DiagnosticRecord | undefined;
    let developerEntries: Entry[] = [];
    const clear = () => { snapshot = undefined; expires = 0; };
    const matches = (id: string) => Boolean(snapshot && snapshot.requestID === id && snapshot.url === location.href
        && performance.now() < expires && document.visibilityState !== 'hidden'
        && snapshot.entries.every(entry => unchanged(entry) && entry.element.value === entry.initialValue)
        && candidates().length === snapshot.all.length
        && candidates().every((element, index) => element === snapshot!.all[index]));
    const apply = createApply(() => {
        const saved = snapshot && matches(snapshot.requestID) && location.protocol === 'https:' ? snapshot : undefined;
        clear();
        return saved;
    }, () => developerRecord);
    const extract = (detailed = false): Extraction => {
        const all = candidates();
        const groups = groupIDs();
        const requestID = newRequestID();
        const entries = all.slice(0, 40).map((element, index) => ({ element, field: metadata(element, `f${index}`, groups), initialValue: element.value }));
        snapshot = { requestID, entries, all, url: location.href };
        expires = performance.now() + 180_000;
        developerEntries = detailed ? entries : [];
        developerRecord = detailed ? { requestID, url: location.href, capturedAt: new Date().toISOString(),
            fields: entries.map(entry => ({ ...entry.field, initialValue: entry.initialValue })),
            truncated: all.length > entries.length, analysis: { status: 'running' } } : undefined;
        return { version: 1, requestID, fields: entries.map(entry => entry.field), truncated: all.length > entries.length };
    };
    const listener = (message: PageRequest, sender: Sender) => {
        if (sender.id !== browser.runtime.id || sender.tab) return;
        if (message?.type === 'saveDeveloperAnalysis') {
            if (!developerRecord || message.requestID !== developerRecord.requestID || developerRecord.url !== location.href)
                return Promise.resolve({ ok: false });
            developerRecord.analysis = { ...developerRecord.analysis, ...message.analysis };
            if (message.page) developerRecord.analysisPage = message.page;
            return Promise.resolve({ ok: true });
        }
        if (message?.type === 'inspect') return Promise.resolve({ version: 1, fieldCount: candidates().length });
        if (message?.type === 'validateSnapshot') return Promise.resolve({ version: 1, ok: matches(message.requestID) });
        if (message?.type === 'discardSnapshot') { if (snapshot?.requestID === message.requestID) clear(); return Promise.resolve({ version: 1, ok: true }); }
        if (message?.type === 'extract') return Promise.resolve(extract(message.developerDiagnostics === true));
        if (message?.type === 'applyFill') return apply(message);
    };
    window.addEventListener('pagehide', () => { clear(); developerRecord = undefined; developerEntries = []; });
    browser.runtime.onMessage.addListener(listener);
    globalThis.__formFillContentHandler = { version: 14, listener, disposeInline: installInline(),
        developerFieldID: element => developerRecord?.url === location.href ? developerEntries.find(entry => entry.element === element)?.field.id ?? null : null,
        developerRecord: () => developerRecord?.url === location.href ? developerRecord : null,
        matchesSnapshot: (id) => matches(id)
    };
})();
