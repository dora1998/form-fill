const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFillWorkflow } = require('./load-source.cjs')('popup/workflow.ts');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function harness(overrides = {}) {
  let now = 0, next = 0;
  const timers = new Map();
  const clock = {
    schedule(callback, milliseconds) { const id = ++next; timers.set(id, { callback, at: now + milliseconds }); return id; },
    cancel(id) { timers.delete(id); },
    advance(milliseconds) { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } }
  };
  const analyzed = { version: 1, ok: true, requestID: 'request', sessionID: 'session', classifications: [{ id: 'f0', label: '姓', kind: 'family', components: [], source: 'rule' }] };
  const prepared = { version: 1, ok: true, requestID: 'request', sessionID: 'session', items: [{ id: 'f0', label: '姓', value: '合成姓', displayValue: '合成姓' }], skipped: [] };
  const h = { states: [], cancels: [], discards: [], commits: [], closed: false, analyzed, prepared, clock };
  const ports = {
    activeTab: async () => ({ tabID: 5, url: 'https://fixture.example/form' }),
    extract: async () => ({ version: 1, requestID: 'request', fields: [{ id: 'f0' }], truncated: false }),
    analyze: async () => analyzed,
    prepare: async () => prepared,
    commit: async (session, quick) => { h.commits.push({ session, quick }); return { version: 1, ok: true, results: [{ id: 'f0', status: 'filled' }] }; },
    cancel: session => h.cancels.push(session), discard: (tabID, requestID) => h.discards.push({ tabID, requestID }),
    close: () => { h.closed = true; }, clock,
    diagnostics: { start() {}, extracted: async () => {}, analyzed() {}, prepared() {}, failed() {}, record: async () => {} },
    ...overrides
  };
  h.ports = ports;
  h.workflow = createFillWorkflow(ports, state => h.states.push(state));
  return h;
}
test('manual workflow requires preview before commit and ignores duplicate commit', async () => {
  const waiting = deferred();
  const h = harness();
  await h.workflow.analyze();
  assert.equal(h.workflow.state().phase, 'analyzed');
  await h.workflow.fill();
  assert.equal(h.commits.length, 0);
  await h.workflow.unlock();
  assert.equal(h.workflow.state().phase, 'prepared');
  h.ports.commit = async (session, quick) => { h.commits.push({ session, quick }); return waiting.promise; };
  const filling = h.workflow.fill();
  await h.workflow.fill();
  assert.equal(h.commits.length, 1);
  waiting.resolve({ ok: true, results: [{ id: 'f0', status: 'filled' }] });
  await filling;
  assert.deepEqual(h.workflow.state(), { phase: 'completed', filled: 1, total: 1 });
  assert.equal(h.closed, false);
  assert.equal(h.discards.length, 1);
});
test('cancelled quick analysis revokes the late native session without committing', async () => {
  const pending = deferred();
  const h = harness({ analyze: () => pending.promise });
  const running = h.workflow.analyze({ quickStart: { tabID: 5, url: 'https://fixture.example/form' } });
  await flush(); h.workflow.cancel(); pending.resolve(h.analyzed); await running;
  assert.equal(h.workflow.state().phase, 'idle');
  assert.equal(h.cancels.length, 1);
  assert.equal(h.commits.length, 0);
  assert.equal(h.discards.length, 1);
});
test('timeout remains failed and revokes an analysis session arriving later', async () => {
  const pending = deferred();
  const h = harness({ analyze: () => pending.promise });
  const running = h.workflow.analyze();
  await flush(); h.clock.advance(60_000); await running;
  assert.deepEqual(h.workflow.state(), { phase: 'failed', error: 'timeout', reason: undefined });
  pending.resolve(h.analyzed); await flush();
  assert.equal(h.cancels.length, 1);
  assert.equal(h.workflow.state().phase, 'failed');
});
test('expiry during authentication invalidates the session; a late prepare cannot revive it', async () => {
  const pending = deferred();
  const h = harness({ prepare: () => pending.promise });
  await h.workflow.analyze();
  const unlocking = h.workflow.unlock();
  h.clock.advance(120_000); await flush();
  pending.resolve(h.prepared); await unlocking;
  assert.equal(h.workflow.state().phase, 'failed');
  assert.equal(h.workflow.state().error, 'stale_plan');
  assert.equal(h.cancels.length, 1);
  await h.workflow.fill(); assert.equal(h.commits.length, 0);
});
test('a cancelled prepare cannot change a newer analysis state', async () => {
  const pending = deferred();
  const h = harness({ prepare: () => pending.promise });
  await h.workflow.analyze(); const unlocking = h.workflow.unlock();
  h.workflow.cancel(); await h.workflow.analyze();
  pending.resolve(h.prepared); await unlocking;
  assert.equal(h.workflow.state().phase, 'analyzed');
});
test('group choice preserves its selection snapshot and sends its request ID', async () => {
  const selections = [];
  const h = harness({ extract: async (tab, options) => {
    selections.push(options);
    return { version: 1, requestID: 'request', fields: [{ id: 'f0', groupID: options.groupID ?? 'g0' }],
      groups: [{ id: 'g0', label: '配送先', fields: ['姓'] }, { id: 'g1', label: '請求先', fields: ['姓2'] }] };
  } });
  await h.workflow.analyze(); assert.equal(h.workflow.state().phase, 'selecting');
  await h.workflow.analyze({ groupID: 'g1' });
  assert.equal(selections[1].selectionRequestID, 'request');
  assert.equal(h.discards.length, 0);
  assert.equal(h.workflow.state().destination, 'https://fixture.example / 請求先');
});
test('quick fill closes only after successful input; authentication failures cancel', async () => {
  const options = { quickStart: { tabID: 5, url: 'https://fixture.example/form' } };
  const good = harness(); await good.workflow.analyze(options);
  assert.equal(good.commits[0].quick, true); assert.equal(good.closed, true);
  const denied = harness({ commit: async () => ({ version: 1, ok: false, error: 'authentication_failed' }) });
  await denied.workflow.analyze(options);
  assert.equal(denied.workflow.state().error, 'authentication_failed');
  assert.equal(denied.closed, false); assert.equal(denied.cancels.length, 1);
});

