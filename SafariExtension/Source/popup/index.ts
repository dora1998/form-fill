import { installDebug } from './debug';
import { installDeveloper } from './developer';
import type { AnalysisResult, Extraction, DiagnosticRecord } from '../shared/contracts';
import './health';
import { unavailableReasons } from '../shared/model-status';
const analyzeButton = document.querySelector<HTMLButtonElement>('#analyze')!;
const unlockButton = document.querySelector<HTMLButtonElement>('#unlock')!;
const fillButton = document.querySelector<HTMLButtonElement>('#fill')!;
const fillStatus = document.querySelector<HTMLElement>('#fill-status')!;
const cancelQuickButton = document.querySelector<HTMLButtonElement>('#cancel-quick');
const targets = document.querySelector<HTMLElement>('#targets')!;
const targetGroup = document.querySelector<HTMLSelectElement>('#target-group')!;
const targetFields = document.querySelector<HTMLElement>('#target-fields')!;
let selectionContext: { tabID: number; url: string; requestID: string } | undefined;
let targetOptions: NonNullable<Extraction['groups']> = [];
const preview = document.querySelector<HTMLElement>('#preview')!;
type Session = { tabID: number; origin: string; requestID: string; sessionID: string };
const progress = document.querySelector<HTMLElement>('#progress')!;
const progressTitle = document.querySelector<HTMLElement>('#progress-title')!;
const progressDetail = document.querySelector<HTMLElement>('#progress-detail')!;
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
    document.body.dataset.mode = 'ready';
    progress.hidden = true;
    analyzeButton.disabled = false;
    clearTimeout(expiry);
    if (session) cancel(session);
    session = null;
    preview.hidden = true;
    targets.hidden = true;
    selectionContext = undefined;
    unlockButton.hidden = false;
    unlockButton.disabled = true;
    fillButton.disabled = true;
    fillButton.hidden = false;
    if (cancelQuickButton) cancelQuickButton.hidden = true;
    rows('#plan', [], () => '');
    rows('#skipped', [], () => '');
};
const fail = (error: unknown) => {
    clear();
    fillStatus.textContent = errorMessages[error instanceof Error ? error.message : '']
        ?? '処理できませんでした。Safariのサイトアクセス許可を確認して再試行してください。';
};
const analyze = async (quickStart?: { tabID: number; url: string }, selectedGroup?: string, detailed = false) => {
    const selectedContext = selectedGroup ? selectionContext : undefined;
    clear();
    const token = generation;
    if (quickStart) {
        document.body.dataset.mode = 'quick';
        progress.hidden = false;
        progressTitle.textContent = '入力欄を解析中';
        progressDetail.textContent = '解析後、認証して姓名・住所を入力します。';
        if (cancelQuickButton) cancelQuickButton.hidden = false;
    }
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
        if (selectedGroup && (!selectedContext || selectedContext.tabID !== tab.id || selectedContext.url !== tab.url)) throw new Error('stale_plan');
        if (quickStart && (tab.id !== quickStart.tabID || tab.url !== quickStart.url)) throw new Error('stale_plan');
        const url = new URL(tab.url);
        if (url.protocol !== 'https:') throw new Error('https_required');
        if (quickStart) {
            document.querySelector<HTMLElement>('#site')!.textContent = `入力先: ${url.origin}`;
            preview.hidden = false;
            unlockButton.hidden = true;
            fillButton.hidden = true;
            if (cancelQuickButton) cancelQuickButton.hidden = false;
            fillStatus.textContent = '';
        }
        developerTabID = tab.id;
        debugAnalysisURL = FormFillDebug.pageURL(tab.url).url;
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        const extracted: Extraction = await browser.tabs.sendMessage(tab.id, { type: 'extract', developerDiagnostics: detailed, groupID: selectedGroup, selectionRequestID: selectedContext?.requestID, inlineTarget: Boolean(quickStart) });
        if (token !== generation) return;
        if (!detailed && !quickStart && !selectedGroup && (extracted.groups?.length ?? 0) > 1) {
            selectionContext = { tabID: tab.id, url: tab.url, requestID: extracted.requestID };
            targetOptions = extracted.groups!;
            targetGroup.replaceChildren(...targetOptions.map(group => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.label;
                return option;
            }));
            targetFields.textContent = targetOptions[0].fields.join('・');
            targets.hidden = false;
            fillStatus.textContent = '入力するグループを選んでください。';
            return;
        }
        const activeGroup = (extracted.groups?.length ?? 0) > 1
            ? extracted.groups?.find(group => group.id === extracted.fields[0]?.groupID) : undefined;
        const destination = `${url.origin}${activeGroup ? ` / ${activeGroup.label}` : ''}`;
        document.querySelector<HTMLElement>('#site')!.textContent = `入力先: ${destination}`;
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
        if (detailed) {
            fillStatus.textContent = '詳細ログ用の解析が完了しました。';
            cancel(saved);
            return;
        }
        session = saved;
        if (quickStart) {
            progressTitle.textContent = '認証して入力中';
            progressDetail.textContent = 'Face IDまたは端末パスコードで認証してください。';
            fillStatus.textContent = '';
            const committed = await withTimeout(browser.runtime.sendMessage({ type: 'quickFill', ...saved }));
            await recordPhase(saved, 'commit', committed);
            if (token !== generation) return;
            if (!committed.ok || !Array.isArray(committed.results)) throw new Error(committed.error ?? 'stale_plan');
            const filled = committed.results.filter(item => item.status === 'filled').length;
            clear();
            fillStatus.textContent = `${filled}欄に入力しました。${committed.results.length - filled}欄は保留しました。ページ上の値を確認してください。フォームは送信していません。`;
            if (filled > 0) window.close();
            return;
        }
        rows('#plan', result.classifications, item => `${item.label}: ${item.kind === 'unknown' ? '判定できません' : '認証後に入力候補を確認'}`);
        preview.hidden = false;
        unlockButton.disabled = false;
        fillStatus.textContent = '入力先を確認して「登録情報を確認する」を押してください。まだ住所は読み出していません。';
        expiry = setTimeout(() => { clear(); fillStatus.textContent = errorMessages.stale_plan; }, 120000);
    } catch (error) {
        await saveDeveloper({ status: 'failed', error: String(error) });
        if (token === generation) { lastAnalysis = FormFillDebug.analysis('failed'); fail(error); }
    } finally {
        if (token === generation) {
            analyzeButton.disabled = false;
            document.body.dataset.mode = 'ready';
            progress.hidden = true;
            preview.hidden = quickStart ? true : preview.hidden;
            if (cancelQuickButton) cancelQuickButton.hidden = true;
        }
    }
};
analyzeButton.addEventListener('click', () => analyze());
targetGroup.addEventListener('change', () => {
    targetFields.textContent = targetOptions.find(group => group.id === targetGroup.value)?.fields.join('・') || '';
});
document.querySelector('#analyze-target')!.addEventListener('click', () => analyze(undefined, targetGroup.value));
cancelQuickButton?.addEventListener('click', () => { clear(); fillStatus.textContent = 'キャンセルしました。'; });
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
            items: result.items?.map(item => ({ id: item.id, kind: item.kind, components: item.components })), skipped: result.skipped });
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
installDeveloper(async () => {
    await analyze(undefined, undefined, true);
});
installDebug(() => ({ analysis: lastAnalysis, requestID: debugRequestID, fields: debugFields, analysisURL: debugAnalysisURL }));

// Consume a short-lived, tab/document-bound start only from the trusted popup.
// Opening the popup from Safari's menu keeps the ordinary preview flow.
void browser.runtime.sendMessage({ type: 'consumeInlineStart' }).then(start => {
    if (start?.ok && start.tabID != null && start.url) return analyze({ tabID: start.tabID, url: start.url });
}).catch(() => {}).finally(() => {
    if (document.body.dataset.mode === 'opening') {
        document.body.dataset.mode = 'ready';
        progress.hidden = true;
    }
});
