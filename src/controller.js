/** Application boundary for the human UI and transport-neutral JSON command callers. */
import { EditorStore, cloneDocument, createBlankDocument, getDocumentCapabilities } from './model.js';
import { evaluateCommand, evaluateCommands, validateCommand, getCommandCatalog, COMMAND_CONTRACT_VERSION } from './commands.js';
import { READ_CONTRACT_VERSION, captureEditorState, validateReadTarget } from './editor-read.js';
import { GUARDED_COMMAND_VERSION, BATCH_CONTRACT_VERSION, validateGuardedCommand, validateGuardedBatch, validateGuardedHistory } from './editor-guard.js';
import { summarizeChanges } from './document-diff.js';
import { resolveElementAppearance } from './render.js';
import { BUSINESS_SCHEMA, diagnoseDocument } from './business-model.js';
import { ADVANCED_SCHEMA } from './motion-model.js';
import { DESIGN_SCHEMA } from './design-model.js';
import{BEHAVIOR_SCHEMA}from './behavior-model.js';
import{SCENE_SCHEMA}from'./scene-model.js';
import {AUTHORING_SCHEMA,componentImpact} from './component-library-model.js';
import{AUDIO_MIME_TYPES}from'./audio-model.js';
import{projectCommittedDocument}from'./read-projection.js';
import{OperationLedger,operationFailure}from'./operation-ledger.js';
import{buildCommandPreview}from'./preview-diff.js';
import{freezeStagedAssets,stagedAssetManifest,createTrustedAssetBundle,evaluateCommandsWithAssets}from'./trusted-assets.js';
import{creationRequestSeed}from'./creation-context.js';
import{prepareLibraryImport,summarizeLibraryImpact}from'./reuse-library.js';

const labels = {
  'design.set_tokens':'브랜드 토큰 편집','design.recipe_upsert':'공용 스타일 편집','design.recipe_apply':'공용 스타일 적용','design.recipe_detach':'스타일 연결 해제','design.recipe_remove':'공용 스타일 삭제','design.set_overrides':'개체 스타일 편집','design.reset_overrides':'스타일 직접 서식 초기화','design.set_state':'상태별 스타일 편집','design.set_enabled':'상호작용 사용 설정','flow.create':'자동 배치 만들기','flow.set':'자동 배치 편집','flow.remove':'자동 배치 해제',
  'document.set_title': '자료 제목 변경', 'element.delete': '개체 삭제', 'element.move': '개체 앞뒤 순서 변경',
  'slide.delete': '슬라이드 삭제', 'slide.move': '슬라이드 순서 변경', 'slide.set_background': '슬라이드 배경 변경',
  'layout.library_ensure':'기본 레이아웃 추가','layout.library_replace':'마스터·레이아웃 변경 반영','layout.insert':'레이아웃 추가','layout.duplicate':'레이아웃 복제','layout.master_create':'마스터 추가','layout.master_update':'마스터 편집','layout.reset':'레이아웃 다시 설정','layout.fill_slot':'레이아웃 자리 채우기','slide.create_from_layout':'레이아웃으로 새 슬라이드','layout.update':'마스터 원본 편집','video.set_properties':'동영상 재생 설정',
  'layout.capture':'슬라이드 마스터 등록·갱신','layout.apply':'레이아웃 적용','layout.detach':'레이아웃 연결 해제','layout.delete':'레이아웃 삭제',
  'text.replace': '텍스트 편집', 'text.set_content': '텍스트 편집',
  'shape.set_kind': '도형 종류 변경', 'shape.set_stroke': '도형 테두리 변경', 'image.set_properties': '이미지 표시 변경',
  'element.set_states':'개체 상태 편집','document.set_motion_clips':'모션 씬 보관','slide.set_motions':'모션 편집','slide.set_interactions':'인터랙션 편집',
};
function unwrap(result) {
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, path: result.error.path });
  return result.value;
}

