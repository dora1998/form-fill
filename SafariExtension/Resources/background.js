/* Safari delivers native messages to the containing app's web extension handler. */
browser.runtime.onMessage.addListener((message, sender) => {
  // Content scripts/websites cannot use this diagnostic entrypoint.
  if (sender.tab || sender.id !== browser.runtime.id || !["health", "modelProbe"].includes(message?.type)) {
    return Promise.resolve({ version: 1, ok: false, error: "unsupported_request" });
  }
  return browser.runtime.sendNativeMessage("dev.formfill.app.extension", {
    version: 1,
    type: message.type
  });
});
