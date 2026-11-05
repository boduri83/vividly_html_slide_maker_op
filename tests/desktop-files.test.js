import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteDocument, DesktopFileService, suggestedFilename } from '../desktop/files.mjs';

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'html-slide-file-test-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert.match(path.basename(resolved), /^html-slide-file-test-/);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function bind(service, file, sessionId) {
  service.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  const opened = await service.openDocument();
  service.adoptDocument({ openToken: opened.openToken, sessionId });
  return opened;
}

test('atomic save writes UTF-8 and replaces existing target without leaving a temp file', async t => {
  const directory = await fixture(t), target = path.join(directory, '자료.html');
  await atomicWriteDocument(target, '첫 저장 한글');
  await atomicWriteDocument(target, '두 번째 저장\n<article>보존</article>');
  assert.equal(await fs.readFile(target, 'utf8'), '두 번째 저장\n<article>보존</article>');
  assert.deepEqual(await fs.readdir(directory), ['자료.html']);
});

test('rename failure keeps original bytes and removes only the owned temp', async t => {
  const directory = await fixture(t), target = path.join(directory, 'original.html');
  await fs.writeFile(target, 'ORIGINAL');
  const io = { ...fs, rename: async () => { throw Object.assign(new Error('locked target'), { code: 'EACCES' }); } };
  const delays = [];
  await assert.rejects(atomicWriteDocument(target, 'REPLACEMENT', { io, wait: async delay => delays.push(delay) }), /locked target/);
  assert.equal(delays.length, 5);
  assert.ok(delays.reduce((sum, delay) => sum + delay, 0) < 2000);
  assert.equal(await fs.readFile(target, 'utf8'), 'ORIGINAL');
  assert.deepEqual(await fs.readdir(directory), ['original.html']);
});

test('transient Windows rename locks retry without removing the original file', async t => {
  const directory = await fixture(t);
  for (const code of ['EINTR', 'EPERM', 'EACCES', 'EBUSY']) {
    const target = path.join(directory, `${code}.html`);
    await fs.writeFile(target, 'ORIGINAL');
    let attempts = 0;
    const delays = [], deleted = [];
    const io = { ...fs, rename: async (temporary, destination) => {
      attempts++;
      assert.equal(await fs.readFile(destination, 'utf8'), 'ORIGINAL');
      if (attempts < 3) throw Object.assign(new Error('temporary lock'), { code });
      await fs.rename(temporary, destination);
    }, unlink: async file => { deleted.push(file); await fs.unlink(file); } };
    await atomicWriteDocument(target, 'REPLACEMENT', { io, wait: async delay => delays.push(delay) });
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [20, 50]);
    assert.deepEqual(deleted, []);
    assert.equal(await fs.readFile(target, 'utf8'), 'REPLACEMENT');
  }
});

test('non-transient rename errors stop immediately and preserve the target', async t => {
  const directory = await fixture(t), target = path.join(directory, 'original.html');
  await fs.writeFile(target, 'ORIGINAL');
  let attempts = 0, waits = 0;
  const io = { ...fs, rename: async () => { attempts++; throw Object.assign(new Error('not retryable'), { code: 'ENOSPC' }); } };
  await assert.rejects(atomicWriteDocument(target, 'REPLACEMENT', { io, wait: async () => { waits++; } }), /not retryable/);
  assert.equal(attempts, 1); assert.equal(waits, 0);
  assert.equal(await fs.readFile(target, 'utf8'), 'ORIGINAL');
  assert.deepEqual(await fs.readdir(directory), ['original.html']);
});

test('flush failure cannot replace an existing document', async t => {
  const directory = await fixture(t), target = path.join(directory, 'original.html');
  await fs.writeFile(target, 'ORIGINAL');
  const io = { ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(),
      sync: async () => { throw new Error('flush failed'); } };
  } };
  await assert.rejects(atomicWriteDocument(target, 'REPLACEMENT', { io }), /flush failed/);
  assert.equal(await fs.readFile(target, 'utf8'), 'ORIGINAL');
  assert.deepEqual(await fs.readdir(directory), ['original.html']);
});

