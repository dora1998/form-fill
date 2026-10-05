const button = document.querySelector("#check");
const status = document.querySelector("#status");
const modelButton = document.querySelector("#check-model");
const modelStatus = document.querySelector("#model-status");
button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "確認中…";
  try {
    const native = await browser.runtime.sendMessage({ type: "health" });
    if (native?.version !== 1 || native?.ok !== true) throw new Error("native_bridge");
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("no_tab");
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await browser.tabs.sendMessage(tab.id, { type: "inspect" });
    if (result?.version !== 1 || !Number.isInteger(result.fieldCount)) throw new Error("invalid_response");
    status.textContent = `ネイティブ連携OK。対象の入力欄は${result.fieldCount}個です。解析ボタンから自動入力を試せます。`;
  } catch {
    status.textContent = "確認できませんでした。通常のWebページを開き、Safariでこのサイトへの拡張のアクセスを許可してください。改善しない場合は拡張を有効にし直してください。";
  } finally {
    button.disabled = false;
  }
});

const unavailableReasons = {
  apple_intelligence_not_enabled: "Apple Intelligenceが無効です。設定を確認してください。",
  device_not_eligible: "この端末はApple Intelligenceに対応していません。",
  model_not_ready: "モデルがまだ準備できていません。ダウンロード完了後に再試行してください。",
  unknown: "モデルの利用可否を特定できませんでした。"
};

modelButton.addEventListener("click", async () => {
  modelButton.disabled = true;
  modelStatus.textContent = "拡張プロセスでモデルを確認中…";
  try {
    const result = await browser.runtime.sendMessage({ type: "modelProbe" });
    if (result?.version !== 1 || result?.ok !== true) throw new Error("model_probe");
    if (!result.available) {
      modelStatus.textContent = unavailableReasons[result.reason] ?? unavailableReasons.unknown;
      return;
    }
    if (result.process !== "safari_web_extension" || typeof result.result !== "string") {
      throw new Error("invalid_model_response");
    }
    modelStatus.textContent = `拡張プロセスから生成成功: ${result.result}`;
  } catch {
    modelStatus.textContent = "モデル呼び出しに失敗しました。拡張とネイティブ連携を確認してください。";
  } finally {
    modelButton.disabled = false;
  }
});

const analyzeButton = document.querySelector('#analyze');
const fillButton = document.querySelector('#fill');
const fillStatus = document.querySelector('#fill-status');
const preview = document.querySelector('#preview');
let activePlan;
let lastAnalysis = FormFillDebug.analysis('not_run');
let debugRequestID;
let debugFields = [];
let debugAnalysisURL;
const withTimeout = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 60000); })]); }
  finally { clearTimeout(timer); }
};
const showRows = (selector, rows, render) => {
  const list = document.querySelector(selector);
  list.replaceChildren();
  for (const row of rows) {
    const item = document.createElement('li');
    item.textContent = render(row); // Never render website/model strings as HTML.
    list.append(item);
  }
};
analyzeButton.addEventListener('click', async () => {
  lastAnalysis = FormFillDebug.analysis('running');
  debugRequestID = undefined;
  debugFields = [];
  debugAnalysisURL = undefined;
  activePlan = null;
  preview.hidden = true;
  fillButton.disabled = true;
  analyzeButton.disabled = true;
  fillStatus.textContent = '入力欄を解析中…';
  const detailed = document.querySelector('#developer-record')?.checked === true;
  let developerTabID;
  const saveDeveloper = async (analysis, page) => {
    if (!detailed || !developerTabID || !debugRequestID) return;
    try { await browser.tabs.sendMessage(developerTabID, { type: 'saveDeveloperAnalysis', requestID: debugRequestID, analysis, page }); }
    catch { /* A diagnostic write must not interrupt classification or filling. */ }
  };
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no_tab');
    developerTabID = tab.id;
    debugAnalysisURL = FormFillDebug.pageURL(tab.url).url;
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const extracted = await browser.tabs.sendMessage(tab.id, { type: 'extract', developerDiagnostics: detailed });
    if (extracted?.version !== 1 || !Array.isArray(extracted.fields)) throw new Error('invalid_response');
    debugRequestID = extracted.requestID;
    if (detailed) {
      try {
        const captures = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: FormFillCaptureDeveloperPage });
        await saveDeveloper({ status: 'running' }, captures?.[0]?.result);
      } catch (error) { await saveDeveloper({ status: 'running', captureError: String(error) }); }
    }
    debugFields = FormFillDebug.fieldMetadata(extracted.fields);
    if (!extracted.fields.length) { await saveDeveloper({ status: 'no_fields', extracted }); lastAnalysis = FormFillDebug.analysis('no_fields'); fillStatus.textContent = '対象の入力欄がありません。通常のinput・select・textareaが対象です。'; return; }
    const result = await withTimeout(browser.runtime.sendMessage({ type: 'analyzeForm', requestID: extracted.requestID, fields: extracted.fields, developerDiagnostics: detailed }));
    await saveDeveloper({ status: 'completed', extracted, response: result });
    if (result?.error === 'model_unavailable') { lastAnalysis = FormFillDebug.analysis('model_unavailable', result); fillStatus.textContent = unavailableReasons[result.reason] ?? unavailableReasons.unknown; return; }
    if (result?.version !== 1 || result.ok !== true || result.requestID !== extracted.requestID || !Array.isArray(result.items) || !Array.isArray(result.skipped)) throw new Error('analysis_failed');
    lastAnalysis = FormFillDebug.analysis('success', result);
    activePlan = { tabID: tab.id, requestID: result.requestID, items: result.items };
    document.querySelector('#site').textContent = `入力先: ${new URL(tab.url).hostname}`;
    showRows('#plan', result.items, item => `${item.label} → ${item.displayValue}${item.overwritesExisting ? '（既存の値を上書き）' : ''} (${item.source === 'rule' ? 'ルール' : 'モデル'})`);
    showRows('#skipped', result.skipped, item => `${item.label}: ${item.reason}`);
    preview.hidden = false;
    fillButton.disabled = result.items.length === 0;
    fillStatus.textContent = `${result.items.length}欄を入力予定、${result.skipped.length}欄を保留。${result.modelFailed ? 'モデル処理の一部に失敗しました。確実に判定した欄のみ表示します。' : ''}${extracted.truncated ? '先頭40欄のみ解析しました。' : ''}`;
  } catch (error) {
    try { await saveDeveloper({ status: error.message === 'timeout' ? 'timeout' : 'failed', error: String(error?.stack || error) }); } catch {}
    lastAnalysis = FormFillDebug.analysis(error.message === 'timeout' ? 'timeout' : 'failed');
    fillStatus.textContent = error.message === 'timeout' ? '解析が時間内に完了しませんでした。項目が少ないページで再試行してください。'
      : '解析できませんでした。Safariでこのサイトへの拡張のアクセスを許可し、再試行してください。';
  } finally { analyzeButton.disabled = false; }
});

