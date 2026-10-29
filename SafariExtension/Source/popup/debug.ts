import { debugUtilities as FormFillDebug } from '../diagnostics/report';
import type { DiagnosticRecord } from '../shared/contracts';
export function installDebug(session: () => {
    analysis: DiagnosticRecord;
    requestID?: string;
    fields: DiagnosticRecord[];
    analysisURL?: string | null;
}) {
    const copyDebugButton = document.querySelector<HTMLButtonElement>('#copy-debug')!;
    const debugStatus = document.querySelector<HTMLElement>('#debug-status')!;
    const debugOutput = document.querySelector<HTMLTextAreaElement>('#debug-output')!;
    copyDebugButton.addEventListener('click', async () => {
        copyDebugButton.disabled = true;
        debugOutput.hidden = true;
        debugOutput.value = '';
        debugStatus.textContent = 'デバッグ情報を準備中…';
        let page;
        // Capture the session result before awaiting page access.
        const { analysis, requestID, fields, analysisURL } = session();
        let currentURL;
        let captureStatus = 'no_tab';
        let captureDiagnostics = {};
        try {
            try {
                const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
                if (!tab?.id)
                    throw new Error('no_tab');
                currentURL = FormFillDebug.pageURL(tab.url).url;
                captureStatus = 'injection_failed';
                await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['debug-page.js'] });
                // executeScript serializes this wrapper; the injected bundle owns its helpers.
                const results = await browser.scripting.executeScript({ target: { tabId: tab.id },
                    func: (id: string | null) => globalThis.FormFillCapturePage(id), args: [requestID ?? null] });
                // No allFrames/frameIds target is specified: this is the top document.
                // Safari's top frame ID need not be Chrome's numeric zero.
                const first = Array.isArray(results) ? results[0] : undefined;
                page = first?.result;
                captureDiagnostics = { resultCount: Array.isArray(results) ? results.length : 0,
                    resultType: page === null ? 'null' : Array.isArray(page) ? 'array' : typeof page,
                    hasInjectionError: Boolean(first?.error), collectorError: page?.collectorError };
                captureStatus = page?.version === 1 && Array.isArray(page.fields) ? 'success' : 'invalid_response';
                if (captureStatus === 'invalid_response')
                    page = undefined;
            }
            catch { /* Access failure is a fixed code, never an exception message. */ }
            const report = FormFillDebug.report(page, analysis, browser.runtime.getManifest().version, fields, captureStatus, { analysis: analysisURL, current: currentURL }, captureDiagnostics);
            const output = JSON.stringify(report, null, 2);
            try {
                await navigator.clipboard.writeText(output);
                debugStatus.textContent = page?.version === 1 ? 'デバッグ情報をコピーしました。'
                    : fields.length ? '現在のページ構造は取得できませんでしたが、解析時の情報をコピーしました。'
                        : 'ページへのアクセスに失敗した状態をコピーしました。';
            }
            catch {
                debugOutput.value = output;
                debugOutput.hidden = false;
                debugOutput.focus();
                debugOutput.select();
                debugStatus.textContent = '自動コピーできませんでした。下のデバッグ情報を選択してコピーしてください。';
            }
        }
        catch {
            debugStatus.textContent = 'デバッグ情報を準備できませんでした。再試行してください。';
        }
        finally {
            copyDebugButton.disabled = false;
        }
    });
}