export class CommandController {
  #store;
  #instanceId;
  #activityProvider;
  #agentActorId;
  #viewRevision = 0;
  #viewport = { mode: 'fit', scale: 1 };
  #presentation = null;
  #agentGrant=null;
  #ioGrant=null;
  #ioOperations=new OperationLedger();
  #operations=new OperationLedger();
  #agentPreparationGate;
  #queue = [];
  #draining = false;
  constructor(document = createBlankDocument(), { instanceId = `editor-${globalThis.crypto.randomUUID()}`, activityProvider = () => ({}), agentActorId = 'local-agent', agentPreparationGate=()=>new Promise(resolve=>setTimeout(resolve,0)) } = {}) {
    if (typeof instanceId !== 'string' || !instanceId.trim() || instanceId.length > 256 || typeof activityProvider !== 'function') throw new Error('유효한 내부 편집기 설정이 필요합니다.');
    this.#instanceId = instanceId;
    if (typeof agentActorId !== 'string' || !agentActorId.trim() || agentActorId.length > 256) throw new Error('유효한 내부 actor ID가 필요합니다.');
    this.#agentActorId = agentActorId; // Trusted host binding, never a caller-supplied request field.
    if(typeof agentPreparationGate!=='function')throw Error('Trusted agent preparation scheduler required');
    this.#agentPreparationGate=agentPreparationGate;
    this.#activityProvider = activityProvider;
    this.#store = new EditorStore(document, { evaluateCommand });
  }
  #viewKey() { return JSON.stringify([this.#store.activeSlideId, this.#store.selectedIds, this.#viewport, this.#presentation]); }
  #dispatch(action) {
    // UI jobs remain synchronous. Incoming read/command jobs use the same run-to-completion FIFO.
    // No await, IME wait queue, UI flush or caller-provided callback is exposed here.
    if (this.#draining) throw new Error('편집 작업 중 재진입할 수 없습니다.');
    const entry = { action };
    this.#queue.push(entry);
    this.#draining = true;
    try {
      while (this.#queue.length) {
        const job = this.#queue.shift();
        const session = this.#store.sessionId, view = this.#viewKey();
        try { job.value = job.action(); } catch (error) { job.error = error; }
        finally {
          if (session !== this.#store.sessionId) this.#viewRevision = 0;
          else if (view !== this.#viewKey()) this.#viewRevision += 1;
        }
      }
    } finally { this.#draining = false; }
    if (entry.error) throw entry.error;
    return entry.value;
  }
  // UI reads retain the original draft identities (textarea callbacks compare session identity).
  // Transport callers use detached read APIs below; these live UI getters are not snapshots.
  get document() { return this.#store.document; }
  get activeSlide() { return this.#store.activeSlide; }
  get activeSlideId() { return this.#store.activeSlideId; }
  get selectedElement() { return this.#store.selectedElement; }
  get selectedId() { return this.#store.selectedId; }
  get selectedIds() { return this.#store.selectedIds; }
  get selectedElements() { return this.#store.selectedElements; }
  get selectionBounds() { return this.#store.selectionBounds; }
  get sessionId() { return this.#store.sessionId; }
  get instanceId() { return this.#instanceId; }
  get editorSessionId() { return this.#store.sessionId; }
  get contentRevision() { return this.#store.revision; }
  get viewRevision() { return this.#viewRevision; }
  get revision() { return this.#store.revision; }
  get textSession() { return this.#store.textSession; }
  get transformSession() { return this.#store.transformSession; }
  get isDirty() { return this.#store.isDirty; }
  get canUndo() { return this.#store.canUndo; }
  get canRedo() { return this.#store.canRedo; }
  get undoCount() { return this.#store.undoCount; }
  get redoCount() { return this.#store.redoCount; }

  /** Trusted local UI entry. May finish human drafts; adapters must use executeGuarded instead. */
  execute(input) {
    return this.#dispatch(() => this.#execute(input));
  }
  #checkGuard(request, {libraryImportOwner=false,componentLibraryOwner=false}={}) {
    const fail = (code, message, path, details = {}) => ({ ok: false, error: { code, message, path, ...details, mutated: false } });
    const handle = { instanceId: this.#instanceId, editorSessionId: this.#store.sessionId, documentId: this.#store.document.id };
    const targetError = validateReadTarget(request.target, handle);
    if (targetError) return { ok: false, error: { ...targetError, mutated: false } };
    // Read only. Never flush inputs, render, _ready(), finishText() or queue a delayed human action.
    const state = captureEditorState(this.#store, this.#activityProvider() ?? {}, this.#viewport, this.#presentation);
    const reasons=state.busy.reasons.filter(reason=>!(libraryImportOwner&&reason.kind==='libraryImport'||componentLibraryOwner&&reason.kind==='componentLibrary'));
    if (reasons.length) return fail('EDITOR_BUSY', '진행 중인 편집 또는 앱 작업을 마친 뒤 다시 조회해 주세요.', '$.editor',
      { busy: {active:true,reasons}, retryAfterMs: 200 });
    if (request.expectedRevision !== this.#store.revision)
      return fail('REVISION_CONFLICT', '확정 문서가 바뀌었습니다. 다시 조회해 주세요.', '$.expectedRevision',
        { expectedRevision: request.expectedRevision, currentRevision: this.#store.revision });
    if (request.targeting === 'selection') {
      if (request.expectedViewRevision !== this.#viewRevision)
        return fail('VIEW_REVISION_CONFLICT', '선택 또는 화면 상태가 바뀌었습니다. 다시 조회해 주세요.', '$.expectedViewRevision',
          { expectedViewRevision: request.expectedViewRevision, currentViewRevision: this.#viewRevision });
      const selected = new Set(this.#store.selectedIds);
      if ((request.commands ?? [request.command]).some(command => !selected.has(command.params.elementId)))
        return fail('SELECTION_CONFLICT', '현재 선택과 요청한 개체가 다릅니다.', request.commands ? '$.commands' : '$.command.params.elementId');
    }
    return null;
  }
  /** Async agent boundary. Detached preparation may yield; the actual commit always checks again. */
  async executeGuarded(input) {
    const checked = validateGuardedCommand(input);
    if (!checked.ok) return checked;
    const request = checked.value;
    const prepared = this.#dispatch(() => {
      const rejected = this.#checkGuard(request);
      return rejected ?? { ok: true, value: cloneDocument(this.#store.document) };
    });
    if (!prepared.ok) return prepared;
    // Validate on a detached base. Await establishes the preparation/commit boundary used by adapters.
    // Never replace the live document with this candidate: the queued commit reevaluates current state.
    const candidate = await evaluateCommand(prepared.value, request.command);
    const result = this.#dispatch(() => {
      const rejected = this.#checkGuard(request);
      if (rejected) return rejected;
      if (!candidate.ok) return { ok: false, error: { ...candidate.error, mutated: false } };
      const previousRevision = this.#store.revision;
      const applied = this.#execute(request.command, this.#agentContext(request));
      if (!applied.ok) return { ok: false, error: { ...applied.error, mutated: false } };
      return { ok: true, value: { ...applied.value, contractVersion: GUARDED_COMMAND_VERSION,
        ...request.target, operationId: request.operationId, previousRevision, contentRevision: this.#store.revision } };
    });
    // dispatch has finalized any view change; no await or callback occurs before this metadata is added.
    if (result.ok) result.value.viewRevision = this.#viewRevision;
    return result;
  }
  #agentContext(request) {
    return { source: 'agent', actorId: this.#agentActorId, operationId: request.operationId, commands: request.commands };
  }
  /** All document commands commit together or have no effect. External I/O is outside this contract. */
  async applyCommands(input,{signal,grantId,ioGrantId,stagedAssets}={}) {
    const checked = validateGuardedBatch(input);
    if (!checked.ok) return checked;
    const request = checked.value;
    const prepared = this.#dispatch(() => this.#agentStop(signal,grantId,ioGrantId) ?? this.#checkGuard(request) ?? { ok: true, value: cloneDocument(this.document) });
    if (!prepared.ok) return prepared;
    if(stagedAssets!==undefined&&ioGrantId===undefined)return operationFailure('PERMISSION_DENIED','승인 자산에는 현재 연결 권한이 필요합니다.');
    let bundle=null;
    try{if(grantId!==undefined||ioGrantId!==undefined||stagedAssets!==undefined)bundle=await createTrustedAssetBundle(prepared.value,request.commands,stagedAssets);}
    catch(error){return operationFailure(error.code||'INVALID_STAGED_ASSET',error.message);}
    const creationSeed=await creationRequestSeed(request),creationOptions={creationSeed};
    const candidate = await (bundle?evaluateCommandsWithAssets(prepared.value,request.commands,bundle,creationOptions):evaluateCommands(prepared.value,request.commands,creationOptions));
    await this.#agentPreparationGate({method:'applyCommands',operationId:request.operationId,signal});
    const result = this.#dispatch(() => {
      const rejected = this.#agentStop(signal,grantId,ioGrantId) ?? this.#checkGuard(request);
      if (rejected) return rejected;
      if (!candidate.ok) return { ok: false, error: { ...candidate.error, mutated: false } };
      // Same queue and CAS as a single command. Reevaluate the current base before the one swap.
      const evaluated = bundle?evaluateCommandsWithAssets(this.document,request.commands,bundle,creationOptions):evaluateCommands(this.document,request.commands,creationOptions);
      if (!evaluated.ok) return { ok: false, error: { ...evaluated.error, mutated: false } };
      const before = this.document, after = evaluated.value.document;
      const previousRevision = this.revision, summary = summarizeChanges(before, after);
      let changed = false;
      if (!request.dryRun) {
        // Match existing delete-slide navigation: choose a surviving prior neighbour, then a next one.
        let nextSlideId;
        if (!after.slides.some(slide => slide.id === this.activeSlideId)) {
          const index = before.slides.findIndex(slide => slide.id === this.activeSlideId);
          const surviving = new Set(after.slides.map(slide => slide.id));
          nextSlideId = [...before.slides.slice(0, index).reverse(), ...before.slides.slice(index + 1)]
            .find(slide => surviving.has(slide.id))?.id;
        }
        changed = this.#store.commitCandidate(after, request.label, this.#agentContext(request), nextSlideId);
      }
      return { ok: true, value: { contractVersion: BATCH_CONTRACT_VERSION, ...request.target,
        operationId: request.operationId, dryRun: request.dryRun, wouldChange: evaluated.value.changed, changed,
        previousRevision, contentRevision: this.revision, undoEntryId: changed ? this.#store.topUndoEntryId : null,
        summary,...(request.dryRun?{preview:buildCommandPreview(before,after,{baseRevision:previousRevision})}:{}), createdIds: evaluated.value.createdIds||{}, dirty: this.isDirty } };
    });
    if (result.ok) result.value.viewRevision = this.#viewRevision;
    return result;
  }
  async #historyGuarded(input, direction,{signal,grantId,ioGrantId}={}) {
    const checked = validateGuardedHistory(input);
    if (!checked.ok) return checked;
    const request = checked.value;
    const checkTop = () => {
      const rejected = this.#agentStop(signal,grantId,ioGrantId) ?? this.#checkGuard(request);
      if (rejected) return rejected;
      const currentTopEntryId = direction === 'undo' ? this.#store.topUndoEntryId : this.#store.topRedoEntryId;
      if (request.expectedTopEntryId !== currentTopEntryId) return { ok: false, error: {
        code: 'HISTORY_CONFLICT', message: '맨 위 편집 이력이 바뀌었습니다. 다시 조회해 주세요.', path: '$.expectedTopEntryId',
        expectedTopEntryId: request.expectedTopEntryId, currentTopEntryId, mutated: false } };
      return { ok: true };
    };
    const prepared = this.#dispatch(checkTop);
    if (!prepared.ok) return prepared;
    await this.#agentPreparationGate({method:direction,operationId:request.operationId,signal});
    const result = this.#dispatch(() => {
      const rejected = checkTop();
      if (!rejected.ok) return rejected;
      const previousRevision = this.revision;
      const changed = this.#store[direction]();
      return { ok: true, value: { contractVersion: BATCH_CONTRACT_VERSION, ...request.target,
        operationId: request.operationId, direction, changed, historyEntryId: request.expectedTopEntryId,
        previousRevision, contentRevision: this.revision, dirty: this.isDirty } };
    });
    if (result.ok) result.value.viewRevision = this.#viewRevision;
    return result;
  }
  undoGuarded(input,options) { return this.#historyGuarded(input, 'undo',options); }
  redoGuarded(input,options) { return this.#historyGuarded(input, 'redo',options); }

  /** Trusted host binding only. The bridge assigns grantId; no public request may supply it. */
  setAgentGrant(grantId){return this.#dispatch(()=>{if(grantId!==null&&(typeof grantId!=='string'||!grantId.trim()||grantId.length>256))throw Error('Trusted grant ID required');this.#agentGrant=grantId===null?null:{grantId,editorSessionId:this.#store.sessionId};this.#operations.setScope(this.#agentGrant);return Boolean(this.#agentGrant);});}
  setIOGrant(ioGrantId){return this.#dispatch(()=>{if(ioGrantId!==null&&(typeof ioGrantId!=='string'||!ioGrantId.trim()||ioGrantId.length>256))throw Error('Trusted IO grant ID required');this.#ioGrant=ioGrantId===null?null:{grantId:ioGrantId,editorSessionId:this.#store.sessionId};this.#ioOperations.setScope(this.#ioGrant);return Boolean(this.#ioGrant);});}
  checkAgentGrant(context){return this.#dispatch(()=>{if(!context||context.editorSessionId!==this.#store.sessionId||context.grantId===undefined&&context.ioGrantId===undefined)return operationFailure('PERMISSION_DENIED','연결을 허용한 문서 세션이 아닙니다.');return this.#agentStop(undefined,context.grantId,context.ioGrantId)||{ok:true,value:{authorized:true}};});}
  #agentStop(signal,grantId,ioGrantId){if(grantId!==undefined&&(!this.#agentGrant||this.#agentGrant.grantId!==grantId||this.#agentGrant.editorSessionId!==this.#store.sessionId))return operationFailure('PERMISSION_DENIED','문서 연결 권한이 바뀌었습니다.');if(ioGrantId!==undefined&&(!this.#ioGrant||this.#ioGrant.grantId!==ioGrantId||this.#ioGrant.editorSessionId!==this.#store.sessionId))return operationFailure('PERMISSION_DENIED','파일·자산 승인 권한이 바뀌었습니다.');if(signal?.aborted)return operationFailure('CANCELLED_BEFORE_COMMIT','확정 전에 취소했습니다.');return null;}
  #operationScope(grantId,ioGrantId){const stopped=this.#agentStop(undefined,grantId,ioGrantId);if(stopped||grantId===undefined&&ioGrantId===undefined)return{error:stopped||operationFailure('PERMISSION_DENIED','현재 연결 권한이 필요합니다.')};return grantId!==undefined?{scope:{...this.#agentGrant},ledger:this.#operations}:{scope:{...this.#ioGrant},ledger:this.#ioOperations};}
  #operationRead(input,grantId,ioGrantId,cancel=false){return this.#dispatch(()=>{const allowed=['target','operationId'];if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||typeof input.operationId!=='string'||!input.operationId.trim()||input.operationId.length>256)return operationFailure('INVALID_REQUEST','명시적인 대상과 작업 ID가 필요합니다.');if(input.target===undefined)return operationFailure('INVALID_TARGET','명시적인 문서 대상이 필요합니다.');const current={instanceId:this.#instanceId,editorSessionId:this.#store.sessionId,documentId:this.document.id},error=validateReadTarget(input.target,current);if(error)return{ok:false,error:{...error,mutated:false}};const binding=this.#operationScope(grantId,ioGrantId);if(binding.error)return binding.error;return binding.ledger[cancel?'cancel':'lookup'](input.operationId,binding.scope);});}
  readOperation(input,{grantId,ioGrantId}={}){return this.#operationRead(input,grantId,ioGrantId);}
  cancelOperation(input,{grantId,ioGrantId}={}){return this.#operationRead(input,grantId,ioGrantId,true);}
  async invokeOperation(method,input,{signal,grantId,ioGrantId,stagedAssets}={}){
    if(!['applyCommands','undoGuarded','redoGuarded'].includes(method))return operationFailure('INVALID_REQUEST','지원하는 확정 작업을 선택하세요.');
    const binding=this.#dispatch(()=>this.#operationScope(grantId,ioGrantId));if(binding.error)return binding.error;
    if(typeof input?.operationId!=='string'||!input.operationId.trim()||input.operationId.length>256||input.target===undefined)return operationFailure('INVALID_REQUEST','명시적 대상과 작업 ID가 필요합니다.');
    const handle={instanceId:this.#instanceId,editorSessionId:this.#store.sessionId,documentId:this.document.id},error=validateReadTarget(input.target,handle);if(error)return{ok:false,error:{...error,mutated:false}};
    let entries;try{entries=freezeStagedAssets(stagedAssets);if(method!=='applyCommands'&&entries.length)return operationFailure('INVALID_REQUEST','이력 명령에는 승인 자산을 넣을 수 없습니다.');if(entries.length&&ioGrantId===undefined)return operationFailure('PERMISSION_DENIED','승인 자산에는 파일·자산 권한이 필요합니다.');}catch(error){return operationFailure(error.code||'INVALID_STAGED_ASSET',error.message);}
    const ledger=binding.ledger,started=await ledger.begin({operationId:input.operationId,method,request:input,trustedFingerprint:stagedAssetManifest(entries)},binding.scope);
    if(started.error){if(started.record)ledger.complete(started.record,started.error);return started.error;}const record=started.record;
    if(started.replayed){const result=await record.promise;return{...structuredClone(result),receipt:{...ledger.receipt(record),result:undefined,replayed:true}};}
    const cancel=()=>{record.cancelRequested=true;record.abort.abort();};if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});let result;
    try{result=await this[method](input,{signal:record.abort.signal,grantId,ioGrantId,...(stagedAssets!==undefined?{stagedAssets:entries}:{})});}catch(error){result={ok:false,error:{code:'OUTCOME_UNKNOWN',message:error.message,outcomeUnknown:true}};}finally{signal?.removeEventListener('abort',cancel);}
    ledger.complete(record,result);const receipt=ledger.receipt(record);delete receipt.result;return{...record.result,receipt:{...receipt,replayed:false}};
  }
  async previewCommands(input,options={}){try{return await this.applyCommands({...input,dryRun:true},options);}catch(error){return operationFailure(error.code||'PREVIEW_FAILED',error.message);}}
  readProjection(input={}){return this.#dispatch(()=>{const handle={instanceId:this.#instanceId,editorSessionId:this.#store.sessionId,documentId:this.document.id,contentRevision:this.#store.revision,viewRevision:this.#viewRevision},error=validateReadTarget(input.target,handle);if(error)return{ok:false,error:{...error,mutated:false}};try{return{ok:true,value:projectCommittedDocument(this.#store.document,input,handle)};}catch(error){return operationFailure(error.code||'INVALID_READ',error.message,{path:error.path||'$'});}});}

  #execute(input, context) {
    const checked = validateCommand(input);
    if (!checked.ok) return checked;
    if (this.textSession?.composing || this.transformSession) return { ok: false, error: {
      code: 'EDITOR_BUSY', message: this.textSession?.composing ? '한글 조합이 끝난 뒤 변경할 수 있습니다.' : '현재 개체 조작을 완료하거나 취소해 주세요.', path: '$.editor', commandId: checked.value.id,
    } };
    // Reject bad targets/values before _ready() can commit or close a human text draft.
    const preview = evaluateCommand(this.textSession ? this.#store.snapshot() : this.document, checked.value);
    if (!preview.ok) return preview;
    const { id, params } = checked.value;
    let nextSlideId;
    if (id === 'slide.delete' && this.document.slides.length > 1 && params.slideId === this.activeSlideId) {
      const index = this.document.slides.findIndex(slide => slide.id === params.slideId);
      nextSlideId = this.document.slides[index === 0 ? 1 : index - 1].id;
    }
    try {
      // _ready() commits text through text.replace, then reevaluates against that committed document.
      const changed = this.#store.applyCommand(checked.value, labels[id] ?? '개체 속성 변경', nextSlideId, context);
      return { ok: true, value: { commandId: id, document: cloneDocument(this.document), changed,...(preview.value.createdIds?{createdIds:preview.value.createdIds}:{}) } };
    } catch (error) {
      if (!error.commandError) throw error;
      return { ok: false, error: error.commandError };
    }
  }
  #read(target, includeDocument, includeHistory = false, includeResolvedStyles = false) {
    return this.#dispatch(() => {
      const handle = { instanceId: this.#instanceId, editorSessionId: this.#store.sessionId, documentId: this.#store.document.id };
      const error = validateReadTarget(target, handle);
      if (error) return { ok: false, error };
      const value = { contractVersion: READ_CONTRACT_VERSION, ...handle,
        contentRevision: this.#store.revision, viewRevision: this.#viewRevision };
      // Clone only committed state. snapshot() includes text drafts and rejects IME/transform.
      if (includeDocument) value.document = cloneDocument(this.#store.document);
      if(includeDocument&&[BUSINESS_SCHEMA,ADVANCED_SCHEMA,DESIGN_SCHEMA,BEHAVIOR_SCHEMA,SCENE_SCHEMA,AUTHORING_SCHEMA].includes(this.#store.document.schemaVersion))value.diagnostics=diagnoseDocument(this.#store.document);
      if (includeResolvedStyles || (includeDocument && (this.#store.document.theme||this.#store.document.styleRecipes||this.#store.document.styleTokens))) {
        value.resolvedStyles = this.#store.document.slides.flatMap(slide => slide.elements.map(element => ({
          slideId: slide.id, elementId: element.id,
          appearance: Object.fromEntries(Object.entries(resolveElementAppearance(element, this.#store.document)).filter(([, value]) => value !== undefined)),
        })));
      }
      if (includeHistory) value.history = this.#store.historyMetadata();
      value.state = captureEditorState(this.#store, this.#activityProvider() ?? {}, this.#viewport, this.#presentation);
      return { ok: true, value };
    });
  }
  readCommittedSnapshot(target) { return this.#read(target, true); }
  readEditorState(target) { return this.#read(target, false); }
  readHistory(target) { return this.#read(target, false, true); }
  readResolvedStyles(target) { return this.#read(target, false, false, true); }
  readCapabilities() { return { ok: true, value: {
    ...getDocumentCapabilities(), commandContractVersion: COMMAND_CONTRACT_VERSION,
    creation:{enabled:true,clientRef:{form:'{$ref:clientRef}',scope:'earlier commands in the same batch; ID reference fields only',idMap:'createdIds',stablePreview:'same target, revision, operationId and command payload'},idAuthority:'application',duplicate:'shared author copy/import reference remapping'},
    reuse:{command:'library.import',atomic:true,sharedUndo:true,definitions:['components','pages','forms','masters','layouts','styles','assets'],
      references:'Closed typed ID graph; source pages, form definitions and authored initial values are remapped together. Target ID equality alone is never a source-page match.',
      runtimeValues:'Never copied from presentation or browser storage.',assets:'Use already approved document assets; command payloads do not authorize file paths or raw asset bytes.'},
    commands: getCommandCatalog()
  } }; }
  setViewport({ mode, scale }) {
    return this.#dispatch(() => {
      if (!['fit', 'fixed'].includes(mode) || !Number.isFinite(scale) || scale <= 0) throw new Error('유효한 표시 배율이 필요합니다.');
      this.#viewport = { mode, scale };
    });
  }
  setPresentation(presentation) {
    return this.#dispatch(() => {
      if (presentation !== null && !this.#store.document.slides.some(slide => slide.id === presentation?.slideId)) throw new Error('발표 슬라이드를 찾을 수 없습니다.');
      this.#presentation = presentation === null ? null : { slideId: presentation.slideId };
    });
  }
  run(id, params) { return unwrap(this.execute({ id, params })).changed; }
  captureComponent({slideId=this.activeSlideId,elementIds=this.selectedIds,name,componentId=this.#store._freshId('component')}={}){this.run('component.capture',{componentId,slideId,elementIds,name});return componentId;}
  insertComponent(componentId,{slideId=this.activeSlideId,x,y,width,height,instanceId=this.#store._freshId('component-instance')}={}){const definition=this.document.componentLibrary?.find(d=>d.id===componentId);if(!definition)throw Error('컴포넌트 원본을 찾을 수 없습니다.');if(width===undefined&&height===undefined){const factor=Math.min(1,Math.max(1,this.document.canvas.width-60)/definition.width,Math.max(1,this.document.canvas.height-60)/definition.height);width=definition.width*factor;height=definition.height*factor;}else if(width===undefined)width=definition.width*height/definition.height;else if(height===undefined)height=definition.height*width/definition.width;x??=(this.document.canvas.width-width)/2;y??=(this.document.canvas.height-height)/2;this.run('component.insert',{componentId,instanceId,slideId,x,y,...(width!==undefined?{width}:{}),...(height!==undefined?{height}:{})});const instance=this.document.slides.find(s=>s.id===slideId)?.componentInstances?.find(i=>i.id===instanceId);if(slideId===this.activeSlideId&&instance)this.#dispatch(()=>this.#store.selectElements([instance.wrapperId||Object.values(instance.elementMap)[0]]));return instanceId;}
  #componentGuard(options={}){const expectedRevision=options.expectedRevision??this.revision,editorSessionId=options.expectedSessionId??this.editorSessionId;return this.#checkGuard({target:{instanceId:this.instanceId,editorSessionId,documentId:this.document.id},expectedRevision,targeting:'ids'},{componentLibraryOwner:true});}
  previewComponentUpdate(componentId,params,options={}){return this.#dispatch(()=>{const rejected=this.#componentGuard(options);if(rejected)return rejected;const candidate=evaluateCommand(this.document,{id:'component.update',params:{componentId,...params}});if(!candidate.ok)return candidate;return{ok:true,value:{changed:candidate.value.changed,impact:componentImpact(this.document,candidate.value.document),contentRevision:this.revision,editorSessionId:this.editorSessionId}};});}
  updateComponent(componentId,params,options={}){return this.#dispatch(()=>{const rejected=this.#componentGuard(options);if(rejected)return rejected;const changed=this.#store.applyCommand({id:'component.update',params:{componentId,...params}},'컴포넌트 원본 반영');return{ok:true,value:{changed,contentRevision:this.revision,editorSessionId:this.editorSessionId}};});}
  detachComponent(slideId,instanceId){return this.run('component.detach',{slideId,instanceId});}
  removeComponent(componentId){return this.run('component.remove',{componentId});}
  setTitle(title) { return this.run('document.set_title', { title }); }
  setGeometry(elementId, geometry) { return this.run('element.set_geometry', { elementId, geometry }); }
  setFill(elementId, fill) { return this.run('shape.set_fill', { elementId, fill }); }
  setStroke(elementId, stroke) { return this.run('shape.set_stroke', { elementId, stroke }); }
  setShapeKind(elementId, shape) { return this.run('shape.set_kind', { elementId, shape }); }
  setShapeAdjustments(elementId,adjustments){return this.run('shape.set_adjustments',{elementId,adjustments});}
  setShapePath(elementId,path){return this.run('shape.set_path',{elementId,path});}
  setSlideBackground(slideId, background) { return this.run('slide.set_background', { slideId, background }); }
  setImageProperties(elementId, properties) { return this.run('image.set_properties', { elementId, properties }); }
  setElementFlags(elementId, properties) { return this.run('element.set_properties', { elementId, properties }); }
  setRotation(elementId, rotation) { return this.run('element.set_rotation', { elementId, rotation }); }
  setVisualStyle(elementId, style) { return this.run('element.set_style', { elementId, style }); }
  setStyleTokens(tokens){return this.run('design.set_tokens',{tokens});}
  upsertStyleRecipe(recipe){return this.run('design.recipe_upsert',{recipe});}
  applyStyleRecipe(elementIds,recipeId,keepOverrides=false){return this.run('design.recipe_apply',{elementIds,recipeId,keepOverrides});}
  detachStyleRecipe(elementIds){return this.run('design.recipe_detach',{elementIds});}
  removeStyleRecipe(recipeId){return this.run('design.recipe_remove',{recipeId});}
  setDesignOverrides(elementIds,appearance,replace=false){return this.run('design.set_overrides',{elementIds,appearance,replace});}
  resetDesignOverrides(elementIds,section='all'){return this.run('design.reset_overrides',{elementIds,section});}
  setDesignState(elementIds,state,appearance){return this.run('design.set_state',{elementIds,state,appearance});}
  setDesignEnabled(elementIds,enabled){return this.run('design.set_enabled',{elementIds,enabled});}
  createFlow(elementIds,flow,{containerId='flow-'+globalThis.crypto.randomUUID(),slideId=this.activeSlideId,name}={}){this.run('flow.create',{elementIds,flow,containerId,slideId,...(name?{name}:{})});this.#dispatch(()=>this.#store._selectAfterCommit(containerId));return containerId;}
  setFlow(elementId,flow){return this.run('flow.set',{elementId,flow});}
  removeFlow(elementId){return this.run('flow.remove',{elementId});}
  setTheme(theme) { return this.run('document.set_theme', { theme }); }
  setScene(slideId,scene){return this.run('scene.set_slide',{slideId,scene});}
  setSceneWithAssets(slideId,scene,assets=[]){return this.#dispatch(()=>{const prepared=cloneDocument(scene),incoming=[],map=new Map(),referenced=new Set((prepared.audio||[]).map(a=>a.assetId));for(const asset of assets){if(!AUDIO_MIME_TYPES.includes(asset.mimeType)||!referenced.has(asset.id))throw Error('장면에서 사용하는 음향 자산만 추가할 수 있습니다.');const known=[...this.document.assets,...incoming].find(a=>a.mimeType===asset.mimeType&&a.sha256===asset.sha256&&a.dataBase64===asset.dataBase64);if(known)map.set(asset.id,known.id);else{incoming.push(cloneDocument(asset));map.set(asset.id,asset.id);}}for(const audio of prepared.audio||[])audio.assetId=map.get(audio.assetId)||audio.assetId;return this.#store._applyWithAssets({id:'scene.set_slide',params:{slideId,scene:prepared}},incoming,'장면 이동·접촉·표현 편집');});}
  setBehaviorVariables(variables){return this.run('behavior.set_variables',{variables});}
  setBehaviorSlide(slideId,behavior){return this.run('behavior.set_slide',{slideId,behavior});}
  setBehaviorRules(slideId,rules){return this.run('behavior.set_rules',{slideId,rules});}
  setBehaviorMachines(slideId,machines){return this.run('behavior.set_machines',{slideId,machines});}
  setBehaviorBindings(slideId,bindings){return this.run('behavior.set_bindings',{slideId,bindings});}
  setBehaviorInputs(slideId,inputs){return this.run('behavior.set_inputs',{slideId,inputs});}
  setVariables(variables) { return this.run('document.set_variables', { variables }); }
  setMotions(slideId, motions) { return this.run('slide.set_motions', { slideId, motions }); }
  setInteractions(slideId, interactions) { return this.run('slide.set_interactions', { slideId, interactions }); }
  setTransition(slideId, transition, advanceAfter) { return this.run('slide.set_transition', { slideId, transition, ...(advanceAfter === undefined ? {} : { advanceAfter }) }); }
  setComponent(elementId, component) { return this.run('element.set_component', { elementId, component }); }
  setBinding(elementId, binding) { return this.run('element.set_binding', { elementId, binding }); }
  setStates(elementId, states) { return this.run('element.set_states', { elementId, states }); }
  setMotionClips(clips) { return this.run('document.set_motion_clips', { clips }); }
  setTable(elementId,table){return this.run('table.set_data',{elementId,table});}
  setChart(elementId,chart){return this.run('chart.set_data',{elementId,chart});}
  setConnector(elementId,connector){return this.run('connector.set_data',{elementId,connector});}
  setSvg(elementId,svg){return this.run('svg.set_data',{elementId,svg});}
  setRuns(elementId,runs){return this.run('text.set_runs',{elementId,runs});}
  setParagraphStyles(elementId,paragraphStyles){return this.run('text.set_paragraph_styles',{elementId,paragraphStyles});}
  formatTextRange(elementId,range,marks){return this.run('text.format_range',{elementId,range,marks});}
  insertMedia(element,assets,target){if(target)return this.fillLayoutSlot(target.slideId,target.slotKey,element,assets);return this.#dispatch(()=>{
    const incoming=[],map=new Map();
    for(const asset of assets){const existing=[...this.document.assets,...incoming].find(a=>a.mimeType===asset.mimeType&&a.sha256===asset.sha256&&a.dataBase64===asset.dataBase64);if(existing)map.set(asset.id,existing.id);else{incoming.push(asset);map.set(asset.id,asset.id);}}
    const prepared=cloneDocument(element);prepared.assetId=map.get(prepared.assetId)||prepared.assetId;if(prepared.video?.posterAssetId)prepared.video.posterAssetId=map.get(prepared.video.posterAssetId)||prepared.video.posterAssetId;
    const changed=this.#store._applyWithAssets({id:'elements.insert',params:{slideId:this.activeSlideId,elements:[prepared],assets:[]}},incoming,'동영상 삽입');if(changed)this.#store._selectAfterCommit(prepared.id);return changed;
  });}
  setVideo(elementId,video){return this.run('video.set_properties',{elementId,video});}
  updateLayout(layoutId,definition){const {assets=[],...fields}=definition;const referenced=new Set((fields.elements||[]).flatMap(e=>[e.assetId,e.video?.posterAssetId].filter(Boolean)));if(assets.some(a=>!referenced.has(a.id)))throw Error('마스터에 사용하지 않는 자산은 추가할 수 없습니다.');return this.#dispatch(()=>this.#store._applyWithAssets({id:'layout.update',params:{layoutId,...fields,assets:[]}},assets,'슬라이드 마스터 편집'));
  }
  captureLayout(slideId,name,layoutId=this.#store._freshId('layout'),placeholderIds){return this.run('layout.capture',{slideId,name,layoutId,...(placeholderIds===undefined?{}:{placeholderIds})});}
  applyLayout(slideIds,layoutId,{preset=false}={}){return this.run('layout.apply',{slideIds,layoutId,...(preset?{preset:true}:{})});}
  ensureLayoutLibrary(){return this.run('layout.library_ensure',{});}
  createSlideFromLayout(layoutId,{preset=false,afterSlideId=this.activeSlideId}={}){return this.#dispatch(()=>{const slideId=this.#store._freshId('slide');this.#store.applyCommand({id:'slide.create_from_layout',params:{layoutId,slideId,afterSlideId,...(preset?{preset:true}:{})}},'레이아웃으로 새 슬라이드',slideId);this.#store._selectAfterCommit(null);return slideId;});}
  resetLayout(slideIds){return this.run('layout.reset',{slideIds});}
  insertLayout(definition){const layoutId=definition.layoutId||this.#store._freshId('layout');this.run('layout.insert',{...definition,layoutId});return layoutId;}
  duplicateLayout(layoutId,newLayoutId=this.#store._freshId('layout'),name){this.run('layout.duplicate',{layoutId,newLayoutId,...(name?{name}:{})});return newLayoutId;}
  createLayoutMaster(definition){const masterId=definition.masterId||this.#store._freshId('layout-master');this.run('layout.master_create',{...definition,masterId});return masterId;}
  updateLayoutMaster(masterId,definition){return this.run('layout.master_update',{masterId,...definition});}
  #localLibraryGuard(options={}){
    const expectedRevision=options.expectedRevision??this.revision,expectedSessionId=options.expectedSessionId??this.editorSessionId;
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof expectedSessionId!=='string')return operationFailure('INVALID_TARGET','가져오기 대상 문서와 revision을 다시 조회하세요.');
    return this.#checkGuard({target:{instanceId:this.instanceId,editorSessionId:expectedSessionId,documentId:this.document.id},expectedRevision,targeting:'ids'},{libraryImportOwner:true});
  }
  #localLibraryTarget(options={}){
    if(options.expectedSessionId!==undefined&&options.expectedSessionId!==this.editorSessionId)return operationFailure('STALE_EDITOR_SESSION','문서 세션이 바뀌었습니다. 현재 대상을 다시 조회하세요.');
    if(options.expectedRevision!==undefined&&options.expectedRevision!==this.revision)return operationFailure('REVISION_CONFLICT','확정 문서가 바뀌었습니다. 다시 조회해 주세요.');
    return null;
  }
  #stageLocalLibrary(command,assets){
    const staged=cloneDocument(this.document),incoming=[];
    for(const asset of assets){const known=staged.assets.find(old=>old.id===asset.id);if(known){if(JSON.stringify(known)!==JSON.stringify(asset))throw Error('기존 자산 ID와 가져올 내용이 다릅니다.');}else{staged.assets.push(cloneDocument(asset));incoming.push(cloneDocument(asset));}}
    if(incoming.some(asset=>AUDIO_MIME_TYPES.includes(asset.mimeType)))staged.schemaVersion=staged.schemaVersion===AUTHORING_SCHEMA?AUTHORING_SCHEMA:SCENE_SCHEMA;
    const evaluated=evaluateCommand(staged,command);if(!evaluated.ok)throw Object.assign(Error(evaluated.error.message),evaluated.error);
    return {incoming,document:evaluated.value.document,changed:JSON.stringify(this.document)!==JSON.stringify(evaluated.value.document)};
  }
  #libraryValue(prepared,candidate){
    const slideIds=new Set(this.document.slides.map(slide=>slide.id)),formIds=new Set((this.document.webForms||[]).map(form=>form.id));
    return {changed:candidate.changed,summary:prepared.summary,mapping:prepared.mapping,
      addedSlideIds:candidate.document.slides.filter(slide=>!slideIds.has(slide.id)).map(slide=>slide.id),
      addedFormIds:(candidate.document.webForms||[]).filter(form=>!formIds.has(form.id)).map(form=>form.id),
      impact:summarizeLibraryImpact(this.document,candidate.document),contentRevision:this.revision,editorSessionId:this.editorSessionId};
  }
  /** Local approved source only: source bytes never enter public command or read metadata. */
  previewLibraryImport(source,selection,options={}){return this.#dispatch(()=>{const rejected=this.#localLibraryGuard(options);if(rejected)return rejected;try{const prepared=prepareLibraryImport(this.document,source,selection),candidate=this.#stageLocalLibrary({id:'library.import',params:prepared.params},prepared.assets);return {ok:true,value:this.#libraryValue(prepared,candidate)};}catch(error){return operationFailure(error.code||'LIBRARY_IMPORT_FAILED',error.message);}});}
  importLibrary(source,selection,options={}){return this.#dispatch(()=>{const rejected=this.#localLibraryGuard(options);if(rejected)return rejected;try{const prepared=prepareLibraryImport(this.document,source,selection),command={id:'library.import',params:prepared.params},candidate=this.#stageLocalLibrary(command,prepared.assets),value=this.#libraryValue(prepared,candidate),stale=this.#localLibraryGuard(options);if(stale)return stale;const changed=this.#store._applyWithAssets(command,candidate.incoming,'페이지·폼·디자인 가져오기');return {ok:true,value:{...value,changed,contentRevision:this.revision,editorSessionId:this.editorSessionId}};}catch(error){return operationFailure(error.code||'LIBRARY_IMPORT_FAILED',error.message);}});}
  #prepareLayoutLibrary({layoutMasters,layouts,assets=[]}){const referenced=new Set([...layoutMasters,...layouts].flatMap(l=>l.elements.flatMap(e=>[e.assetId,e.video?.posterAssetId].filter(Boolean))));if(assets.some(a=>!referenced.has(a.id)))throw Error('디자인 원본에서 사용하지 않는 자산은 추가할 수 없습니다.');const command={id:'layout.library_replace',params:{layoutMasters,layouts,assets:[]}};return {command,...this.#stageLocalLibrary(command,assets)};}
  previewLayoutLibrary(definition,options={}){return this.#dispatch(()=>{const rejected=this.#localLibraryTarget(options);if(rejected)return rejected;try{const candidate=this.#prepareLayoutLibrary(definition);return {ok:true,value:{changed:candidate.changed,impact:summarizeLibraryImpact(this.document,candidate.document),contentRevision:this.revision,editorSessionId:this.editorSessionId}};}catch(error){return operationFailure(error.code||'LIBRARY_PREVIEW_FAILED',error.message);}});}
  replaceLayoutLibrary(definition,options){return this.#dispatch(()=>{const rejected=this.#localLibraryTarget(options);if(rejected)throw Object.assign(Error(rejected.error.message),rejected.error);const candidate=this.#prepareLayoutLibrary(definition);return this.#store._applyWithAssets(candidate.command,candidate.incoming,'마스터·레이아웃 변경 반영');});}
  fillLayoutSlot(slideId,slotKey,element,assets=[]){return this.#dispatch(()=>{const incoming=[],map=new Map();for(const asset of assets){const known=[...this.document.assets,...incoming].find(a=>a.mimeType===asset.mimeType&&a.sha256===asset.sha256&&a.dataBase64===asset.dataBase64);if(known)map.set(asset.id,known.id);else{incoming.push(asset);map.set(asset.id,asset.id);}}const prepared=cloneDocument(element);if(prepared.assetId)prepared.assetId=map.get(prepared.assetId)||prepared.assetId;if(prepared.video?.posterAssetId)prepared.video.posterAssetId=map.get(prepared.video.posterAssetId)||prepared.video.posterAssetId;const changed=this.#store._applyWithAssets({id:'layout.fill_slot',params:{slideId,slotKey,element:prepared,assets:[]}},incoming,'레이아웃 자리 채우기');if(changed){const slide=this.document.slides.find(s=>s.id===slideId),layout=this.document.layouts?.find(l=>l.id===slide.layout?.layoutId),slot=layout?.slots?.find(s=>s.key===slotKey);if(slideId===this.activeSlideId&&slot)this.#store._selectAfterCommit(slide.layout.elementMap[slot.elementId]);}return changed;});}
  detachLayout(slideIds){return this.run('layout.detach',{slideIds});}
  deleteLayout(layoutId){return this.run('layout.delete',{layoutId});}
  setMaster(master){return this.run('document.set_master',{master});}
  setSlideBusiness(slideId,properties){return this.run('slide.set_business',{slideId,properties});}
  setSemantics(elementId,semanticRole){return this.run('element.set_semantics',{elementId,semanticRole});}
  readDiagnostics(target){const result=this.readCommittedSnapshot(target);if(!result.ok)return result;const {document,...handle}=result.value;return{ok:true,value:{...handle,diagnostics:result.value.diagnostics||diagnoseDocument(document)}};}
  setThemeRefs(elementId, refs) { return this.run('element.set_theme_refs', { elementId, refs }); }
  setSlideProperties(slideId, properties) { return this.run('slide.set_properties', { slideId, properties }); }
  resizeCanvas(width, height, policy = 'keep') { return this.run('document.resize_canvas', { width, height, policy }); }
  deleteSlides(slideIds) { return this.run('slides.delete', { slideIds }); }
  moveSlides(slideIds, index) { return this.run('slides.move', { slideIds, index }); }
  setTextStyle(elementId, style) { return this.run('text.set_style', { elementId, style }); }
  deleteElement(elementId) { return this.run('element.delete', { elementId }); }
  moveElement(elementId, delta) { return elementId === null ? false : this.run('element.move', { elementId, delta }); }
  moveElements(elementIds, delta) { return this.run('elements.move', { elementIds, delta }); }
  deleteSlide(slideId) { return this.run('slide.delete', { slideId }); }
  moveSlide(slideId, delta) { return this.run('slide.move', { slideId, delta }); }

  // Typed local lifecycle/creation methods. No arbitrary mutation function is accepted by this boundary.
  // Public creation/clientRef batches use the same candidate evaluator and shared history.
  addText() { return this.#dispatch(() => this.#store.addText()); }
  addShape(shape) { return this.#dispatch(() => this.#store.addShape(shape)); }
  addImage(asset) { return this.#dispatch(() => this.#store.addImage(asset)); }
  duplicateElement(id) { return this.#dispatch(() => this.#store.duplicateElement(id)); }
  addSlide() { return this.#dispatch(() => this.#store.addSlide()); }
  duplicateSlide(id) { return this.#dispatch(() => this.#store.duplicateSlide(id)); }
  selectElement(id) { return this.#dispatch(() => this.#store.selectElement(id)); }
  selectElements(ids, options) { return this.#dispatch(() => this.#store.selectElements(ids, options)); }
  toggleSelection(id) { return this.#dispatch(() => this.#store.toggleSelection(id)); }
  beginMultiTransform(ids, kind) { return this.#dispatch(() => this.#store.beginMultiTransform(ids, kind)); }
  previewMultiGeometry(updates) { return this.#dispatch(() => this.#store.previewMultiGeometry(updates)); }
  runBatch(commands, label, options={}) { return this.#dispatch(() => this.#store.applyBatch(commands, label, options.activeSlideId)); }
  executeBatch(commands, label) { return this.runBatch(commands, label); }
  setElementsGeometry(updates) { return this.#dispatch(() => this.#store.setElementsGeometry(updates)); }
  transformElements(ids, transform) { return this.#dispatch(() => this.#store.transformElements(ids, transform)); }
  alignElements(ids, alignment, relativeTo = 'selection') { return this.#dispatch(() => this.#store.alignElements(ids, alignment, relativeTo)); }
  distributeElements(ids, axis) { return this.#dispatch(() => this.#store.distributeElements(ids, axis)); }
  groupElements(ids) { return this.#dispatch(() => this.#store.groupElements(ids)); }
  ungroupElements(ids) { return this.#dispatch(() => this.#store.ungroupElements(ids)); }
  deleteElements(ids) { return this.#dispatch(() => this.#store.deleteElements(ids)); }
  copyElements(ids) { return this.#dispatch(() => this.#store.copyElements(ids)); }
  pasteElements(payload, options) { return this.#dispatch(() => this.#store.pasteElements(payload, options)); }
  copyFormat(id) { return this.#dispatch(() => this.#store.copyFormat(id)); }
  pasteFormat(ids, format) { return this.#dispatch(() => this.#store.pasteFormat(ids, format)); }
  replaceImage(id, asset) { return this.#dispatch(() => this.#store.replaceImage(id, asset)); }
  duplicateSlides(ids) { return this.#dispatch(() => this.#store.duplicateSlides(ids)); }
  importSlides(document, ids, index) { return this.#dispatch(() => this.#store.importSlides(document, ids, index)); }
  switchSlide(id) { return this.#dispatch(() => this.#store.switchSlide(id)); }
  beginText(id) { return this.#dispatch(() => this.#store.beginText(id)); }
  updateText(paragraphs) { return this.#dispatch(() => this.#store.updateText(paragraphs)); }
  updateRichText(value){return this.#dispatch(()=>this.#store.updateRichText(value));}
  setComposing(value) { return this.#dispatch(() => this.#store.setComposing(value)); }
  finishText() { return this.#dispatch(() => this.#store.finishText()); }
  beginTransform(id, kind) { return this.#dispatch(() => this.#store.beginTransform(id, kind)); }
  previewGeometry(geometry) { return this.#dispatch(() => this.#store.previewGeometry(geometry)); }
  commitTransform() { return this.#dispatch(() => this.#store.commitTransform()); }
  cancelTransform() { return this.#dispatch(() => this.#store.cancelTransform()); }
  undo() { return this.#dispatch(() => this.#store.undo()); }
  redo() { return this.#dispatch(() => this.#store.redo()); }
  snapshot() { return this.#dispatch(() => this.#store.snapshot()); }
  markSaved(snapshot, sessionId) { return this.#dispatch(() => this.#store.markSaved(snapshot, sessionId)); }
  markUnsaved() { return this.#dispatch(() => this.#store.markUnsaved()); }
  loadDocument(document) {
    return this.#dispatch(() => { const loaded = this.#store.loadDocument(document); this.#presentation = null; return loaded; });
  }
}
