import type { AnalyzeResponse, Classification, Extraction, FillItem, FillResponse, PrepareResponse, SessionScope, SkippedField } from '../shared/contracts';
export interface TabContext { tabID: number; url: string }
export interface SelectionContext extends TabContext { requestID: string }
export type WorkflowState =
    | { phase: 'idle'; cancelled?: boolean }
    | { phase: 'analyzing'; quick: boolean; destination?: string }
    | { phase: 'selecting'; context: SelectionContext; groups: NonNullable<Extraction['groups']> }
    | { phase: 'analyzed'; session: SessionScope; destination: string; classifications: Classification[] }
    | { phase: 'preparing'; session: SessionScope; destination: string }
    | { phase: 'prepared'; session: SessionScope; destination: string; items: FillItem[]; skipped: SkippedField[] }
    | { phase: 'committing'; session: SessionScope; destination: string; quick: boolean; classifications?: Classification[] }
    | { phase: 'completed'; filled: number; total: number }
    | { phase: 'no_fields' }
    | { phase: 'diagnostics_collected' }
    | { phase: 'failed'; error: string; reason?: string };
export interface WorkflowClock {
    schedule(callback: () => void, milliseconds: number): unknown;
    cancel(handle: unknown): void;
}
export const systemClock: WorkflowClock = {
    schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};