test('cancelled first Save creates no binding or document', async t => {
  const directory = await fixture(t);
  const service = new DesktopFileService({ dialog: { showSaveDialog: async () => ({ canceled: true }) } });
  assert.deepEqual(await service.saveDocument({ html: 'data', sessionId: 'session-new', title: '새 자료' }), { confirmed: false, canceled: true });
  assert.equal(service.targets.size, 0);
  assert.equal(service.busy, false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('open returns data and binds Save only after an explicitly adopted token', async t => {
  const directory = await fixture(t), target = path.join(directory, 'opened.html');
  const contents = '<script>notExecuted()</script>한글';
  await fs.writeFile(target, contents);
  let saves = 0;
  const service = new DesktopFileService({ dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [target] }),
    showSaveDialog: async () => { saves++; throw new Error('unneeded save dialog'); },
  } });
  const opened = await service.openDocument();
  assert.equal(opened.contents, contents);
  assert.equal(service.targets.size, 0);
  const adopted = service.adoptDocument({ openToken: opened.openToken, sessionId: 'opened' });
  assert.equal(adopted.hasSaveTarget, true);
  assert.throws(() => service.adoptDocument({ openToken: opened.openToken, sessionId: 'other' }), /만료/);
  const saved = await service.saveDocument({ html: '수정한 자료', sessionId: 'opened', title: '자료' });
  assert.equal(saved.confirmed, true);
  assert.equal(saves, 0);
  assert.equal(await fs.readFile(target, 'utf8'), '수정한 자료');
});

test('failed Save As preserves the previous Save target', async t => {
  const directory = await fixture(t), original = path.join(directory, 'original.html'), alternative = path.join(directory, 'other.html');
  await fs.writeFile(original, 'ORIGINAL');
  const service = new DesktopFileService({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: alternative }) },
    write: async (filePath, text) => { if (filePath === alternative) throw new Error('write denied'); await atomicWriteDocument(filePath, text); } });
  await bind(service, original, 'session-a');
  await assert.rejects(service.saveDocument({ html: 'FAILED', sessionId: 'session-a', title: '자료', saveAs: true }), /write denied/);
  assert.equal(service.targets.get('session-a'), original);
  await service.saveDocument({ html: 'LATER', sessionId: 'session-a', title: '자료' });
  assert.equal(await fs.readFile(original, 'utf8'), 'LATER');
  await assert.rejects(fs.access(alternative));
});

test('cancelled Save As preserves target and original bytes', async t => {
  const directory = await fixture(t), original = path.join(directory, 'original.html');
  await fs.writeFile(original, 'ORIGINAL');
  const service = new DesktopFileService({ dialog: { showSaveDialog: async () => ({ canceled: true }) } });
  await bind(service, original, 'session-a');
  const result = await service.saveDocument({ html: 'CANCELLED', sessionId: 'session-a', title: '자료', saveAs: true });
  assert.equal(result.confirmed, false);
  assert.equal(service.targets.get('session-a'), original);
  assert.equal(await fs.readFile(original, 'utf8'), 'ORIGINAL');
});

test('two initial saves in one session choose once and write in request order', async t => {
  const directory = await fixture(t), target = path.join(directory, 'queued.html');
  const started = deferred(), release = deferred();
  let dialogs = 0;
  const order = [];
  const service = new DesktopFileService({ dialog: { showSaveDialog: async () => { dialogs++; return { canceled: false, filePath: target }; } },
    write: async (filePath, text) => {
      order.push(text);
      if (text === 'A') { started.resolve(); await release.promise; }
      await atomicWriteDocument(filePath, text);
    } });
  const first = service.saveDocument({ html: 'A', sessionId: 'same-session', title: '자료' });
  await started.promise;
  const second = service.saveDocument({ html: 'B', sessionId: 'same-session', title: '자료' });
  assert.equal(service.busy, true);
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['A', 'B']);
  assert.equal(dialogs, 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'B');
  assert.equal(service.busy, false);
});

