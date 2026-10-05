/* Only the extension popup can request native classification. */
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab || sender.id !== browser.runtime.id || !['health', 'modelProbe', 'analyzeForm', 'saveDeveloperReport'].includes(message?.type)) {
    return Promise.resolve({ version: 1, ok: false, error: 'unsupported_request' });
  }
  const request = { version: 1, type: message.type };
  if (message.type === 'saveDeveloperReport') {
    if (typeof message.report !== 'string') {
      return Promise.resolve({ version: 1, ok: false, error: 'invalid_request' });
    }
    if (message.report.length > 20 * 1024 * 1024) {
      return Promise.resolve({ version: 1, ok: false, error: 'report_too_large' });
    }
    request.report = message.report;
  }
  if (message.type === 'analyzeForm') {
    if (typeof message.requestID !== 'string' || message.requestID.length > 80 || !Array.isArray(message.fields) || message.fields.length > 40) {
      return Promise.resolve({ version: 1, ok: false, error: 'invalid_request' });
    }
    request.requestID = message.requestID;
    if (message.developerDiagnostics === true) request.developerDiagnostics = true;
    request.fields = message.fields.map(field => Object.fromEntries(
      ['id', 'tag', 'type', 'label', 'ariaLabel', 'name', 'htmlID', 'placeholder', 'autocomplete', 'context', 'maxLength', 'pattern', 'occupied', 'options'].map(key => [key, field[key]])
    ));
  }
  return browser.runtime.sendNativeMessage('dev.formfill.app.extension', request);
});
