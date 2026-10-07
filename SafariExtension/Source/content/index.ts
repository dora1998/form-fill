import { installInline } from './inline';
import { candidates, metadata, groupIDs, fieldLabel } from './fields';
import { newRequestID } from '../shared/request-id';
import { createApply } from './apply';
import { unchanged } from './snapshot';
import type { Snapshot, Entry, DiagnosticRecord, PageRequest, Sender, Extraction, Control } from '../shared/contracts';
(() => {
    const installed = globalThis.__formFillContentHandler;
    if (installed?.version === 15) return;
    if (installed) {
        browser.runtime.onMessage.removeListener(installed.listener);
        installed.disposeInline?.();
    } else if (globalThis.__formFillDiagnosticsInstalled) return;
    globalThis.__formFillDiagnosticsInstalled = true;
    let inlineTarget: Control | undefined;
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
    const extract = (detailed = false, groupID?: string, fromInline = false): Extraction => {
        const all = candidates();
        const groups = groupIDs();
        const targetGroup = fromInline ? inlineTarget && groups.get(inlineTarget) : groupID;
        if (fromInline) inlineTarget = undefined;
        const selected = fromInline || groupID ? all.filter(element => targetGroup && groups.get(element) === targetGroup) : all;
        const requestID = newRequestID();
        const entries = selected.slice(0, 40).map((element, index) => ({ element, field: metadata(element, `f${index}`, groups), initialValue: element.value }));
        snapshot = { requestID, entries, all, url: location.href };
        expires = performance.now() + 180_000;
        developerEntries = detailed ? entries : [];
        developerRecord = detailed ? { requestID, url: location.href, capturedAt: new Date().toISOString(),
            fields: entries.map(entry => ({ ...entry.field, initialValue: entry.initialValue })),
            truncated: selected.length > entries.length, analysis: { status: 'running' } } : undefined;
        const groupKeys = [...new Set(groups.values())];
        return { version: 1, requestID, fields: entries.map(entry => entry.field), truncated: selected.length > entries.length,
            groups: groupKeys.map((id, index) => {
                const controls = all.filter(element => groups.get(element) === id);
                const heading = controls[0]?.closest('fieldset')?.querySelector('legend')?.textContent?.trim()
                    || controls[0]?.closest('section, [role="group"]')?.querySelector('h1, h2, h3, [role="heading"]')?.textContent?.trim();
                return { id, label: `入力先${index + 1}${heading ? `（${heading.slice(0, 80)}）` : ''}`,
                    fields: [...new Set(controls.map(element => fieldLabel(element).trim().slice(0, 120)))].slice(0, 6) };
            }) };
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
        if (message?.type === 'extract') {
            if (message.groupID && (!message.selectionRequestID || !matches(message.selectionRequestID)))
                return Promise.reject(new Error('stale_plan'));
            return Promise.resolve(extract(message.developerDiagnostics === true, message.groupID, message.inlineTarget === true));
        }
        if (message?.type === 'applyFill') return apply(message);
    };
    window.addEventListener('pagehide', () => { clear(); developerRecord = undefined; developerEntries = []; });
    browser.runtime.onMessage.addListener(listener);
    globalThis.__formFillContentHandler = { version: 15, listener, disposeInline: installInline(target => { inlineTarget = target; }),
        developerFieldID: element => developerRecord?.url === location.href ? developerEntries.find(entry => entry.element === element)?.field.id ?? null : null,
        developerRecord: () => developerRecord?.url === location.href ? developerRecord : null,
        matchesSnapshot: (id) => matches(id)
    };
})();
