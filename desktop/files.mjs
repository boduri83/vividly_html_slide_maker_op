import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const RENAME_RETRY_DELAYS = Object.freeze([20, 50, 100, 200, 400]);
const RETRYABLE_RENAME_CODES = new Set(['EINTR', 'EPERM', 'EACCES', 'EBUSY']);
const pause = delay => new Promise(resolve => setTimeout(resolve, delay));

export function validateSessionId(value) {
  if (typeof value !== 'string' || !value || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError('문서 세션 식별자가 올바르지 않습니다.');
  }
  return value;
}

export function suggestedFilename(title) {
  const stem = String(title || '새 프레젠테이션').slice(0, 160)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim() || 'presentation';
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? '_' : ''}${stem}.html`;
}

/** Write only a task-owned sibling temp, then atomically replace the selected target. */
export async function atomicWriteDocument(filePath, contents, { io = fs, wait = pause, beforeCommit } = {}) {
  if (!path.isAbsolute(filePath) || typeof contents !== 'string') throw new TypeError('저장 대상이 올바르지 않습니다.');
  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.html-slide-${randomUUID()}.tmp`);
  if (path.dirname(temporary) !== directory) throw new Error('임시 저장 경로가 대상 폴더를 벗어났습니다.');
  let handle;
  let created = false;
  try {
    handle = await io.open(temporary, 'wx');
    created = true;
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    // Windows sync providers/scanners can briefly lock the destination. Keep
    // the original file in place; never unlink it to make replacement succeed.
    for (let attempt = 0; ; attempt++) {
      try { if (beforeCommit) await beforeCommit(); await io.rename(temporary, destination); break; }
      catch (error) {
        if (!RETRYABLE_RENAME_CODES.has(error.code) || attempt >= RENAME_RETRY_DELAYS.length) throw error;
        await wait(RENAME_RETRY_DELAYS[attempt]);
      }
    }
    created = false;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (created) {
      try { await io.unlink(temporary); }
      catch (cleanup) { if (cleanup.code !== 'ENOENT') error.cleanupError = cleanup.message; }
    }
    throw error;
  }
}

/** Main-process file authority: paths come only from native dialogs, never renderer IPC. */
export class DesktopFileService {
  constructor({ dialog, getWindow = () => undefined, io = fs, write = atomicWriteDocument,
    maxBytes = MAX_DOCUMENT_BYTES } = {}) {
    if (!dialog) throw new TypeError('Native file dialog provider is required');
    this.dialog = dialog;
    this.getWindow = getWindow;
    this.io = io;
    this.write = write;
    this.maxBytes = maxBytes;
    this.targets = new Map();
    this.pendingOpen = new Map();
    this.pathQueues = new Map();
    this.sessionQueues = new Map();
    this.dialogQueue = Promise.resolve();
    this.openGeneration = 0;
    this.pendingOperations = 0;
  }

  get busy() { return this.pendingOperations > 0; }

  async withDialog(operation) {
    const job = this.dialogQueue.catch(() => {}).then(operation);
    this.dialogQueue = job;
    try { return await job; }
    finally { if (this.dialogQueue === job) this.dialogQueue = Promise.resolve(); }
  }

  async openDocument() {
    const generation = ++this.openGeneration;
    this.pendingOpen.clear();
    this.pendingOperations++;
    try {
      const result = await this.withDialog(() => this.dialog.showOpenDialog(this.getWindow(), {
        title: 'HTML 프레젠테이션 열기', properties: ['openFile'],
        filters: [{ name: 'HTML 프레젠테이션', extensions: ['html', 'htm'] },
          { name: '문서 데이터 표본', extensions: ['json'] }],
      }));
      if (result.canceled || !result.filePaths?.length || generation !== this.openGeneration) return { canceled: true };
      const filePath = path.resolve(result.filePaths[0]);
      const info = await this.io.stat(filePath);
      if (!info.isFile()) throw new Error('일반 문서 파일을 선택해 주세요.');
      if (info.size > this.maxBytes) throw new Error('이번 버전은 100MB 이하 문서를 열 수 있습니다.');
      const bytes = await this.io.readFile(filePath);
      if (bytes.length > this.maxBytes) throw new Error('파일을 읽는 동안 허용 크기를 초과했습니다.');
      const contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (generation !== this.openGeneration) return { canceled: true };
      const openToken = randomUUID();
      this.pendingOpen.set(openToken, { filePath, generation });
      return { canceled: false, openToken, contents, name: path.basename(filePath) };
    } finally { this.pendingOperations--; }
  }

