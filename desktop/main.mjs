import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, session, shell, safeStorage, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopFileService, validateSessionId } from './files.mjs';
import { RecoveryService } from './recovery.mjs';
import { AgentBridge } from './agent-bridge.mjs';
import { NativeClipboardService } from './clipboard.mjs';
import { DesktopExportService } from './export.mjs';
import { PresenterService } from './presenter.mjs';
import { randomUUID } from 'node:crypto';
import { installedFonts } from './fonts.mjs';
import {DesktopProgressService}from './progress.mjs';
import {DesktopFormDataService}from './form-data.mjs';
import {AvatarHost}from './avatar-host.mjs';
import {DataHost}from './data-host.mjs';
import{confirmWindowClose}from './window-close.mjs';
import{ApprovedAssetBroker,createNativeAssetPicker,createNativePngDecoder}from './approved-asset-broker.mjs';
import{AgentIOService}from './agent-io-service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = 'html-slide://editor/';
const SCHEME = 'html-slide:';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src blob:; form-action 'none'";
protocol.registerSchemesAsPrivileged([{ scheme: 'html-slide', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);

let window;
let files;
let state = { sessionId: '', title: 'Vividly', dirty: false, busy: false, composing: false };
let closingPrompt = false;
let recovery;
let agentBridge;
const agentRequests = new Map();
let shutdownFinished = false;
let outputService;
let presenterService;
let progressService;
let formDataService;
let avatarHost;
let dataHost;
let assetBroker,agentIO,ioGrant=null,ioBinding=null;
const nativeClipboard = new NativeClipboardService({ clipboard });

function agentStatus(value) {
  if (window && !window.isDestroyed()) window.webContents.send('desktop:agent-status', value);
}
function requestRenderer(method, params, agentContext) {
  if(closingPrompt&&['applyCommands','undoGuarded','redoGuarded'].includes(method)&&params?.dryRun!==true)return Promise.resolve({ok:false,error:{code:'EDITOR_BUSY',message:'창 닫기 확인 중에는 변경을 적용하지 않습니다.',mutated:false}});
  if (!window || window.isDestroyed()) return Promise.reject(new Error('편집기 창이 없습니다.'));
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { agentRequests.delete(requestId); reject(new Error('편집기 응답 시간이 초과했습니다.')); }, 30000);
    agentRequests.set(requestId, { resolve, reject, timeout });
    window.webContents.send('desktop:agent-request', { requestId, method, params, ...(agentContext ? {agentContext} : {}) });
  });
}

function trustedSender(event) {
  const frame = event.senderFrame;
  if (!window || window.isDestroyed() || event.sender !== window.webContents || !frame
      || frame !== window.webContents.mainFrame || frame.url !== APP_URL) {
    throw new Error('허용되지 않은 데스크톱 요청입니다.');
  }
}

async function ensureIOGrant(){
  if(!state.sessionId||!state.documentId)throw Error('자료를 연 뒤 파일을 허용하세요.');
  if(ioGrant?.editorSessionId===state.sessionId&&ioGrant.documentId===state.documentId)return ioGrant;
  if(ioBinding?.sessionId===state.sessionId)return ioBinding.promise;
  const candidate={grantId:randomUUID(),editorSessionId:state.sessionId,documentId:state.documentId};
  const promise=requestRenderer('bindIOGrant',{}, {ioGrantId:candidate.grantId,editorSessionId:candidate.editorSessionId}).then(result=>{
    if(!result?.ok)throw Error(result?.error?.message||'파일 허용 범위를 연결하지 못했습니다.');
    if(state.sessionId!==candidate.editorSessionId||state.documentId!==candidate.documentId)throw Error('자료가 바뀌었습니다. 다시 허용하세요.');
    ioGrant=candidate;return candidate;
  });
  ioBinding={sessionId:state.sessionId,promise};try{return await promise;}finally{if(ioBinding?.promise===promise)ioBinding=null;}
}
const currentIOGrant=()=>ioGrant?.editorSessionId===state.sessionId&&ioGrant.documentId===state.documentId?ioGrant:null;
const ioMethods=new Set(['listApprovedFiles','importAsset','saveDocument','openDocument','presentDocument','readHostOperation','cancelHostOperation']);
async function dispatchAgent(method,params,context){
  if(method==='bindAgentGrant')return requestRenderer(method,params,context);
  if(context&&(context.grantId!==agentBridge?.grantId||context.editorSessionId!==state.sessionId||!agentBridge.enabled))return{ok:false,error:{code:'PERMISSION_DENIED',message:'문서 연결 권한이 바뀌었습니다.',mutated:false}};
  if(['readOperation','cancelOperation'].includes(method)&&assetBroker?.ownsOperation(params,context))return assetBroker[method](params,context);
  if(ioMethods.has(method)||['applyCommands','previewCommands'].includes(method)&&params?.stagingIds!==undefined){
    if(closingPrompt&&!['listApprovedFiles','readHostOperation','cancelHostOperation'].includes(method))return{ok:false,error:{code:'EDITOR_BUSY',message:'창 닫기 확인을 마친 뒤 요청하세요.',mutated:false}};
    await ensureIOGrant();
    if(ioMethods.has(method))return agentIO.invoke(method,params,context);
    return assetBroker.executeBatch({...params,...(method==='previewCommands'?{dryRun:true}:{})},context);
  }
  return requestRenderer(method,params,context);
}
async function humanIO(method,value){
  try{
    if(closingPrompt&&method!=='getStatus')return{ok:false,error:{code:'EDITOR_BUSY',message:'창 닫기 확인 뒤 파일을 허용하세요.',mutated:false}};
    await ensureIOGrant();
    return await (['chooseAsset','importAsset','revokeFile','releaseAsset'].includes(method)?assetBroker:agentIO)[method](value??{});
  }catch(error){return{ok:false,error:{code:error.code||'IO_UNAVAILABLE',message:error.message,mutated:false}};}
}

