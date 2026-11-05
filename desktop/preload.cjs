const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('htmlSlideDesktop', Object.freeze({
  platform: process.platform,
  agentIO:Object.freeze({
    getStatus:()=>ipcRenderer.invoke('desktop:agent-io-getStatus'),
    chooseAsset:()=>ipcRenderer.invoke('desktop:agent-io-chooseAsset'),importAsset:value=>ipcRenderer.invoke('desktop:agent-io-importAsset',value),
    revokeFile:value=>ipcRenderer.invoke('desktop:agent-io-revokeFile',value),releaseAsset:value=>ipcRenderer.invoke('desktop:agent-io-releaseAsset',value),
    chooseOpenSource:()=>ipcRenderer.invoke('desktop:agent-io-chooseOpenSource'),allowCurrentSaveTarget:()=>ipcRenderer.invoke('desktop:agent-io-allowCurrentSaveTarget'),chooseSaveTarget:()=>ipcRenderer.invoke('desktop:agent-io-chooseSaveTarget'),
    revokePermission:value=>ipcRenderer.invoke('desktop:agent-io-revokePermission',value),renewPermission:value=>ipcRenderer.invoke('desktop:agent-io-renewPermission',value),setPresentPermission:value=>ipcRenderer.invoke('desktop:agent-io-setPresentPermission',value),
    onEvent:callback=>{if(typeof callback!=='function')throw TypeError('이벤트 수신 함수가 필요합니다.');const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop:agent-io-event',listener);return()=>ipcRenderer.removeListener('desktop:agent-io-event',listener);},
  }),
  listFonts: value => ipcRenderer.invoke('desktop:list-fonts',value),
  openDocument: () => ipcRenderer.invoke('desktop:open-document'),
  adoptDocument: value => ipcRenderer.invoke('desktop:adopt-document', value),
  saveDocument: value => ipcRenderer.invoke('desktop:save-document', value),
  setDocumentState: value => ipcRenderer.send('desktop:document-state', value),
  setPresentation: active => ipcRenderer.invoke('desktop:presentation', active),
  output:Object.freeze({preview:value=>ipcRenderer.invoke('desktop:output-preview',value),write:value=>ipcRenderer.invoke('desktop:output-write',value)}),
  presenter:Object.freeze({open:value=>ipcRenderer.invoke('desktop:presenter-open',value),update:value=>ipcRenderer.invoke('desktop:presenter-update',value),close:()=>ipcRenderer.invoke('desktop:presenter-close')}),
  openExternal:value=>ipcRenderer.invoke('desktop:open-external',value),
  progress:Object.freeze({save:value=>ipcRenderer.invoke('desktop:progress-save',value),open:()=>ipcRenderer.invoke('desktop:progress-open')}),
  formData:Object.freeze({save:value=>ipcRenderer.invoke('desktop:form-data-save',value)}),
  data:Object.freeze({
    listSources:()=>ipcRenderer.invoke('desktop:data-list'),configureSource:value=>ipcRenderer.invoke('desktop:data-configure',value),removeSource:value=>ipcRenderer.invoke('desktop:data-remove',value),
    readSample:value=>ipcRenderer.invoke('desktop:data-sample',value),prepare:value=>ipcRenderer.invoke('desktop:data-prepare',value),refresh:value=>ipcRenderer.invoke('desktop:data-refresh',value),
    applyProposal:value=>ipcRenderer.invoke('desktop:data-apply',value),cancel:value=>ipcRenderer.invoke('desktop:data-cancel',value),undoLast:value=>ipcRenderer.invoke('desktop:data-undo',value),getStatus:()=>ipcRenderer.invoke('desktop:data-status'),unlink:value=>ipcRenderer.invoke('desktop:data-unlink',value),
    onEvent:callback=>{if(typeof callback!=='function')throw new TypeError('이벤트 수신 함수가 필요합니다.');const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop:data-event',listener);return()=>ipcRenderer.removeListener('desktop:data-event',listener);},
  }),
  avatar:Object.freeze({
    checkCodex:()=>ipcRenderer.invoke('desktop:avatar-codex-check'),getStatus:()=>ipcRenderer.invoke('desktop:avatar-status'),getSettings:()=>ipcRenderer.invoke('desktop:avatar-settings'),
    configure:value=>ipcRenderer.invoke('desktop:avatar-configure',value),setEnabled:value=>ipcRenderer.invoke('desktop:avatar-enabled',value),
    start:value=>ipcRenderer.invoke('desktop:avatar-start',value),cancel:value=>ipcRenderer.invoke('desktop:avatar-cancel',value),
    applyProposal:value=>ipcRenderer.invoke('desktop:avatar-apply',value),undoLast:value=>ipcRenderer.invoke('desktop:avatar-undo',value),
    onEvent:callback=>{if(typeof callback!=='function')throw new TypeError('이벤트 수신 함수가 필요합니다.');const listener=(_event,value)=>callback(value);ipcRenderer.on('desktop:avatar-event',listener);return()=>ipcRenderer.removeListener('desktop:avatar-event',listener);},
  }),
  clipboard: Object.freeze({
    read: () => ipcRenderer.invoke('desktop:clipboard-read'),
    writeText: text => ipcRenderer.invoke('desktop:clipboard-write-text', text),
  }),
  recovery: Object.freeze({
    read: value => ipcRenderer.invoke('desktop:recovery-read', value),
    write: value => ipcRenderer.invoke('desktop:recovery-write', value),
    clear: value => ipcRenderer.invoke('desktop:recovery-clear', value),
  }),
  agent: Object.freeze({
    getStatus: () => ipcRenderer.invoke('desktop:agent-status'),
    setEnabled: enabled => ipcRenderer.invoke('desktop:agent-enabled', enabled),
    respond: value => ipcRenderer.send('desktop:agent-response', value),
    onRequest: callback => {
      if (typeof callback !== 'function') throw new TypeError('요청 수신 함수가 필요합니다.');
      const listener = (_event, request) => callback(request);
      ipcRenderer.on('desktop:agent-request', listener);
      return () => ipcRenderer.removeListener('desktop:agent-request', listener);
    },
    onStatus: callback => {
      if (typeof callback !== 'function') throw new TypeError('상태 수신 함수가 필요합니다.');
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('desktop:agent-status', listener);
      return () => ipcRenderer.removeListener('desktop:agent-status', listener);
    },
  }),
  onCommand: callback => {
    if (typeof callback !== 'function') throw new TypeError('명령 수신 함수가 필요합니다.');
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('desktop:command', listener);
    return () => ipcRenderer.removeListener('desktop:command', listener);
  },
}));
