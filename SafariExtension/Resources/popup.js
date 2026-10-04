const button = document.querySelector("#check");
const status = document.querySelector("#status");
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
    status.textContent = `ネイティブ連携OK。対象の入力欄は${result.fieldCount}個です。自動入力は未実装です。`;
  } catch {
    status.textContent = "確認できませんでした。通常のWebページを開き、Safariでこのサイトへの拡張のアクセスを許可してください。改善しない場合は拡張を有効にし直してください。";
  } finally {
    button.disabled = false;
  }
});
