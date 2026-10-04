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
  activePlan = null;
  preview.hidden = true;
  fillButton.disabled = true;
  analyzeButton.disabled = true;
  fillStatus.textContent = '入力欄を解析中…';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no_tab');
    await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    const extracted = await browser.tabs.sendMessage(tab.id, { type: 'extract' });
    if (extracted?.version !== 1 || !Array.isArray(extracted.fields)) throw new Error('invalid_response');
    if (!extracted.fields.length) { fillStatus.textContent = '対象の入力欄がありません。通常のinput・select・textareaが対象です。'; return; }
    const result = await withTimeout(browser.runtime.sendMessage({ type: 'analyzeForm', requestID: extracted.requestID, fields: extracted.fields }));
    if (result?.error === 'model_unavailable') { fillStatus.textContent = unavailableReasons[result.reason] ?? unavailableReasons.unknown; return; }
    if (result?.version !== 1 || result.ok !== true || result.requestID !== extracted.requestID || !Array.isArray(result.items) || !Array.isArray(result.skipped)) throw new Error('analysis_failed');
    activePlan = { tabID: tab.id, requestID: result.requestID, items: result.items };
    document.querySelector('#site').textContent = `入力先: ${new URL(tab.url).hostname}`;
    showRows('#plan', result.items, item => `${item.label} → ${item.displayValue} (${item.source === 'rule' ? 'ルール' : 'モデル'})`);
    showRows('#skipped', result.skipped, item => `${item.label}: ${item.reason}`);
    preview.hidden = false;
    fillButton.disabled = result.items.length === 0;
    fillStatus.textContent = `${result.items.length}欄を入力予定、${result.skipped.length}欄を保留。${result.modelFailed ? 'モデル処理の一部に失敗しました。確実に判定した欄のみ表示します。' : ''}${extracted.truncated ? '先頭40欄のみ解析しました。' : ''}`;
  } catch (error) {
    fillStatus.textContent = error.message === 'timeout' ? '解析が時間内に完了しませんでした。項目が少ないページで再試行してください。'
      : '解析できませんでした。Safariでこのサイトへの拡張のアクセスを許可し、再試行してください。';
  } finally { analyzeButton.disabled = false; }
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
