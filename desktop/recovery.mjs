import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteDocument, MAX_DOCUMENT_BYTES, validateSessionId } from './files.mjs';
import { normalizeDocument } from '../src/model.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const recordName = documentId => `${sha(documentId)}.json`;

/** Application-owned recovery snapshots. Never binds or writes a user's HTML file. */
export class RecoveryService {
  constructor({ directory, io = fs, write = atomicWriteDocument, isCurrent = () => true,
    maxBytes = MAX_DOCUMENT_BYTES } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('복구 저장소 경로가 필요합니다.');
    this.directory = path.resolve(directory); this.io = io; this.writeAtomic = write;
    this.isCurrent = isCurrent; this.maxBytes = maxBytes; this.queue = Promise.resolve();
  }
  serial(operation) {
    const next = this.queue.catch(() => {}).then(operation);
    this.queue = next; return next;
  }
  location(name) {
    if (!/^[a-f0-9]{64}(?:\.previous)?\.json$/.test(name)) throw new Error('복구 레코드가 올바르지 않습니다.');
    return path.join(this.directory, name);
  }
  decode(contents) {
    if (Buffer.byteLength(contents) > this.maxBytes + 65536) throw new Error('복구 파일이 허용 크기를 초과했습니다.');
    const value = JSON.parse(contents);
    if (value.format !== 'vividly-recovery' || value.schemaVersion !== 1 || typeof value.recoveryId !== 'string'
        || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))
        || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('복구 파일 형식을 읽을 수 없습니다.');
    validateSessionId(value.sessionId);
    if (sha(JSON.stringify(value.document)) !== value.documentSha256) throw new Error('복구 파일 내용이 손상됐습니다.');
    value.document = normalizeDocument(value.document);
    value.documentSha256 = sha(JSON.stringify(value.document));
    return value;
  }
  write(input) {
    return this.serial(async () => {
      validateSessionId(input?.sessionId);
      if (!this.isCurrent(input.sessionId)) return { written: false, stale: true };
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError('복구 revision이 올바르지 않습니다.');
      const encoded = JSON.stringify(input.document);
      if (Buffer.byteLength(encoded) > this.maxBytes) throw new Error('복구 자료가 100MB를 초과했습니다.');
      const document = normalizeDocument(input.document);
      const file = this.location(recordName(document.id));
      await this.io.mkdir(this.directory, { recursive: true });
      let old, oldContents;
      try { oldContents = await this.io.readFile(file, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (oldContents !== undefined) {
        try { old = this.decode(oldContents); }
        catch {
          // Autosave must preserve an unreadable head too, even if startup read was skipped.
          await this.io.rename(file, `${file}.corrupt-${Date.now()}-${randomUUID()}`);
        }
      }
      if (old?.sessionId === input.sessionId && old.revision > input.revision) return { written: false, stale: true };
      if (!this.isCurrent(input.sessionId)) return { written: false, stale: true };
      if (old) await this.writeAtomic(file.replace(/\.json$/, '.previous.json'), JSON.stringify(old), { io: this.io });
      const record = { format: 'vividly-recovery', schemaVersion: 1, recoveryId: old?.recoveryId || randomUUID(),
        sessionId: input.sessionId, revision: input.revision, savedAt: new Date().toISOString(),
        title: document.title, document, documentSha256: sha(JSON.stringify(document)) };
      if (!this.isCurrent(input.sessionId)) return { written: false, stale: true };
      await this.writeAtomic(file, JSON.stringify(record), { io: this.io });
      return { written: true, recoveryId: record.recoveryId, savedAt: record.savedAt, revision: record.revision };
    });
  }
  async candidates() {
    let names;
    try { names = await this.io.readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return { records: [], warnings: [] }; throw error; }
    const records = [], warnings = [];
    for (const name of names.filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
      const file = this.location(name);
      try { records.push({ file, record: this.decode(await this.io.readFile(file, 'utf8')) }); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        // Preserve corrupt bytes for diagnosis; a valid previous generation can still recover.
        const quarantine = `${file}.corrupt-${Date.now()}-${randomUUID()}`;
        await this.io.rename(file, quarantine).catch(() => {});
        warnings.push('손상된 복구 파일을 보관했습니다.');
        try {
          const previous = this.location(name.replace(/\.json$/, '.previous.json'));
          records.push({ file: previous, record: this.decode(await this.io.readFile(previous, 'utf8')) });
          warnings.push('직전 정상 복구본을 표시합니다.');
        } catch { /* A corrupt recovery never replaces the current editor or a user file. */ }
      }
    }
    // A previous generation remains available after the corrupt head was quarantined.
    const known = new Set(records.map(row => row.record.document.id));
    for (const name of names.filter(n => /^[a-f0-9]{64}\.previous\.json$/.test(n))) {
      try {
        const file = this.location(name), record = this.decode(await this.io.readFile(file, 'utf8'));
        if (!known.has(record.document.id)) { records.push({ file, record }); known.add(record.document.id); }
      } catch { /* Do not destroy an unreadable backup. */ }
    }
    records.sort((a, b) => b.record.savedAt.localeCompare(a.record.savedAt));
    return { records, warnings };
  }
  read({ recoveryId } = {}) {
    return this.serial(async () => {
      const { records, warnings } = await this.candidates();
      const picked = recoveryId ? records.find(row => row.record.recoveryId === recoveryId) : records[0];
      if (!picked) return { available: false, candidateCount: records.length, warning: warnings.join(' ') || null };
      const { record } = picked;
      return { available: true, recoveryId: record.recoveryId, savedAt: record.savedAt, title: record.title,
        revision: record.revision, document: record.document, candidateCount: records.length,
        warning: warnings.join(' ') || null };
    });
  }
  clear({ sessionId, recoveryId } = {}) {
    return this.serial(async () => {
      if (sessionId !== undefined) validateSessionId(sessionId);
      if (!sessionId && (typeof recoveryId !== 'string' || !recoveryId)) throw new TypeError('삭제할 복구 식별자가 필요합니다.');
      const { records } = await this.candidates(); let cleared = 0;
      for (const { record } of records) {
        if ((sessionId && record.sessionId !== sessionId) || (recoveryId && record.recoveryId !== recoveryId)) continue;
        const name = recordName(record.document.id);
        for (const candidate of [name, name.replace(/\.json$/, '.previous.json')]) {
          const file = this.location(candidate);
          try {
            // Re-read identity before removing; a newer session's snapshot must survive.
            const latest = this.decode(await this.io.readFile(file, 'utf8'));
            if ((sessionId && latest.sessionId !== sessionId) || (recoveryId && latest.recoveryId !== recoveryId)) continue;
            await this.io.unlink(file); cleared++;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      return { cleared };
    });
  }
}