export interface WorkflowDiagnostics {
    start(): void;
    extracted(tab: TabContext, extracted: Extraction, detailed: boolean): Promise<void>;
    analyzed(result: AnalyzeResponse): void;
    prepared(result: PrepareResponse): void;
    failed(error: string): void;
    record(session: SessionScope, phase: string, result: unknown): Promise<void>;
}
export interface FillWorkflowPorts {
    activeTab(): Promise<TabContext>;
    extract(tab: TabContext, options: { detailed: boolean; groupID?: string; selectionRequestID?: string; inlineTarget: boolean }): Promise<Extraction>;
    analyze(tab: TabContext, extracted: Extraction, detailed: boolean): Promise<AnalyzeResponse>;
    prepare(session: SessionScope): Promise<PrepareResponse>;
    commit(session: SessionScope, quick: boolean): Promise<FillResponse>;
    cancel(session: SessionScope): void;
    discard(tabID: number, requestID: string): void;
    close(): void;
    diagnostics: WorkflowDiagnostics;
    clock?: WorkflowClock;
}
/** Owns the fill lifecycle; DOM rendering and WebExtension globals stay outside. */
export function createFillWorkflow(ports: FillWorkflowPorts, render: (state: WorkflowState) => void) {
    const clock = ports.clock ?? systemClock;
    let state: WorkflowState = { phase: 'idle' };
    let generation = 0;
    let expiry: unknown;
    let session: SessionScope | undefined;
    let snapshot: { tabID: number; requestID: string } | undefined;
    const publish = (next: WorkflowState) => { state = next; render(next); };
    const reset = (discard = true) => {
        generation++;
        clock.cancel(expiry);
        expiry = undefined;
        if (session) ports.cancel(session);
        if (discard && snapshot) ports.discard(snapshot.tabID, snapshot.requestID);
        session = undefined;
        snapshot = undefined;
    };
    const fail = (error: unknown, reason?: string) => {
        const code = error instanceof Error ? error.message : String(error);
        reset();
        ports.diagnostics.failed(code);
        publish({ phase: 'failed', error: code, reason });
    };
    const expire = (milliseconds: number) => {
        clock.cancel(expiry);
        expiry = clock.schedule(() => fail('stale_plan'), milliseconds);
    };
    const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
        let timer: unknown;
        try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = clock.schedule(() => reject(Error('timeout')), 60_000); })]); }
        finally { clock.cancel(timer); }
    };
    const complete = (result: FillResponse, quick: boolean) => {
        if (!result.ok || !Array.isArray(result.results)) throw Error(result.error ?? 'invalid_response');
        const filled = result.results.filter(item => item.status === 'filled').length;
        reset();
        publish({ phase: 'completed', filled, total: result.results.length });
        if (quick && filled) ports.close();
    };
    const commit = async (saved: SessionScope, destination: string, quick: boolean, classifications?: Classification[]) => {
        const token = generation;
        publish({ phase: 'committing', session: saved, destination, quick, classifications });
        try {
            const result = await withTimeout(ports.commit(saved, quick));
            await ports.diagnostics.record(saved, 'commit', result);
            if (token === generation) complete(result, quick);
        } catch (error) {
            await ports.diagnostics.record(saved, 'error', String(error));
            if (token === generation) fail(error);
        }
    };
    const analyze = async (options: { quickStart?: TabContext; groupID?: string; detailed?: boolean } = {}) => {
        const { quickStart, groupID, detailed = false } = options;
        const selected = groupID && state.phase === 'selecting' ? state.context : undefined;
        // A group selection deliberately reuses the still-valid selection snapshot.
        reset(!selected);
        const token = generation;
        ports.diagnostics.start();
        publish({ phase: 'analyzing', quick: Boolean(quickStart) });
        try {
            const tab = await ports.activeTab();
            if (token !== generation) return;
            if (groupID && (!selected || selected.tabID !== tab.tabID || selected.url !== tab.url)) throw Error('stale_plan');
            if (quickStart && (tab.tabID !== quickStart.tabID || tab.url !== quickStart.url)) throw Error('stale_plan');
            const url = new URL(tab.url);
            if (url.protocol !== 'https:' || url.username || url.password) throw Error('https_required');
            publish({ phase: 'analyzing', quick: Boolean(quickStart), destination: url.origin });
            const extracted = await ports.extract(tab, { detailed, groupID, selectionRequestID: selected?.requestID, inlineTarget: Boolean(quickStart) });
            if (token !== generation) { ports.discard(tab.tabID, extracted.requestID); return; }
            snapshot = { tabID: tab.tabID, requestID: extracted.requestID };
            if (!detailed && !quickStart && !groupID && (extracted.groups?.length ?? 0) > 1) {
                publish({ phase: 'selecting', context: { ...tab, requestID: extracted.requestID }, groups: extracted.groups! });
                return;
            }
            const activeGroup = (extracted.groups?.length ?? 0) > 1 ? extracted.groups?.find(group => group.id === extracted.fields[0]?.groupID) : undefined;
            const destination = `${url.origin}${activeGroup ? ` / ${activeGroup.label}` : ''}`;
            await ports.diagnostics.extracted(tab, extracted, detailed);
            if (token !== generation) return;
            if (!extracted.fields.length) { reset(); publish({ phase: 'no_fields' }); return; }
            // If timeout/cancellation wins, a later native session must still be revoked.
            const pending = ports.analyze(tab, extracted, detailed).then(result => {
                if (result.ok && result.sessionID) {
                    const received = { tabID: tab.tabID, origin: url.origin, requestID: extracted.requestID, sessionID: result.sessionID };
                    if (token !== generation) ports.cancel(received);
                    else session = received; // Reset can now revoke even a response racing a timeout.
                }
                return result;
            });
            const result = await withTimeout(pending);
            if (token !== generation) return;
            ports.diagnostics.analyzed(result);
            const saved = { tabID: tab.tabID, origin: url.origin, requestID: extracted.requestID,
                sessionID: result.ok ? result.sessionID : '' };
            if (result.ok) {
                if (result.requestID !== extracted.requestID || !result.sessionID || !Array.isArray(result.classifications)) throw Error('invalid_response');
                // Own the validated session before any diagnostic await so cancellation can revoke it.
                session = saved;
            }
            await ports.diagnostics.record(saved, 'response', result);
            if (token !== generation) return;
            if (!result.ok) { fail(result.error, result.reason); return; }
            // Detailed collection never unlocks a profile or fills the page.
            if (detailed) { reset(); publish({ phase: 'diagnostics_collected' }); return; }
            if (quickStart) { await commit(saved, destination, true, result.classifications); return; }
            publish({ phase: 'analyzed', session: saved, destination, classifications: result.classifications });
            expire(120_000);
        } catch (error) { if (token === generation) fail(error); }
    };
    const unlock = async () => {
        if (state.phase !== 'analyzed') return;
        const { session: saved, destination } = state;
        const token = generation;
        publish({ phase: 'preparing', session: saved, destination });
        try {
            const result = await withTimeout(ports.prepare(saved));
            await ports.diagnostics.record(saved, 'prepare', result.ok ? { ok: true,
                items: result.items.map(item => ({ id: item.id, kind: item.kind, components: item.components })), skipped: result.skipped } : result);
            if (token !== generation) return;
            if (!result.ok || !Array.isArray(result.items) || !Array.isArray(result.skipped)) throw Error(result.error ?? 'invalid_response');
            ports.diagnostics.prepared(result);
            publish({ phase: 'prepared', session: saved, destination, items: result.items, skipped: result.skipped });
            expire(60_000);
        } catch (error) { if (token === generation) fail(error); }
    };
    const fill = async () => {
        if (state.phase !== 'prepared' || !state.items.length) return;
        await commit(state.session, state.destination, false);
    };
    const cancel = () => { reset(); publish({ phase: 'idle', cancelled: true }); };
    return { analyze, unlock, fill, cancel, state: () => state };
}