function setWindowTitle() {
  if (window && !window.isDestroyed()) window.setTitle(`${state.dirty ? '● ' : ''}${state.title || '새 프레젠테이션'} — Vividly`);
}

function command(value) {
  if (window && !window.isDestroyed()) window.webContents.send('desktop:command', value);
}

function registerIpc() {
  for(const method of ['getStatus','chooseAsset','importAsset','revokeFile','releaseAsset','chooseOpenSource','allowCurrentSaveTarget','chooseSaveTarget','revokePermission','renewPermission','setPresentPermission'])ipcMain.handle('desktop:agent-io-'+method,(event,value)=>{trustedSender(event);return humanIO(method,value);});
  ipcMain.handle('desktop:progress-save',(event,value)=>{trustedSender(event);return progressService.save(value);});
  ipcMain.handle('desktop:progress-open',event=>{trustedSender(event);return progressService.open();});
  ipcMain.handle('desktop:form-data-save',(event,value)=>{trustedSender(event);return formDataService.save(value);});
  ipcMain.handle('desktop:list-fonts',(event,value)=>{trustedSender(event);return installedFonts({refresh:value?.refresh===true});});
  ipcMain.handle('desktop:output-preview',(event,value)=>{trustedSender(event);return outputService.preview(value);});
  ipcMain.handle('desktop:output-write',(event,value)=>{trustedSender(event);return outputService.export(value);});
  ipcMain.handle('desktop:presenter-open',(event,value)=>{trustedSender(event);return presenterService.open(value);});
  ipcMain.handle('desktop:presenter-update',(event,value)=>{trustedSender(event);return presenterService.update(value);});
  ipcMain.handle('desktop:presenter-close',event=>{trustedSender(event);return presenterService.close();});
  ipcMain.on('presenter:command',(event,value)=>presenterService.accept(event,value));
  ipcMain.handle('desktop:open-external',async(event,value)=>{trustedSender(event);if(typeof value?.url!=='string'||value.url.length>8192)throw new Error('링크 주소가 잘못되었습니다.');const url=new URL(value.url);if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password)throw new Error('이 링크 형식은 열 수 없습니다.');await shell.openExternal(url.href);return {opened:true};});
  ipcMain.handle('desktop:clipboard-read', event => { trustedSender(event); return nativeClipboard.read(); });
  ipcMain.handle('desktop:clipboard-write-text', (event, text) => { trustedSender(event); return nativeClipboard.writeText(text); });
  ipcMain.handle('desktop:recovery-read', (event, value) => { trustedSender(event); return recovery.read(value || {}); });
  ipcMain.handle('desktop:recovery-write', (event, value) => { trustedSender(event); return recovery.write(value); });
  ipcMain.handle('desktop:recovery-clear', (event, value) => { trustedSender(event); return recovery.clear(value); });
  ipcMain.handle('desktop:agent-status', event => { trustedSender(event); return agentBridge.status(); });
  ipcMain.handle('desktop:agent-enabled', (event, enabled) => { trustedSender(event); return agentBridge.setEnabled(enabled); });
  ipcMain.on('desktop:agent-response', (event, value) => {
    try {
      trustedSender(event);
      const pending = typeof value?.requestId === 'string' && agentRequests.get(value.requestId);
      if (!pending || !value.result || typeof value.result !== 'object' || typeof value.result.ok !== 'boolean') return;
      if (Buffer.byteLength(JSON.stringify(value.result)) > 110 * 1024 * 1024) return;
      agentRequests.delete(value.requestId); clearTimeout(pending.timeout); pending.resolve(value.result);
    } catch { /* Malformed responses have no authority. */ }
  });
  ipcMain.handle('desktop:open-document', event => { trustedSender(event); return files.openDocument(); });
  ipcMain.handle('desktop:adopt-document', (event, value) => { trustedSender(event); return files.adoptDocument(value); });
  ipcMain.handle('desktop:save-document', (event, value) => { trustedSender(event); return files.saveDocument(value); });
  ipcMain.handle('desktop:presentation', (event, active) => {
    trustedSender(event);
    if (typeof active !== 'boolean') throw new TypeError('발표 상태가 올바르지 않습니다.');
    window.setFullScreen(active);
  });
  ipcMain.on('desktop:document-state', (event, value) => {
    try {
      trustedSender(event);
      validateSessionId(value?.sessionId);
      if (typeof value.title !== 'string' || value.title.length > 1000 || typeof value.dirty !== 'boolean'
          || (value.busy !== undefined && typeof value.busy !== 'boolean')
          || (value.composing !== undefined && typeof value.composing !== 'boolean')) return;
      if(typeof value.documentId!=='string'||!value.documentId.trim()||value.documentId.length>256)return;
      const replaced=state.sessionId!==value.sessionId;
      state = { sessionId: value.sessionId, documentId:value.documentId, title: value.title, dirty: value.dirty,
        busy: Boolean(value.busy), composing: Boolean(value.composing) };
      if(replaced){ioGrant=null;agentIO?.documentChanged();}
      void agentBridge.documentChanged().catch(error => { console.error('Unable to revoke document connection:', error.message); });
      avatarHost?.documentChanged();
      dataHost?.documentChanged();
      setWindowTitle();
    } catch { /* Untrusted/malformed state messages have no effect. */ }
  });
}