const copyDebugButton = document.querySelector('#copy-debug');
const debugStatus = document.querySelector('#debug-status');
const debugOutput = document.querySelector('#debug-output');
copyDebugButton.addEventListener('click', async () => {
  copyDebugButton.disabled = true;
  debugOutput.hidden = true;
  debugOutput.value = '';
  debugStatus.textContent = 'デバッグ情報を準備中…';
  let page;
  // Capture the session result before awaiting page access.
  const analysis = lastAnalysis;
  const requestID = debugRequestID;
  const fields = debugFields;
  const analysisURL = debugAnalysisURL;
  let currentURL;
  let captureStatus = 'no_tab';
  let captureDiagnostics = {};
  try {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('no_tab');
      currentURL = FormFillDebug.pageURL(tab.url).url;
      captureStatus = 'injection_failed';
      const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: FormFillCapturePage, args: [requestID ?? null] });
      // No allFrames/frameIds target is specified: this is the top document.
      // Safari's top frame ID need not be Chrome's numeric zero.
      const first = Array.isArray(results) ? results[0] : undefined;
      page = first?.result;
      captureDiagnostics = { resultCount: Array.isArray(results) ? results.length : 0,
        resultType: page === null ? 'null' : Array.isArray(page) ? 'array' : typeof page,
        hasInjectionError: Boolean(first?.error), collectorError: page?.collectorError };
      captureStatus = page?.version === 1 && Array.isArray(page.fields) ? 'success' : 'invalid_response';
      if (captureStatus === 'invalid_response') page = undefined;
    } catch { /* Access failure is a fixed code, never an exception message. */ }
    const report = FormFillDebug.report(page, analysis, browser.runtime.getManifest().version, fields, captureStatus,
      { analysis: analysisURL, current: currentURL }, captureDiagnostics);
    const output = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(output);
      debugStatus.textContent = page?.version === 1 ? 'デバッグ情報をコピーしました。'
        : fields.length ? '現在のページ構造は取得できませんでしたが、解析時の情報をコピーしました。'
          : 'ページへのアクセスに失敗した状態をコピーしました。';
    } catch {
      debugOutput.value = output;
      debugOutput.hidden = false;
      debugOutput.focus();
      debugOutput.select();
      debugStatus.textContent = '自動コピーできませんでした。下のデバッグ情報を選択してコピーしてください。';
    }
  } catch { debugStatus.textContent = 'デバッグ情報を準備できませんでした。再試行してください。'; }
  finally { copyDebugButton.disabled = false; }
});
fillButton.addEventListener('click', async () => {
  const plan = activePlan;
  if (!plan) return;
  activePlan = null;
  fillButton.disabled = true;
  analyzeButton.disabled = true;
  fillStatus.textContent = 'ダミー情報を入力中…';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== plan.tabID) throw new Error('stale_plan');
    const result = await browser.tabs.sendMessage(plan.tabID, { type: 'applyFill', requestID: plan.requestID, items: plan.items.map(({ id, kind, value }) => ({ id, kind, value })) });
    if (result?.ok !== true || !Array.isArray(result.results)) throw new Error('stale_plan');
    const filled = result.results.filter(item => item.status === 'filled').length;
    fillStatus.textContent = `${filled}欄に入力しました。${result.results.length - filled}欄はサイト側の変更・制約などで保留しました。ページ上の値を確認してください。フォームは送信していません。`;
  } catch { fillStatus.textContent = 'フォームが変わったか、入力を実行できませんでした。ページを確認して再解析してください。'; }
  finally { analyzeButton.disabled = false; }
});