  adoptDocument({ openToken, sessionId } = {}) {
    validateSessionId(sessionId);
    const pending = typeof openToken === 'string' && this.pendingOpen.get(openToken);
    if (!pending || pending.generation !== this.openGeneration) throw new Error('만료된 파일 열기 요청입니다. 다시 열어 주세요.');
    this.pendingOpen.delete(openToken);
    const hasSaveTarget = /\.html?$/i.test(pending.filePath);
    if (hasSaveTarget) this.targets.set(sessionId, pending.filePath);
    return { name: path.basename(pending.filePath), path: pending.filePath, hasSaveTarget };
  }

  async saveDocument({ html, sessionId, title, saveAs = false } = {}) {
    validateSessionId(sessionId);
    if (typeof html !== 'string' || Buffer.byteLength(html, 'utf8') > this.maxBytes) throw new TypeError('저장할 HTML이 올바르지 않거나 100MB를 초과했습니다.');
    if (typeof saveAs !== 'boolean' || typeof title !== 'string' || title.length > 1000) throw new TypeError('저장 옵션이 올바르지 않습니다.');
    this.pendingOperations++;
    const prior = this.sessionQueues.get(sessionId) || Promise.resolve();
    const job = prior.catch(() => {}).then(() => this.performSave({ html, sessionId, title, saveAs }));
    this.sessionQueues.set(sessionId, job);
    try {
      return await job;
    } finally {
      if (this.sessionQueues.get(sessionId) === job) this.sessionQueues.delete(sessionId);
      this.pendingOperations--;
    }
  }

  async performSave({ html, sessionId, title, saveAs }) {
    let filePath = this.targets.get(sessionId);
    if (saveAs || !filePath) {
      const result = await this.withDialog(() => this.dialog.showSaveDialog(this.getWindow(), {
        title: saveAs ? '다른 이름으로 저장' : 'HTML 프레젠테이션 저장',
        defaultPath: filePath || suggestedFilename(title),
        filters: [{ name: 'HTML 프레젠테이션', extensions: ['html'] }],
        properties: ['showOverwriteConfirmation'],
      }));
      if (result.canceled || !result.filePath) return { confirmed: false, canceled: true };
      filePath = path.resolve(result.filePath);
    }
    return this.writeSelectedTarget({filePath,html,sessionId});
  }

  /** Main-only capability seam. Never expose filePath through renderer/MCP input. */
  async saveApprovedDocument({filePath,html,sessionId,title,beforeWrite}={}) {
    validateSessionId(sessionId);
    if(typeof filePath!=='string'||!path.isAbsolute(filePath)||!/^.*\.html?$/i.test(filePath)||typeof html!=='string'||Buffer.byteLength(html,'utf8')>this.maxBytes||typeof title!=='string'||title.length>1000||typeof beforeWrite!=='function')throw new TypeError('승인한 HTML 저장 대상과 확정 문맥이 필요합니다.');
    this.pendingOperations++;
    const prior=this.sessionQueues.get(sessionId)||Promise.resolve();
    const job=prior.catch(()=>{}).then(async()=>{await beforeWrite();return this.writeSelectedTarget({filePath:path.resolve(filePath),html,sessionId,beforeCommit:beforeWrite});});
    this.sessionQueues.set(sessionId,job);
    try{return await job;}finally{if(this.sessionQueues.get(sessionId)===job)this.sessionQueues.delete(sessionId);this.pendingOperations--;}
  }

  async writeSelectedTarget({filePath,html,sessionId,beforeCommit}) {
    const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
    const prior = this.pathQueues.get(key) || Promise.resolve();
    const selectedPath = filePath;
    const job = prior.catch(() => {}).then(async () => {
      await this.write(selectedPath, html, { io: this.io, ...(beforeCommit?{beforeCommit}:{}) });
      // A failed/cancelled Save As must leave the previous binding untouched.
      this.targets.set(sessionId, selectedPath);
      return { confirmed: true, targetId: selectedPath, name: path.basename(selectedPath), path: selectedPath };
    });
    this.pathQueues.set(key, job);
    try { return await job; }
    finally { if (this.pathQueues.get(key) === job) this.pathQueues.delete(key); }
  }
}
