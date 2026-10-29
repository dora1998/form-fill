import { unavailableReasons } from '../shared/model-status';
type BrowserAPI = typeof browser;
export function installHealth(document: Document, browser: BrowserAPI) {
    const button = document.querySelector<HTMLButtonElement>("#check")!;
    const status = document.querySelector<HTMLElement>("#status")!;
    const modelButton = document.querySelector<HTMLButtonElement>("#check-model")!;
    const modelStatus = document.querySelector<HTMLElement>("#model-status")!;
    button.addEventListener("click", async () => {
        button.disabled = true;
        status.textContent = "確認中…";
        try {
            const native = await browser.runtime.sendMessage({ type: "health" });
            if (native?.version !== 1 || native?.ok !== true)
                throw new Error("native_bridge");
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id)
                throw new Error("no_tab");
            await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
            const result = await browser.tabs.sendMessage(tab.id, { type: "inspect" });
            if (result?.version !== 1 || !Number.isInteger(result.fieldCount))
                throw new Error("invalid_response");
            status.textContent = `ネイティブ連携OK。対象の入力欄は${result.fieldCount}個です。解析ボタンから自動入力を試せます。`;
        }
        catch {
            status.textContent = "確認できませんでした。通常のWebページを開き、Safariでこのサイトへの拡張のアクセスを許可してください。改善しない場合は拡張を有効にし直してください。";
        }
        finally {
            button.disabled = false;
        }
    });
    modelButton.addEventListener("click", async () => {
        modelButton.disabled = true;
        modelStatus.textContent = "拡張プロセスでモデルを確認中…";
        try {
            const result = await browser.runtime.sendMessage({ type: "modelProbe" });
            if (result?.version !== 1 || result?.ok !== true)
                throw new Error("model_probe");
            if (!result.available) {
                modelStatus.textContent = unavailableReasons[result.reason ?? 'unknown'] ?? unavailableReasons.unknown;
                return;
            }
            if (result.process !== "safari_web_extension" || typeof result.result !== "string") {
                throw new Error("invalid_model_response");
            }
            modelStatus.textContent = `拡張プロセスから生成成功: ${result.result}`;
        }
        catch {
            modelStatus.textContent = "モデル呼び出しに失敗しました。拡張とネイティブ連携を確認してください。";
        }
        finally {
            modelButton.disabled = false;
        }
    });

}
