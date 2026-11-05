/** Data-only read contracts. No draft values, file paths, DOM or session mutation. */
export const READ_CONTRACT_VERSION = 'vividly.read/0.1';
const targetKeys = ['instanceId', 'editorSessionId', 'documentId'];
const controlFields = new Set(['document-title', 'property-x', 'property-y', 'property-width', 'property-height',
  'property-font-family', 'property-text-color', 'property-align', 'property-font-size', 'property-fill', 'property-stroke',
  'property-line-height', 'property-vertical-align', 'property-shape', 'property-stroke-width',
  'property-image-fit', 'property-image-alt', 'property-slide-background', 'property-rotation', 'property-name',
  'property-opacity', 'property-radius', 'property-gradient-start', 'property-gradient-end', 'property-gradient-angle',
  'property-gradient-type', 'property-shadow-color', 'property-shadow-x', 'property-shadow-y', 'property-shadow-blur',
  'property-shadow-spread', 'property-crop-x', 'property-crop-y', 'property-crop-width', 'property-crop-height',
  'property-focal-x', 'property-focal-y', 'property-image-source', 'theme-primary', 'theme-secondary', 'theme-background',
  'theme-text', 'theme-font-family', 'canvas-width', 'canvas-height', 'slide-name', 'slide-section', 'workbench-properties', 'workbench-color', 'motion-properties','business-properties','rich-text','timeline-properties','interaction-properties',
  'workspace-properties', 'studio-properties']);

export function validateReadTarget(target, current) {
  if (target === undefined) return null; // Local discovery of the current document handle.
  const invalid = () => ({ code: 'INVALID_TARGET', message: 'instanceId·editorSessionId·documentId가 있는 대상이 필요합니다.', path: '$.target' });
  if (!target || typeof target !== 'object' || Array.isArray(target)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(target))) return invalid();
  const keys = Reflect.ownKeys(target);
  if (keys.length !== targetKeys.length || keys.some(key => !targetKeys.includes(key))) return invalid();
  for (const key of targetKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable
      || typeof descriptor.value !== 'string' || !descriptor.value.trim() || descriptor.value.length > 256) return invalid();
  }
  if (target.instanceId !== current.instanceId) return { code: 'INSTANCE_MISMATCH', message: '다른 편집기 인스턴스의 대상입니다.', path: '$.target.instanceId' };
  if (target.editorSessionId !== current.editorSessionId) return { code: 'STALE_EDITOR_SESSION', message: '문서 세션이 바뀌었습니다. 현재 대상을 다시 조회하세요.', path: '$.target.editorSessionId' };
  if (target.documentId !== current.documentId) return { code: 'DOCUMENT_MISMATCH', message: '현재 문서와 대상 ID가 다릅니다.', path: '$.target.documentId' };
  return null;
}

export function captureEditorState(store, activity, viewport, presentation) {
  // Activity is supplied by trusted local UI code. Project only explicit metadata; never spread it.
  const reasons = [];
  const add = (kind, scope, details = {}) => reasons.push({ kind, scope, ...details });
  if (store.textSession) {
    add('text', 'human', { elementId: store.textSession.elementId });
    if (store.textSession.composing) add('ime', 'human', { elementId: store.textSession.elementId });
  }
  if (store.transformSession) add(store.transformSession.kind === 'move' ? 'drag' : store.transformSession.kind === 'rotate' ? 'rotate' : 'resize', 'human', { elementId: store.transformSession.elementId });
  if (activity.composing === true && !store.textSession?.composing) add('ime', 'human');
  const ids = new Set(store.document.slides.flatMap(slide => slide.elements.map(element => element.id)));
  const slideIds = new Set(store.document.slides.map(slide => slide.id));
  for (const control of Array.isArray(activity.controls) ? activity.controls : []) {
    if (!control || !controlFields.has(control.fieldId)) continue;
    const detail = { fieldId: control.fieldId };
    if (ids.has(control.elementId)) detail.elementId = control.elementId;
    if (slideIds.has(control.slideId)) detail.slideId = control.slideId;
    const kind = control.fieldId === 'document-title' ? 'title' : ['property-fill', 'property-stroke', 'property-text-color', 'property-slide-background', 'workbench-color'].includes(control.fieldId) ? 'colorControl' : 'property';
    if (!reasons.some(reason => reason.kind === kind && reason.fieldId === detail.fieldId)) add(kind, 'human', detail);
  }
  for (const kind of ['initializing', 'saving', 'opening', 'pendingAction', 'libraryImport', 'componentLibrary']) if (activity[kind] === true) add(kind, 'application');
  if (presentation) add('presentation', 'application');
  return {
    activeSlideId: store.activeSlideId, selectedElementIds: store.selectedIds ?? (store.selectedId ? [store.selectedId] : []),
    viewport: { mode: viewport.mode, scale: viewport.scale },
    presentation: { active: Boolean(presentation), slideId: presentation?.slideId ?? null },
    humanEditing: reasons.some(reason => reason.scope === 'human'),
    busy: { active: reasons.length > 0, reasons },
    dirty: store.isDirty || activity.pendingChanges === true,
    history: { canUndo: store.canUndo, canRedo: store.canRedo, undoCount: store.undoCount, redoCount: store.redoCount,
      topUndoEntryId: store.topUndoEntryId, topRedoEntryId: store.topRedoEntryId },
  };
}
