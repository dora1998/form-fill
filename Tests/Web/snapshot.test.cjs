const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotSession } = require('./load-source.cjs')('content/snapshot.ts');
test('snapshot IDs resolve only against the selected snapshot and are consumed once', () => {
  const firstGroup = {}, secondGroup = {};
  let now = 0, url = 'https://fixture.example/form', visible = true, valid = true;
  const session = createSnapshotSession({ url: () => url, visible: () => visible, now: () => now, validate: () => valid });
  const snapshot = { requestID: 'selected', url, all: [firstGroup, secondGroup], entries: [{ element: secondGroup, field: { id: 'f0' }, initialValue: '' }] };
  session.create(snapshot);
  assert.equal(session.fieldID('selected', firstGroup), null);
  assert.equal(session.fieldID('selected', secondGroup), 'f0');
  assert.equal(session.fieldID('previous', secondGroup), null);
  session.discard('previous'); assert.equal(session.matches('selected'), true);
  assert.equal(session.take(), snapshot); assert.equal(session.take(), undefined);
  for (const change of [() => now = 180_000, () => url += '/other', () => visible = false, () => valid = false]) {
    now = 0; url = snapshot.url; visible = true; valid = true;
    session.create(snapshot); change(); assert.equal(session.take(), undefined);
  }
});
