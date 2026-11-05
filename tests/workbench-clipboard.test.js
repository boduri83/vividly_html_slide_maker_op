import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeClipboardService, MAX_CLIPBOARD_TEXT_BYTES, MAX_CLIPBOARD_IMAGE_BYTES } from '../desktop/clipboard.mjs';

const item = payloads => ({ types: Object.keys(payloads), async getType(type) { assert.ok(Object.hasOwn(payloads, type)); return payloads[type]; } });
function provider({ text = '', image = null } = {}) {
  // Installed Electron 45: async ClipboardItem[] and writeText, no readImage.
  return { text, image, writes: [], reads: 0, async read() {
    this.reads++; const payloads = {}; if (this.text) payloads['text/plain'] = new Blob([this.text], { type: 'text/plain' });
    if (this.image) payloads['image/png'] = this.image; return Object.keys(payloads).length ? [item(payloads)] : [];
  }, async writeText(value) { this.writes.push(value); this.text = value; this.image = null; } };
}
function png(width = 2, height = 3) {
  const bytes = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}

test('async native clipboard preserves full UTF-8 Vividly JSON and rejects oversized writes before changing OS data', async () => {
  assert.equal(MAX_CLIPBOARD_TEXT_BYTES, 32 * 1024 * 1024); assert.equal(MAX_CLIPBOARD_IMAGE_BYTES, 20 * 1024 * 1024);
  const clip = provider({ text: 'USER CLIPBOARD' }), service = new NativeClipboardService({ clipboard: clip, maxTextBytes: 40 });
  const json = JSON.stringify({ format: 'vividly', text: '한글' });
  assert.equal((await service.writeText(json)).bytes, Buffer.byteLength(json)); assert.equal((await service.read()).text, json);
  await assert.rejects(service.writeText('한'.repeat(14)), /32MiB/); assert.equal(clip.text, json); assert.equal(clip.writes.length, 1);
  await assert.rejects(service.writeText({ text: 'invalid' }), TypeError); assert.equal(clip.writes.length, 1);
});

test('async ClipboardItem reads allowlisted text and PNG bytes only, without file paths or text truncation', async () => {
  const bytes = png(), clip = provider({ text: 'image caption', image: new Blob([bytes], { type: 'image/png' }) });
  const service = new NativeClipboardService({ clipboard: clip });
  assert.deepEqual(await service.read(), { text: 'image caption', image: { mimeType: 'image/png', dataBase64: bytes.toString('base64'), width: 2, height: 3 } });
  assert.equal(clip.reads, 1); assert.equal(clip.writes.length, 0); assert.equal(clip.text, 'image caption');
  const tiny = new NativeClipboardService({ clipboard: clip, maxTextBytes: 4 }); await assert.rejects(tiny.read(), /32MiB/); assert.equal(clip.text, 'image caption');
  const requested = []; clip.read = async () => [{ types: ['text/uri-list', 'electron application/osclipboard;format="private"'], getType: async type => { requested.push(type); throw new Error('Forbidden'); } }];
  assert.deepEqual(await service.read(), { text: '' }); assert.deepEqual(requested, []);
});

test('empty clipboard is supported and oversized or invalid PNG Blob payloads are refused before decoding', async () => {
  const clip = provider(), service = new NativeClipboardService({ clipboard: clip }); assert.deepEqual(await service.read(), { text: '' });
  let readBytes = false; clip.image = { size: MAX_CLIPBOARD_IMAGE_BYTES + 1, arrayBuffer: async () => { readBytes = true; return new ArrayBuffer(0); } };
  await assert.rejects(service.read(), /20MiB/); assert.equal(readBytes, false);
  clip.image = new Blob([png(100000, 100000)], { type: 'image/png' }); await assert.rejects(service.read(), /크기/);
  clip.image = new Blob([Buffer.from('not a PNG')]); await assert.rejects(service.read(), /PNG/);
  clip.image = new Blob([]); await assert.rejects(service.read(), /PNG/); assert.equal(clip.writes.length, 0);
});

test('write completion and rejection are awaited rather than reporting success before native Promise resolution', async () => {
  const clip = provider(); let resolveWrite;
  clip.writeText = value => new Promise(resolve => { resolveWrite = () => { clip.text = value; resolve(); }; });
  const service = new NativeClipboardService({ clipboard: clip }); let completed = false;
  const result = service.writeText('awaited').then(value => { completed = true; return value; });
  await Promise.resolve(); assert.equal(completed, false); assert.equal(clip.text, ''); resolveWrite();
  assert.equal((await result).written, true); assert.equal(clip.text, 'awaited');
  clip.writeText = async () => { throw new Error('OS clipboard busy'); };
  await assert.rejects(service.writeText('must not claim success'), /OS clipboard busy/); assert.equal(clip.text, 'awaited');
});
