import { debugUtilities } from '../diagnostics/report';
import { captureDeveloperPage } from '../diagnostics/developer-page';
import type { DiagnosticRecord, SessionScope } from '../shared/contracts';
import type { FillWorkflowPorts, TabContext } from './workflow';
type BrowserAPI = typeof browser;

export function createPopupPorts(browser: BrowserAPI, close: () => void) {
    let debug = { analysis: debugUtilities.analysis('not_run'), requestID: undefined as string | undefined,
        fields: [] as DiagnosticRecord[], analysisURL: undefined as string | null | undefined };
    let capture: { tab: TabContext; requestID: string; detailed: boolean } | undefined;
    const record = async (saved: Pick<SessionScope, 'tabID' | 'requestID'>, phase: string, result: unknown) => {
        try { await browser.tabs.sendMessage(saved.tabID, { type: 'saveDeveloperAnalysis', requestID: saved.requestID, analysis: { [phase]: result } }); }
        catch { /* Optional diagnostics must not prevent filling. */ }
    };
    const ports: FillWorkflowPorts = {
        async activeTab() {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab?.id == null || !tab.url) throw Error('no_tab');
            return { tabID: tab.id, url: tab.url };
        },
        async extract(tab, options) {
            await browser.scripting.executeScript({ target: { tabId: tab.tabID }, files: ['content.js'] });
            return browser.tabs.sendMessage(tab.tabID, { type: 'extract', developerDiagnostics: options.detailed,
                groupID: options.groupID, selectionRequestID: options.selectionRequestID, inlineTarget: options.inlineTarget });
        },
        analyze: (tab, extracted, detailed) => browser.runtime.sendMessage({ type: 'analyzeForm', tabID: tab.tabID,
            requestID: extracted.requestID, fields: extracted.fields, developerDiagnostics: detailed }),
        prepare: session => browser.runtime.sendMessage({ type: 'prepareFill', ...session }),
        commit: (session, quick) => quick ? browser.runtime.sendMessage({ type: 'quickFill', ...session })
            : browser.runtime.sendMessage({ type: 'commitFill', ...session }),
        cancel: session => { void browser.runtime.sendMessage({ type: 'cancelFill', ...session }).catch(() => {}); },
        discard: (tabID, requestID) => { void browser.tabs.sendMessage(tabID, { type: 'discardSnapshot', requestID }).catch(() => {}); },
        close,
        diagnostics: {
            start() { capture = undefined; debug = { analysis: debugUtilities.analysis('running'), requestID: undefined, fields: [], analysisURL: undefined }; },
            async extracted(tab, extracted, detailed) {
                capture = { tab, requestID: extracted.requestID, detailed };
                debug = { analysis: debugUtilities.analysis(extracted.fields.length ? 'running' : 'no_fields'), requestID: extracted.requestID,
                    fields: debugUtilities.fieldMetadata(extracted.fields), analysisURL: debugUtilities.pageURL(tab.url).url };
                if (!detailed) return;
                try {
                    const pages = await browser.scripting.executeScript({ target: { tabId: tab.tabID }, func: captureDeveloperPage });
                    await browser.tabs.sendMessage(tab.tabID, { type: 'saveDeveloperAnalysis', requestID: extracted.requestID,
                        analysis: { status: 'extracted', extracted }, page: pages?.[0]?.result });
                } catch (error) { await record({ tabID: tab.tabID, requestID: extracted.requestID }, 'captureError', String(error)); }
            },
            analyzed(result) {
                if (!result.ok && result.error === 'model_unavailable') debug.analysis = debugUtilities.analysis('model_unavailable', result);
            },
            prepared(result) { debug.analysis = debugUtilities.analysis('success', result); },
            failed(error) {
                if (error !== 'model_unavailable') debug.analysis = debugUtilities.analysis(error === 'timeout' ? 'timeout' : 'failed');
                if (capture?.detailed) void record({ tabID: capture.tab.tabID, requestID: capture.requestID }, 'error', error);
            },
            record
        }
    };
    return { ports, debug: () => debug };
}