test('different sessions bound to the same file cannot race their writes', async t => {
  const directory = await fixture(t), target = path.join(directory, 'shared.html');
  await fs.writeFile(target, 'ORIGINAL');
  const started = deferred(), release = deferred(), order = [];
  const service = new DesktopFileService({ dialog: {}, write: async (filePath, text) => {
    order.push(`start-${text}`);
    if (text === 'A') { started.resolve(); await release.promise; }
    await atomicWriteDocument(filePath, text);
    order.push(`end-${text}`);
  } });
  await bind(service, target, 'one');
  await bind(service, target, 'two');
  const first = service.saveDocument({ html: 'A', sessionId: 'one', title: '자료' });
  await started.promise;
  const second = service.saveDocument({ html: 'B', sessionId: 'two', title: '자료' });
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start-A', 'end-A', 'start-B', 'end-B']);
  assert.equal(await fs.readFile(target, 'utf8'), 'B');
});

test('oversized and malformed UTF-8 opens never yield adoptable tokens', async t => {
  const directory = await fixture(t), target = path.join(directory, 'bad.html');
  const service = new DesktopFileService({ maxBytes: 8, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [target] }) } });
  await fs.writeFile(target, '0123456789');
  await assert.rejects(service.openDocument(), /100MB/);
  await fs.writeFile(target, Buffer.from([0xC0, 0xAF]));
  await assert.rejects(service.openDocument(), /encoded data|encoding/i);
  assert.equal(service.pendingOpen.size, 0);
  assert.equal(service.busy, false);
});

test('a slow older open cannot replace a later selection or its token', async t => {
  const directory = await fixture(t), older = path.join(directory, 'older.html'), newer = path.join(directory, 'newer.html');
  await fs.writeFile(older, 'OLDER'); await fs.writeFile(newer, 'NEWER');
  const started = deferred(), release = deferred(), paths = [older, newer];
  const service = new DesktopFileService({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [paths.shift()] }) },
    io: { ...fs, readFile: async file => { if (file === older) { started.resolve(); await release.promise; } return fs.readFile(file); } } });
  const first = service.openDocument();
  await started.promise;
  const second = await service.openDocument();
  release.resolve();
  assert.deepEqual(await first, { canceled: true });
  assert.equal(second.contents, 'NEWER');
  service.adoptDocument({ openToken: second.openToken, sessionId: 'latest' });
  assert.equal(service.targets.get('latest'), newer);
});

test('JSON sample import forces an HTML save target and preserves its JSON source', async t => {
  const directory = await fixture(t), original = path.join(directory, 'sample.json'), exported = path.join(directory, 'sample.html');
  await fs.writeFile(original, '{"sample":true}');
  let dialogs = 0;
  const service = new DesktopFileService({ dialog: { showSaveDialog: async () => { dialogs++; return { canceled: false, filePath: exported }; } } });
  const opened = await bind(service, original, 'json-import');
  assert.equal(opened.contents, '{"sample":true}');
  assert.equal(service.targets.has('json-import'), false);
  await service.saveDocument({ html: '<html>편집 자료</html>', sessionId: 'json-import', title: '샘플' });
  assert.equal(dialogs, 1);
  assert.equal(await fs.readFile(original, 'utf8'), '{"sample":true}');
  assert.equal(await fs.readFile(exported, 'utf8'), '<html>편집 자료</html>');
});

test('renderer-provided path fields have no authority over the selected path', async t => {
  const directory = await fixture(t), chosen = path.join(directory, 'chosen.html'), ignored = path.join(directory, 'ignored.html');
  const service = new DesktopFileService({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: chosen }) } });
  await service.saveDocument({ html: 'CONTENT', sessionId: 'session', title: '자료', filePath: ignored, path: ignored });
  assert.equal(await fs.readFile(chosen, 'utf8'), 'CONTENT');
  await assert.rejects(fs.access(ignored));
  await assert.rejects(service.saveDocument({ html: 'CONTENT', sessionId: '', title: '자료' }), /세션/);
});

test('suggested filename handles Windows reserved names and path characters', () => {
  assert.equal(suggestedFilename('CON'), '_CON.html');
  assert.equal(suggestedFilename('슬라이드: A/B?'), '슬라이드_ A_B_.html');
  assert.equal(suggestedFilename('..'), 'presentation.html');
});
