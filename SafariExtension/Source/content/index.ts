import type { Entry, Control } from './types';
import { installInline } from './inline';
import { candidates, metadata, groupIDs, fieldLabel } from './fields';
import { newRequestID } from '../shared/request-id';
import { createApply } from './apply';
import { createSnapshotSession, snapshotUnchanged } from './snapshot';
import type { DiagnosticRecord, PageRequest, Sender, Extraction } from '../shared/contracts';
(() => {
    const installed = globalThis.__formFillContentHandler;
    if (installed?.version === 17) return;
    if (installed) {
        if (installed.dispose) installed.dispose();
        else { browser.runtime.onMessage.removeListener(installed.listener); installed.disposeInline?.(); }
    } else if (globalThis.__formFillDiagnosticsInstalled) return;
    globalThis.__formFillDiagnosticsInstalled = true;
    let inlineTarget: Control | undefined;
    const snapshots = createSnapshotSession({ url: () => location.href, visible: () => document.visibilityState !== 'hidden',
        now: () => performance.now(), validate: snapshotUnchanged });
    let developerRecord: DiagnosticRecord | undefined;
    let developerEntries: Entry[] = [];
    const apply = createApply(() => {
        const saved = snapshots.take();
        return location.protocol === 'https:' ? saved : undefined;
    }, () => developerRecord);
    const extract = (detailed = false, groupID?: string, fromInline = false): Extraction => {
        const all = candidates();
        const groups = groupIDs(all);
        const targetGroup = fromInline ? inlineTarget && groups.get(inlineTarget) : groupID;
        if (fromInline) inlineTarget = undefined;
        const selected = fromInline || groupID ? all.filter(element => targetGroup && groups.get(element) === targetGroup) : all;
        const requestID = newRequestID();
        const entries = selected.slice(0, 40).map((element, index) => ({ element, field: metadata(element, `f${index}`, groups), initialValue: element.value }));
        snapshots.create({ requestID, entries, all, url: location.href });
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
        if (message?.type === 'validateSnapshot') return Promise.resolve({ version: 1, ok: snapshots.matches(message.requestID) });
        if (message?.type === 'discardSnapshot') { snapshots.discard(message.requestID); return Promise.resolve({ version: 1, ok: true }); }
        if (message?.type === 'extract') {
            if (message.groupID && (!message.selectionRequestID || !snapshots.matches(message.selectionRequestID)))
                return Promise.reject(new Error('stale_plan'));
            return Promise.resolve(extract(message.developerDiagnostics === true, message.groupID, message.inlineTarget === true));
        }
        if (message?.type === 'applyFill') return apply(message);
    };
    const pagehide = () => { snapshots.discard(); developerRecord = undefined; developerEntries = []; };
    window.addEventListener('pagehide', pagehide);
    browser.runtime.onMessage.addListener(listener);
    const disposeInline = installInline(target => { inlineTarget = target; });
    globalThis.__formFillContentHandler = { version: 17, listener, disposeInline,
        dispose: () => { pagehide(); disposeInline(); browser.runtime.onMessage.removeListener(listener); window.removeEventListener('pagehide', pagehide); },
        fieldID: snapshots.fieldID,
        developerFieldID: element => developerRecord?.url === location.href ? developerEntries.find(entry => entry.element === element)?.field.id ?? null : null,
        developerRecord: () => developerRecord?.url === location.href ? developerRecord : null,
        matchesSnapshot: snapshots.matches
    };
})();
