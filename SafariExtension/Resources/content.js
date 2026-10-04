(() => {
  // Loaded on explicit user action. Do not read values, labels, or page contents yet.
  if (globalThis.__formFillDiagnosticsInstalled) return;
  globalThis.__formFillDiagnosticsInstalled = true;
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || message?.type !== "inspect") return;
    const fields = [...document.querySelectorAll("input, select, textarea")].filter(element => {
      const type = (element.type || "").toLowerCase();
      const visibility = getComputedStyle(element).visibility;
      return !element.matches(":disabled") && !element.readOnly && !["hidden", "password", "submit", "button", "reset", "file", "checkbox", "radio", "image"].includes(type)
        && !["hidden", "collapse"].includes(visibility)
        && element.getClientRects().length > 0;
    });
    return Promise.resolve({ version: 1, fieldCount: fields.length });
  });
})();
