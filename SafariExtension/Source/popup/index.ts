import { installDebug } from './debug';
import type { AnalysisResult, Extraction, DiagnosticRecord } from '../shared/contracts';
import './health';
import { unavailableReasons } from '../shared/model-status';
const analyzeButton = document.querySelector<HTMLButtonElement>('#analyze')!;
const unlockButton = document.querySelector<HTMLButtonElement>('#unlock')!;
const fillButton = document.querySelector<HTMLButtonElement>('#fill')!;
const fillStatus = document.querySelector<HTMLElement>('#fill-status')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
type Session = { tabID: number; origin: string; requestID: string; sessionID: string };
let session: Session | null = null;
let generation = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
let lastAnalysis = FormFillDebug.analysis('not_run');
let debugRequestID: string | undefined;
let debugFields: DiagnosticRecord[] = [];
let debugAnalysisURL: string | null | undefined;
const errorMessages: Record<string, string> = {
    profile_missing: 'プロフィールが未登録です。Form Fillアプリの設定から登録してください。',
    authentication_failed: '認証できませんでした。Face IDの許可や端末パスコードを確認し、再解析してください。',
    profile_changed: 'プロフィールが変更・削除されました。再解析して確認してください。',
    profile_unreadable: '保存データを読み取れません。Form Fillアプリの設定で確認してください。',
    https_required: '登録情報はHTTPSのページでのみ入力できます。',
    stale_plan: 'ページが変わったか確認の期限が切れました。再解析してください。',
    timeout: '処理が時間内に完了しませんでした。再解析してください。'
};
const withTimeout = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 60000); })]); }
    finally { clearTimeout(timer); }
};
const rows = <T>(selector: string, values: T[], render: (row: T) => string) => {
    const list = document.querySelector<HTMLElement>(selector)!;
    list.replaceChildren();
    for (const value of values) {
        const item = document.createElement('li');
        item.textContent = render(value);
        list.append(item);
    }
};
const cancel = (saved: Session) => {
    void browser.runtime.sendMessage({ type: 'cancelFill', ...saved }).catch(() => {});
    void browser.tabs.sendMessage(saved.tabID, { type: 'discardSnapshot', requestID: saved.requestID }).catch(() => {});
};
const recordPhase = async (saved: Session, phase: string, result: unknown) => {
    try { await browser.tabs.sendMessage(saved.tabID, { type: 'saveDeveloperAnalysis', requestID: saved.requestID,
        analysis: { [phase]: result } }); } catch { /* Only opted-in content retains this record. */ }
};
const clear = () => {
    generation++;
    clearTimeout(expiry);
    if (session) cancel(session);
    session = null;
    preview.hidden = true;
    unlockButton.hidden = false;
    unlockButton.disabled = true;
    fillButton.disabled = true;
    rows('#plan', [], () => '');
    rows('#skipped', [], () => '');
};
const fail = (error: unknown) => {
    clear();
    fillStatus.textContent = errorMessages[error instanceof Error ? error.message : '']
        ?? '処理できませんでした。Safariのサイトアクセス許可を確認して再試行してください。';
};
analyzeButton.addEventListener('click', async () => {
    clear();
    const token = generation;
    const detailed = document.querySelector<HTMLInputElement>('#developer-record')?.checked === true;
    let developerTabID: number | undefined;
    const saveDeveloper = async (analysis: DiagnosticRecord, page?: unknown) => {
        if (!detailed || developerTabID == null || !debugRequestID) return;
        try { await browser.tabs.sendMessage(developerTabID, { type: 'saveDeveloperAnalysis', requestID: debugRequestID, analysis, page }); }
        catch { /* Diagnostic failure must not affect filling. */ }
    };
    lastAnalysis = FormFillDebug.analysis('running');
    debugRequestID = undefined;
    debugFields = [];
    debugAnalysisURL = undefined;
    analyzeButton.disabled = true;
    fillStatus.textContent = '入力欄を解析中…';
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id == null || !tab.url) throw new Error('no_tab');
        const url = new URL(tab.url);
        if (url.protocol !== 'https:') throw new Error('https_required');
        developerTabID = tab.id;
        debugAnalysisURL = FormFillDebug.pageURL(tab.url).url;
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        const extracted: Extraction = await browser.tabs.sendMessage(tab.id, { type: 'extract', developerDiagnostics: detailed });
        if (token !== generation) return;
        debugRequestID = extracted.requestID;
        debugFields = FormFillDebug.fieldMetadata(extracted.fields);
        if (detailed) {
            try {
                const pages = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: FormFillCaptureDeveloperPage });
                await saveDeveloper({ status: 'extracted', extracted }, pages?.[0]?.result);
            } catch (error) { await saveDeveloper({ captureError: String(error) }); }
        }
        if (!extracted.fields.length) {
            lastAnalysis = FormFillDebug.analysis('no_fields');
            fillStatus.textContent = '対象の入力欄がありません。';
            return;
        }
        const result: AnalysisResult = await withTimeout(browser.runtime.sendMessage({ type: 'analyzeForm', tabID: tab.id,
            requestID: extracted.requestID, fields: extracted.fields, developerDiagnostics: detailed }));
        await saveDeveloper({ status: 'completed', response: result });
        const saved = { tabID: tab.id, origin: url.origin, requestID: extracted.requestID, sessionID: result.sessionID ?? '' };
        if (token !== generation) { if (saved.sessionID) cancel(saved); return; }
        if (result.error === 'model_unavailable') {
            lastAnalysis = FormFillDebug.analysis('model_unavailable', result);
            fillStatus.textContent = unavailableReasons[result.reason ?? 'unknown'] ?? unavailableReasons.unknown;
            return;
        }
        if (!result.ok || result.requestID !== extracted.requestID || !result.sessionID || !Array.isArray(result.classifications))
            throw new Error(result.error ?? 'analysis_failed');
        session = saved;
        document.querySelector<HTMLElement>('#site')!.textContent = `入力先: ${url.origin}`;
        rows('#plan', result.classifications, item => `${item.label}: ${item.kind === 'unknown' ? '判定できません' : '認証後に入力候補を確認'}`);
        preview.hidden = false;
        unlockButton.disabled = false;
        fillStatus.textContent = '入力先を確認して「登録情報を確認する」を押してください。まだ住所は読み出していません。';
        expiry = setTimeout(() => { clear(); fillStatus.textContent = errorMessages.stale_plan; }, 120000);
    } catch (error) {
        await saveDeveloper({ status: 'failed', error: String(error) });
        if (token === generation) { lastAnalysis = FormFillDebug.analysis('failed'); fail(error); }
    } finally { if (token === generation || !session) analyzeButton.disabled = false; }
});
unlockButton.addEventListener('click', async () => {
    const saved = session;
    if (!saved) return;
    const token = generation;
    unlockButton.disabled = true;
    analyzeButton.disabled = true;
    fillStatus.textContent = '認証して登録情報を読み出しています…';
    try {
        const result = await withTimeout(browser.runtime.sendMessage({ type: 'prepareFill', ...saved }));
        await recordPhase(saved, 'prepare', { ok: result.ok, error: result.error,
            items: result.items?.map((item: { id: string; kind?: string }) => ({ id: item.id, kind: item.kind })), skipped: result.skipped });
        if (token !== generation) return;
        if (!result.ok || !Array.isArray(result.items) || !Array.isArray(result.skipped)) throw new Error(result.error ?? 'invalid_response');
        lastAnalysis = FormFillDebug.analysis('success', result); // allowlisted summary, never retains values
        rows('#plan', result.items, item => `${item.label} → ${item.displayValue}${item.overwritesExisting ? '（既存値を上書き）' : ''}`);
        rows('#skipped', result.skipped, item => `${item.label}: ${item.reason}`);
        fillButton.disabled = result.items.length === 0;
        unlockButton.hidden = true;
        fillStatus.textContent = `${result.items.length}欄を入力予定。入力した瞬間からサイトは値を読み取れます。入力時にも認証します。`;
        clearTimeout(expiry);
        expiry = setTimeout(() => { clear(); fillStatus.textContent = errorMessages.stale_plan; }, 60000);
    } catch (error) { await recordPhase(saved, 'error', String(error)); if (token === generation) fail(error); }
    finally { analyzeButton.disabled = false; }
});
fillButton.addEventListener('click', async () => {
    const saved = session;
    if (!saved || fillButton.disabled) return;
    const token = generation;
    fillButton.disabled = true;
    analyzeButton.disabled = true;
    rows('#plan', [], () => '');
    rows('#skipped', [], () => '');
    fillStatus.textContent = '認証と入力先を再確認しています…';
    try {
        const result = await withTimeout(browser.runtime.sendMessage({ type: 'commitFill', ...saved }));
        await recordPhase(saved, 'commit', result);
        if (token !== generation) return;
        if (!result.ok || !Array.isArray(result.results)) throw new Error(result.error ?? 'stale_plan');
        const filled = result.results.filter(item => item.status === 'filled').length;
        clear();
        fillStatus.textContent = `${filled}欄に入力しました。${result.results.length - filled}欄は保留しました。ページ上の値を確認してください。フォームは送信していません。`;
    } catch (error) { await recordPhase(saved, 'error', String(error)); if (token === generation) fail(error); }
    finally { analyzeButton.disabled = false; }
});
window.addEventListener('pagehide', clear);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clear();
});
installDebug(() => ({ analysis: lastAnalysis, requestID: debugRequestID, fields: debugFields, analysisURL: debugAnalysisURL }));
