const developerButton = document.querySelector('#copy-developer');
const developerStatus = document.querySelector('#developer-status');
const developerOutput = document.querySelector('#developer-output');
developerButton.addEventListener('click', async () => {
  developerButton.disabled = true;
  developerOutput.hidden = true;
  developerOutput.value = '';
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
    // Populate the fallback before awaiting clipboard permission on Safari.
    developerOutput.value = output;
    try {
      await navigator.clipboard.writeText(output);
      developerStatus.textContent = `開発用データをコピーしました。${note}`;
      developerOutput.value = '';
    } catch {
      developerOutput.hidden = false;
      developerOutput.focus();
      developerOutput.select();
      developerStatus.textContent = `下の生データを選択してコピーしてください。${note}`;
    }
  } catch { developerStatus.textContent = '開発用データを作成できませんでした。'; }
  finally { developerButton.disabled = false; }
});
