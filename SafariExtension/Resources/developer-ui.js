const saveDeveloperButton = document.querySelector('#save-developer');
const developerStatus = document.querySelector('#developer-status');
saveDeveloperButton.addEventListener('click', async () => {
  saveDeveloperButton.disabled = true;
  developerStatus.textContent = '開発用データを収集中…';
  const report = { schemaVersion: 1, product: 'Form Fill developer diagnostics',
    extensionVersion: browser.runtime.getManifest().version, capturedAt: new Date().toISOString() };
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    report.currentPageURL = tab?.url;
    if (!tab?.id) throw Error('no_tab');
    const results = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: FormFillCaptureDeveloperPage });
    report.page = results?.[0]?.result;
    report.captureErrors = results?.filter(result => result.error).map(result => String(result.error));
    report.captureStatus = report.page?.version === 1 ? 'success' : 'invalid_response';
  } catch (error) {
    report.captureStatus = 'failed';
    report.error = String(error?.stack || error);
  }
  try {
    const output = JSON.stringify(report, null, 2);
    const note = report.captureStatus !== 'success' ? 'ページの取得に失敗した記録です。'
      : report.page.lastRun ? '解析・入力の直近記録を含みます。' : '詳細解析の記録はありません。現在のDOMのみ収録しました。';
    const result = await browser.runtime.sendMessage({ type: 'saveDeveloperReport', report: output });
    if (result?.version !== 1 || result.ok !== true) {
      developerStatus.textContent = result?.error === 'report_too_large'
        ? 'データが20 MiBを超えるため保存できませんでした。入力欄の少ないページで再試行してください。'
        : 'アプリに保存できませんでした。アプリと拡張のApp Groups設定・端末の空き容量を確認して再試行してください。';
      return;
    }
    developerStatus.textContent = `アプリに保存しました。Form Fillアプリの「保存したデバッグログ」からファイルに保存・共有・削除できます。${note}`;
  } catch { developerStatus.textContent = '開発用データの作成・アプリへの保存に失敗しました。再試行してください。'; }
  finally { saveDeveloperButton.disabled = false; }
});
