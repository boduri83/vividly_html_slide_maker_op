import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { atomicWriteDocument } from './files.mjs';
import { canonicalJson } from './canonical-json.mjs';

export const BRIDGE_METHODS = Object.freeze(['readCommittedSnapshot', 'readEditorState', 'readCapabilities', 'readHistory',
  'applyCommands', 'undoGuarded', 'redoGuarded','readProjection','readOperation','cancelOperation','previewCommands','listApprovedFiles','importAsset','saveDocument','openDocument','presentDocument','readHostOperation','cancelHostOperation']);
export const BRIDGE_REQUEST_BYTES = 1024 * 1024;
const mutationMethods = new Set(['applyCommands', 'undoGuarded', 'redoGuarded']);
const hostEffectMethods = new Set(['saveDocument','openDocument','presentDocument']);
const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, mutated: false, ...extra } });
const hash = input => createHash('sha256').update(input).digest('hex');

/** Authenticated, per-instance local bridge. Disabled until the person grants the current document. */
export class AgentBridge {
  constructor({ directory, dispatch, getSessionId, onStatus = () => {}, launchConfig = () => null, io = fs } = {}) {
    if (!path.isAbsolute(directory || '') || typeof dispatch !== 'function' || typeof getSessionId !== 'function') throw new TypeError('Agent bridge configuration is required');
    this.directory = path.resolve(directory); this.dispatch = dispatch; this.getSessionId = getSessionId;
    this.onStatus = onStatus; this.io = io; this.instanceId = `vividly-${randomUUID()}`;
    this.launchConfig = launchConfig;
    const user = hash(`${os.userInfo().username}:${os.homedir()}`).slice(0, 12);
    this.endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\vividly-${user}-${this.instanceId}`
      : path.join(os.tmpdir(), `${this.instanceId}.sock`);
    this.descriptorPath = path.join(this.directory, `${this.instanceId}.json`);
    this.enabled = false; this.server = null; this.sockets = new Set(); this.token = null;
    this.grantedSessionId = null; this.receipts = new Map(); this.lastError = null;
    this.toggleQueue = Promise.resolve(); this.generation = 0;this.grantId=null;
    this.openReplyBarriers=new Set();this.deferredDocumentChange=false;
  }
  status() {
    return { enabled: this.enabled, instanceId: this.instanceId, descriptorPath: this.enabled ? this.descriptorPath : null,
      grantedSessionId: this.grantedSessionId, clientCount: this.sockets.size, methods: [...BRIDGE_METHODS], lastError: this.lastError,
      launchConfig: this.enabled ? this.launchConfig(this.descriptorPath) : null };
  }
  notify() { this.onStatus(this.status()); }
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new TypeError('연결 상태가 올바르지 않습니다.'));
    const next = this.toggleQueue.catch(() => {}).then(() => enabled ? this.start() : this.stop());
    this.toggleQueue = next; return next;
  }
  async start() {
    if (this.enabled && this.grantedSessionId === this.getSessionId()) return this.status();
    if (this.server) await this.stop();
    const sessionId = this.getSessionId();
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('문서를 연 뒤 에이전트 연결을 켜 주세요.');
    this.token = randomBytes(32).toString('hex'); this.grantedSessionId = sessionId;
    this.receipts.clear(); this.lastError = null; ++this.generation;this.grantId=randomUUID();
    await this.io.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.server = net.createServer(socket => this.accept(socket));
    this.server.on('error', error => { this.lastError = error.message; this.notify(); });
    try {
    await new Promise((resolve, reject) => {
      const onError = error => { this.server?.removeListener('listening', onListening); reject(error); };
      const onListening = () => { this.server.removeListener('error', onError); resolve(); };
      this.server.once('error', onError); this.server.once('listening', onListening);
      this.server.listen(this.endpoint);
    });
      if (process.platform !== 'win32') await this.io.chmod(this.endpoint, 0o600);
      const descriptor = { format: 'vividly-agent-bridge', schemaVersion: 1, transport: process.platform === 'win32' ? 'named-pipe' : 'unix-socket',
        instanceId: this.instanceId, endpoint: this.endpoint, token: this.token, processId: process.pid,
        createdAt: new Date().toISOString(), methods: [...BRIDGE_METHODS] };
      await atomicWriteDocument(this.descriptorPath, JSON.stringify(descriptor), { io: this.io });
      await this.io.chmod(this.descriptorPath, 0o600);
      if (sessionId !== this.getSessionId()) { await this.stop(); return this.status(); }
      const bound=await this.dispatch('bindAgentGrant',{}, {grantId:this.grantId,editorSessionId:sessionId});if(bound?.ok===false)throw Error(bound.error.message);
      if(sessionId!==this.getSessionId()){await this.stop();return this.status();}
      this.enabled = true; this.notify(); return this.status();
    } catch (error) { await this.stop(); throw error; }
  }
  async stop() {
    this.enabled = false; ++this.generation; this.token = null; this.grantedSessionId = null;
    this.openReplyBarriers.clear();this.deferredDocumentChange=false;
    if(this.grantId!==null){await Promise.resolve(this.dispatch('bindAgentGrant',{}, {grantId:null,editorSessionId:this.getSessionId()})).catch(error=>{this.lastError=error.message;});this.grantId=null;}
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server; this.server = null;
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await this.io.unlink(this.descriptorPath).catch(error => { if (error.code !== 'ENOENT') this.lastError = error.message; });
    if (process.platform !== 'win32') await this.io.unlink(this.endpoint).catch(() => {});
    this.receipts.clear(); this.notify(); return this.status();
  }
  documentChanged() {
    if(this.enabled&&this.grantedSessionId!==this.getSessionId()){if([...this.openReplyBarriers].some(token=>token.generation===this.generation)){this.deferredDocumentChange=true;return Promise.resolve(this.status());}return this.setEnabled(false);}
    return Promise.resolve(this.status());
  }
  // An authorized open changes the session before its old-grant reply is sent.
  // Keep that socket until the reply is flushed; authentication already refuses
  // new old-session requests. Explicit user revocation still stops immediately.
  beginOpenReply(){const token={generation:this.generation};this.openReplyBarriers.add(token);let released=false;return()=>{if(released)return;released=true;this.openReplyBarriers.delete(token);if(this.deferredDocumentChange&&token.generation===this.generation&&!this.openReplyBarriers.size){this.deferredDocumentChange=false;void this.documentChanged().catch(error=>{this.lastError=error.message;this.notify();});}};}
  authenticate(request) {
    if (!this.enabled || this.grantedSessionId !== this.getSessionId()) return false;
    if (request?.protocol !== 1 || request.instanceId !== this.instanceId || typeof request.token !== 'string') return false;
    const supplied = Buffer.from(request.token), expected = Buffer.from(this.token || '');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  accept(socket) {
    if (this.sockets.size >= 32) { socket.destroy(); return; }
    this.sockets.add(socket); this.notify(); let pending = Buffer.alloc(0), chain = Promise.resolve();
    let frames = 0;
    socket.setTimeout(60000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => { this.sockets.delete(socket); this.notify(); });
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > BRIDGE_REQUEST_BYTES) { socket.destroy(); return; }
      for (;;) {
        const newline = pending.indexOf(10); if (newline < 0) break;
        if (++frames > 32) { socket.destroy(); return; }
        const line = pending.subarray(0, newline).toString('utf8'); pending = pending.subarray(newline + 1);
        chain = chain.catch(() => {}).then(async () => {
          let request;
          try { request = JSON.parse(line); }
          catch { socket.destroy(); return; }
          if (!this.authenticate(request)) { socket.destroy(); return; }
          const release=request.method==='openDocument'?this.beginOpenReply():()=>{};
          const onClose=()=>release();socket.once('close',onClose);
          try{const result=await this.invoke(request);if(!socket.destroyed)socket.write(JSON.stringify({id:request.id,result})+'\n',()=>{socket.removeListener('close',onClose);release();});else{socket.removeListener('close',onClose);release();}}catch(error){socket.removeListener('close',onClose);release();throw error;}
        });
      }
    });
  }
  async invoke(request) {
    if (!this.authenticate(request)) return fail('PERMISSION_DENIED', '문서 연결 권한이 없거나 만료됐습니다.');
    if (typeof request.id !== 'string' || request.id.length > 200 || !BRIDGE_METHODS.includes(request.method)) return fail('INVALID_REQUEST', '지원하지 않는 요청입니다.');
    const params = request.params ?? {};
    if (!params || typeof params !== 'object' || Array.isArray(params)) return fail('INVALID_REQUEST', '요청 매개변수가 올바르지 않습니다.');
    const generation = this.generation, sessionId = this.grantedSessionId;
    const run = async () => {
      if (!this.enabled || generation !== this.generation || sessionId !== this.getSessionId()) return fail('PERMISSION_DENIED', '문서 연결 권한이 바뀌었습니다.');
      try { return await this.dispatch(request.method, params,{grantId:this.grantId,editorSessionId:sessionId}); }
      catch (error) {
        const mutation = mutationMethods.has(request.method)||hostEffectMethods.has(request.method);
        return { ok: false, error: { code: 'BRIDGE_ERROR', message: error.message || '편집기 요청을 처리하지 못했습니다.',
          ...(mutation ? { outcomeUnknown: true } : { mutated: false }) } };
      }
    };
    if (!mutationMethods.has(request.method) || params.dryRun === true) return run();
    if (params.target?.editorSessionId !== sessionId) return fail('PERMISSION_DENIED', '연결을 허용한 문서 세션만 변경할 수 있습니다.');
    if (typeof params.operationId !== 'string' || !params.operationId.trim() || params.operationId.length > 256) return fail('INVALID_REQUEST', '작업 식별자가 필요합니다.');
    let fingerprint;
    try { fingerprint = hash(canonicalJson({ method: request.method, params })); }
    catch { return fail('INVALID_REQUEST', '유한 수를 포함한 JSON 데이터 요청이 필요합니다.'); }
    const key = `${sessionId}:${params.operationId}`;
    const previous = this.receipts.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return fail('OPERATION_CONFLICT', '같은 작업 ID를 다른 내용으로 재사용할 수 없습니다.');
      const awaited=previous.promise;
      let result=await awaited;
      // A renderer response can time out after its atomic commit. Re-enter the
      // same ledger operation to recover that result, never allocate a new ID.
      if(result.error?.outcomeUnknown){
        if(previous.promise===awaited)previous.promise=run();
        result=await previous.promise;
      }
      result=structuredClone(result);
      return { ...result, receipt: { ...result.receipt,operationId: params.operationId, replayed: true, scope: 'current-grant' } };
    }
    if (this.receipts.size >= 1000) return fail('RECEIPT_LIMIT', '연결의 작업 한도에 도달했습니다. 연결을 다시 허용해 주세요.');
    const promise = run(); this.receipts.set(key, { fingerprint, promise });
    const result = await promise;
    return { ...result, receipt: { ...result.receipt,operationId: params.operationId, replayed: false, scope: 'current-grant' } };
  }
}

/** Client descriptor checks prevent a descriptor from changing this local-only adapter into a TCP client. */
export async function readBridgeDescriptor(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('--descriptor에 절대 경로가 필요합니다.');
  const info = await fs.stat(file);
  if (!info.isFile() || info.size > 8192) throw new Error('연결 descriptor가 올바르지 않습니다.');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (value.format !== 'vividly-agent-bridge' || value.schemaVersion !== 1
      || !/^vividly-[a-f0-9-]{36}$/.test(value.instanceId || '') || !/^[a-f0-9]{64}$/.test(value.token || '')) throw new Error('지원하지 않는 연결 descriptor입니다.');
  if (process.platform === 'win32') {
    if (value.transport !== 'named-pipe' || !value.endpoint?.startsWith('\\\\.\\pipe\\vividly-') || /[\r\n]/.test(value.endpoint)) throw new Error('로컬 Vividly named pipe만 연결할 수 있습니다.');
  } else if (value.transport !== 'unix-socket' || path.dirname(value.endpoint || '') !== os.tmpdir()
      || path.basename(value.endpoint) !== `${value.instanceId}.sock`) throw new Error('로컬 Vividly socket만 연결할 수 있습니다.');
  return value;
}

export async function callBridge(descriptor, method, params = {}, { timeoutMs = 30000 } = {}) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.connect(descriptor.endpoint); let pending = Buffer.alloc(0), finished = false;
    const finish = (error, result) => { if (finished) return; finished = true; socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setTimeout(timeoutMs, () => finish(new Error('편집기 응답 시간이 초과했습니다. 같은 operationId로 결과를 재조회할 수 있습니다.')));
    socket.on('error', error => finish(error)); socket.on('end', () => { if (!finished) finish(new Error('편집기 연결이 종료됐습니다.')); });
    socket.on('connect', () => socket.write(JSON.stringify({ protocol: 1, instanceId: descriptor.instanceId, token: descriptor.token, id, method, params }) + '\n'));
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 110 * 1024 * 1024) { finish(new Error('편집기 응답이 허용 크기를 초과했습니다.')); return; }
      const newline = pending.indexOf(10); if (newline < 0) return;
      try { const response = JSON.parse(pending.subarray(0, newline).toString('utf8')); if (response.id !== id) throw new Error('응답 식별자가 다릅니다.'); finish(null, response.result); }
      catch (error) { finish(error); }
    });
  });
}