async function serveLocal(request) {
  try {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.protocol !== SCHEME || url.hostname !== 'editor'
        || url.username || url.password || url.port) return new Response('Not found', { status: 404 });
    const requested = decodeURIComponent(url.pathname);
    const relative = requested === '/' ? 'index.html' : requested.slice(1);
    const allow = ['PRIVACY.md', 'SUPPORT.md', 'examples/first-deck.json', 'index.html', 'styles.css', 'src/design-studio-ui.css', 'src/behavior-studio-ui.css', 'src/scene-studio-ui.css', 'src/avatar-ui.css', 'src/data-connector-ui.css', 'src/agent-io-permissions-ui.css', 'src/reuse-library-ui.css', 'src/responsive-ui.css', 'src/component-library-ui.css', 'src/web-authoring-ui.css', 'examples/document-contract-v0.1.json', 'examples/workbench-showcase.json', 'examples/motion-showcase.json', 'examples/business-showcase.json', 'examples/advanced-showcase.json'].includes(relative)
      || /^src\/[a-z\d-]+\.js$/i.test(relative)
      || /^assets\/brand\/[a-z\d-]+\.(png|svg|ico)$/i.test(relative)
      || /^assets\/ui\/[a-z\d-]+\.svg$/i.test(relative);
    const vendor = /^assets\/vendor\/[a-z\d-]+\.js$/i.test(relative);
    const target = path.resolve(ROOT, relative);
    if ((!allow && !vendor) || !target.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
    const data = await fs.readFile(target);
    const contentType = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.md': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
      '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[path.extname(target)];
    return new Response(data, { headers: { 'Content-Type': contentType, 'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response('Unable to load the local application resource', { status: error.code === 'ENOENT' ? 404 : 400 });
  }
}

async function handleClose(event){
  return confirmWindowClose(event,{getWindow:()=>window,getState:()=>state,isClosing:()=>closingPrompt,setClosing:value=>closingPrompt=value,hosts:[avatarHost,dataHost,agentIO],files,progress:progressService,dialog,readEditorState:()=>requestRenderer('readEditorState',{}),setDirty:value=>state.dirty=value});
}

function createWindow() {
  window = new BrowserWindow({ title: 'Vividly', width: 1440, height: 1000, minWidth: 1000, minHeight: 700,
    backgroundColor: '#eef1f5', show: false, autoHideMenuBar: true, icon: path.join(ROOT, 'assets/brand/vividly.ico'),
    webPreferences: { preload: path.join(ROOT, 'desktop/preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false,
      devTools: !app.isPackaged, allowRunningInsecureContent: false, webviewTag: false },
  });
  files = new DesktopFileService({ dialog, getWindow: () => window });
  assetBroker=new ApprovedAssetBroker({getGrant:currentIOGrant,dispatch:requestRenderer,chooseFile:createNativeAssetPicker({dialog,getWindow:()=>window,withDialog:operation=>files.withDialog(operation)}),decodeImage:createNativePngDecoder(nativeImage)});
  agentIO=new AgentIOService({getGrant:currentIOGrant,dispatch:requestRenderer,files,broker:assetBroker,rendererOperation:requestRenderer,onEvent:value=>{if(window&&!window.isDestroyed())window.webContents.send('desktop:agent-io-event',value);}});
  progressService=new DesktopProgressService({dialog,getWindow:()=>window,withDialog:operation=>files.withDialog(operation)});
  formDataService=new DesktopFormDataService({dialog,getWindow:()=>window,withDialog:operation=>files.withDialog(operation)});
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { void handleClose(event).catch(error => console.error('Unable to confirm window close:', error.message)); });
  window.on('closed', () => {
    avatarHost?.close();
    dataHost?.close();
    agentIO?.close();
    presenterService?.close();
    window = null;
    for (const pending of agentRequests.values()) { clearTimeout(pending.timeout); pending.reject(new Error('편집기 창이 닫혔습니다.')); }
    agentRequests.clear();
  });
  const createdWindow = window;
  createdWindow.once('ready-to-show', () => { if (!createdWindow.isDestroyed()) createdWindow.show(); });
  window.webContents.on('did-fail-load', (_event, code, description) => console.error('Application load failed', code, description));
  void window.loadURL(APP_URL);
  return window;
}

// Register startup without keeping the ESM entry module pending on app readiness.
app.whenReady().then(() => {
  avatarHost=new AvatarHost({ipcMain,safeStorage,file:path.join(app.getPath('userData'),'avatar','settings.json'),codexWorkspace:path.join(app.getPath('userData'),'codex-workspace'),dispatch:dispatchAgent,getSessionId:()=>state.sessionId,getWindow:()=>window,trustedSender,isClosing:()=>closingPrompt});
  dataHost=new DataHost({ipcMain,safeStorage,file:path.join(app.getPath('userData'),'data','sources.json'),dispatch:requestRenderer,getSessionId:()=>state.sessionId,getWindow:()=>window,trustedSender,isClosing:()=>closingPrompt});
  outputService=new DesktopExportService({BrowserWindow,dialog,getWindow:()=>window});
  presenterService=new PresenterService({BrowserWindow,onCommand:action=>command('presenter-'+action)});
  recovery = new RecoveryService({ directory: path.join(app.getPath('userData'), 'recovery'), isCurrent: sessionId => sessionId === state.sessionId });
  agentBridge = new AgentBridge({ directory: path.join(app.getPath('userData'), 'agent-bridge'), getSessionId: () => state.sessionId,
    dispatch: dispatchAgent, onStatus: agentStatus,
    launchConfig: descriptorPath => ({ command: process.execPath,
      args: [path.join(app.getAppPath(), 'desktop/mcp-adapter.bundle.cjs'), '--descriptor', descriptorPath], env: { ELECTRON_RUN_AS_NODE: '1' } }) });
  protocol.handle('html-slide', serveLocal);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      callback({ cancel: !(url.protocol === SCHEME && url.hostname === 'editor') && !['data:', 'blob:'].includes(url.protocol) });
    } catch { callback({ cancel: true }); }
  });
  registerIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '파일', submenu: [
      { label: '새 자료', accelerator: 'CmdOrCtrl+N', click: () => command('new') },
      { label: 'HTML 열기…', accelerator: 'CmdOrCtrl+O', click: () => command('open') },
      { type: 'separator' },
      { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('save-as') },
      { label:'내보내기…',accelerator:'CmdOrCtrl+Shift+E',click:()=>command('export') },
      { type: 'separator' }, { role: 'quit', label: '종료' },
    ] },
    { label: '발표', submenu: [{ label: '발표 시작', accelerator: 'F5', click: () => command('present') },{label:'발표자 화면으로 시작',click:()=>command('presenter')}] },
  ]));
  createWindow();
}).catch(error => {
  console.error('Unable to start Vividly:', error.message);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', event => {
  if (shutdownFinished) return;
  event.preventDefault(); shutdownFinished = true;
  Promise.allSettled([avatarHost?.close(),dataHost?.stopAndDrain(),agentIO?.close(),agentBridge?.stop(), recovery?.queue]).finally(() => app.quit());
});
