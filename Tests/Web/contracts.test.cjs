const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAnalyzeRequest, decodeAnalyzeResponse, decodePrepareResponse, decodeFillResponse } = require('./load-source.cjs')('shared/decode.ts');
for (const fixture of require('../Contracts/analyze-requests.json')) {
  test(`shared native/JS analyze contract: ${fixture.name}`, () => assert.equal(isAnalyzeRequest(fixture.request), fixture.valid));
}
test('response decoder distinguishes analysis, authenticated plan and failure', () => {
  const plan = { version: 1, ok: true, requestID: 'request', sessionID: 'session', items: [{ id: 'f0', value: '合成姓', displayValue: '合成姓', label: '姓' }], skipped: [] };
  assert.equal(decodePrepareResponse(plan).ok, true);
  assert.equal(decodeAnalyzeResponse(plan).error, 'invalid_response');
  assert.equal(decodePrepareResponse({ ...plan, version: 2 }).error, 'invalid_response');
  assert.equal(decodePrepareResponse({ ...plan, items: [{ id: 'f0', value: 7 }] }).error, 'invalid_response');
  assert.deepEqual(decodeAnalyzeResponse({ version: 1, ok: false, error: 'authentication_failed', value: 'private' }),
    { version: 1, ok: false, error: 'authentication_failed' });
});

test('page fill response decoder keeps only statuses and rejects malformed statuses', () => {
  assert.deepEqual(decodeFillResponse({ version: 1, ok: true, items: [{ value: 'private' }], results: [{ id: 'f0', status: 'filled', value: 'private' }] }),
    { version: 1, ok: true, results: [{ id: 'f0', status: 'filled' }] });
  assert.equal(decodeFillResponse({ version: 1, ok: true, results: [{ id: 'f0', status: ['filled'] }] }).error, 'invalid_response');
});