test('detailed log collection analyzes all groups then revokes the session without authenticating or filling', async () => {
  const h = harness({
    extract: async (_, options) => {
      assert.equal(options.detailed, true);
      return { version: 1, requestID: 'request', fields: [{ id: 'f0' }], truncated: false,
        groups: [{ id: 'g0', label: '配送先', fields: ['姓'] }, { id: 'g1', label: '請求先', fields: ['姓2'] }] };
    },
    prepare: async () => { throw Error('detailed collection must not authenticate'); }
  });
  await h.workflow.analyze({ detailed: true });
  assert.equal(h.workflow.state().phase, 'diagnostics_collected');
  assert.equal(h.states.some(state => state.phase === 'selecting'), false);
  assert.equal(h.cancels.length, 1);
  assert.equal(h.discards.length, 1);
  await h.workflow.unlock(); await h.workflow.fill();
  assert.equal(h.commits.length, 0);
  assert.equal(h.closed, false);
});

for (const action of ['cancel', 'reanalyze']) {
  test(`${action} while diagnostics are pending revokes the native session and ignores the old completion`, async () => {
    const recording = deferred();
    let startedRecording = false;
    const h = harness();
    h.ports.diagnostics.record = async saved => {
      if (saved.sessionID === 'session') { startedRecording = true; await recording.promise; }
    };
    const first = h.workflow.analyze();
    await flush(); assert.equal(startedRecording, true);
    if (action === 'cancel') h.workflow.cancel();
    else {
      h.ports.analyze = async () => ({ ...h.analyzed, sessionID: 'new-session' });
      await h.workflow.analyze();
    }
    assert.deepEqual(h.cancels.map(session => session.sessionID), ['session']);
    recording.resolve(); await first;
    assert.equal(h.workflow.state().phase, action === 'cancel' ? 'idle' : 'analyzed');
    if (action === 'reanalyze') assert.equal(h.workflow.state().session.sessionID, 'new-session');
    assert.deepEqual(h.cancels.map(session => session.sessionID), ['session']);
    assert.equal(h.commits.length, 0);
  });
}
test('failed native analysis is retained in detailed diagnostics', async () => {
  const failure = { version: 1, ok: false, error: 'model_unavailable', reason: 'model_not_ready' };
  const recorded = [];
  const h = harness({ analyze: async () => failure });
  h.ports.diagnostics.record = async (session, phase, result) => { recorded.push({ phase, result }); };
  await h.workflow.analyze({ detailed: true });
  assert.deepEqual(recorded, [{ phase: 'response', result: failure }]);
  assert.equal(h.workflow.state().error, 'model_unavailable');
});
