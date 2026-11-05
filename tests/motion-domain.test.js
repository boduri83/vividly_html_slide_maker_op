import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommandController } from '../src/controller.js';
import { normalizeDocument, MOTION_SCHEMA } from '../src/model.js';
import { evaluateCommand, getCommandCatalog } from '../src/commands.js';
const legacy = JSON.parse(readFileSync(new URL('../examples/document-contract-v0.1.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const motion = (id, targetId, preset = 'fadeIn') => ({ id, targetId, preset, start: 'onClick', duration: 400, delay: 20, easing: 'ease-out', iterations: 1 });
function fixture() {
  const doc = copy(legacy); doc.schemaVersion = MOTION_SCHEMA;
  doc.variables = [{ id: 'variable-year', name: '연도', initialValue: '2025', options: [{ value: '2025', label: '2025년' }, { value: '2026', label: '2026년' }] }];
  const slide = doc.slides[0], title = slide.elements.find(e => e.type === 'text'), panel = slide.elements.find(e => e.type === 'shape');
  title.binding = { variableId: 'variable-year', values: [{ value: '2025', text: '1250' }, { value: '2026', text: '1800' }], format: 'number', prefix: '매출 ', suffix: '만 원', animate: true };
  const body = copy(title); body.id = 'panel-body'; delete body.binding; body.text.paragraphs = ['상세 설명'];
  const button = copy(panel); button.id = 'open-details'; button.component = { kind: 'button' }; button.text.paragraphs = ['자세히'];
  const tabs = copy(panel); tabs.id = 'year-tabs'; tabs.component = { kind: 'tabs', variableId: 'variable-year' }; tabs.text.paragraphs = ['연도 선택'];
  panel.component = { kind: 'panel', initiallyOpen: false, dim: true, placement: 'right', contentIds: [body.id] };
  slide.elements.push(body, button, tabs);
  slide.motions = [motion('motion-title-in', title.id), { ...motion('motion-button-pulse', button.id, 'pulse'), start: 'afterPrevious', iterations: 2 }];
  slide.interactions = [{ id: 'interaction-open', sourceId: button.id, event: 'click', actions: [{ type: 'openPanel', targetId: panel.id }, { type: 'playMotion', motionId: 'motion-button-pulse' }] },
    { id: 'interaction-navigation', sourceId: body.id, event: 'click', actions: [{ type: 'setVariable', variableId: 'variable-year', value: '2026' }, { type: 'goToSlide', targetId: doc.slides[1].id }] }];
  slide.transition = { type: 'push', duration: 350, easing: 'ease-in-out' }; slide.advanceAfter = 8000;
  return normalizeDocument(doc);
}
const state = c => ({ document: copy(c.document), revision: c.revision, viewRevision: c.viewRevision, sessionId: c.sessionId, history: c.readHistory().value.history, selection: c.selectedIds });
const guarded = (c, commands, extra = {}) => ({ target: { instanceId: c.instanceId, editorSessionId: c.editorSessionId, documentId: c.document.id }, expectedRevision: c.revision, operationId: crypto.randomUUID(), targeting: 'id', commands, ...extra });

test('legacy documents stay byte-shaped and clearing absent motion metadata is a no-op', () => {
  assert.deepEqual(normalizeDocument(legacy), legacy);
  const c = new CommandController(legacy), slideId = c.activeSlideId, id = c.activeSlide.elements[0].id;
  for (const command of [
    { id: 'document.set_variables', params: { variables: [] } },
    { id: 'slide.set_motions', params: { slideId, motions: [] } },
    { id: 'slide.set_interactions', params: { slideId, interactions: [] } },
    { id: 'slide.set_transition', params: { slideId, transition: null, advanceAfter: null } },
    { id: 'element.set_component', params: { elementId: id, component: null } },
    { id: 'element.set_binding', params: { elementId: id, binding: null } },
  ]) { assert.equal(c.execute(command).value.changed, false); assert.deepEqual(c.document, legacy); }
  assert.equal(c.undoCount, 0);
  const invalid = copy(legacy); invalid.slides[0].motions = [];
  assert.throws(() => normalizeDocument(invalid));
});

test('motion schema preserves semantic IDs, author settings and number tables while rejecting runtime/unknown data', () => {
  const document = fixture(); assert.deepEqual(normalizeDocument(JSON.parse(JSON.stringify(document))), document);
  const damaged = [d => d.slides[0].motions[0].duration = -1, d => d.slides[0].motions[0].start = 'custom-script', d => d.slides[0].transition.type = 'eval',
    d => d.slides[0].elements[0].binding.values[0].text = 'not a number', d => d.slides[0].elements[0].binding.values.pop(),
    d => d.variables[0].options.push(copy(d.variables[0].options[0])), d => d.variables[0].initialValue = 'missing',
    d => d.slides[0].playbackTime = 500, d => d.slides[0].motions[0].script = 'window.open()'];
  for (const mutate of damaged) { const input = copy(document); mutate(input); assert.throws(() => normalizeDocument(input)); }
});

test('dangling, cross-slide, duplicated, nested and overlapping panel references are rejected', () => {
  const document = fixture(), titleId = document.slides[0].elements[0].id, panelId = document.slides[0].elements[1].id;
  for (const mutate of [
    d => d.slides[0].motions[0].targetId = d.slides[1].elements[0].id,
    d => d.slides[0].motions[1].id = d.variables[0].id,
    d => d.slides[0].elements[1].component.contentIds = [panelId],
    d => d.slides[0].elements[1].component.contentIds = ['panel-body', 'panel-body'],
    d => d.slides[0].elements.find(e => e.id === 'open-details').component = { kind: 'panel', initiallyOpen: false, dim: true, placement: 'center', contentIds: ['panel-body'] },
    d => d.slides[0].elements[1].component.contentIds = ['open-details'],
    d => d.slides[0].interactions[0].actions[0].targetId = titleId,
  ]) {
    const input = copy(document); mutate(input);
    if (input.slides[0].elements[1].component.contentIds[0] === 'open-details') input.slides[0].elements.find(e => e.id === 'open-details').component = { kind: 'panel', initiallyOpen: false, dim: true, placement: 'center' };
    assert.throws(() => normalizeDocument(input));
  }
});

test('six typed commands share one batch Undo and never downgrade v3 on older style commands', () => {
  const c = new CommandController(legacy), slideId = c.activeSlideId, elementId = c.activeSlide.elements[0].id;
  const variables = [{ id: 'choice', name: '상태', initialValue: 'a', options: [{ value: 'a', label: 'A' }] }];
  c.runBatch([
    { id: 'document.set_variables', params: { variables } },
    { id: 'element.set_component', params: { elementId, component: { kind: 'button' } } },
    { id: 'element.set_binding', params: { elementId, binding: { variableId: 'choice', values: [{ value: 'a', text: '한글 값' }], format: 'text' } } },
    { id: 'slide.set_motions', params: { slideId, motions: [motion('entry', elementId)] } },
    { id: 'slide.set_interactions', params: { slideId, interactions: [{ id: 'action', sourceId: elementId, event: 'click', actions: [{ type: 'playMotion', motionId: 'entry' }] }] } },
    { id: 'slide.set_transition', params: { slideId, transition: { type: 'fade', duration: 300, easing: 'ease' }, advanceAfter: 5000 } },
  ], '움직이는 자료');
  assert.equal(c.document.schemaVersion, MOTION_SCHEMA); assert.equal(c.undoCount, 1); const authored = copy(c.document);
  c.undo(); assert.deepEqual(c.document, legacy); c.redo(); assert.deepEqual(c.document, authored);
  c.setVisualStyle(elementId, { opacity: 0.7 }); assert.equal(c.document.schemaVersion, MOTION_SCHEMA);
  assert.equal(c.readCapabilities().value.commands.filter(command => command.availability !== 'reserved').length,106);
  assert.equal(getCommandCatalog({ includeReserved: true }).length,106);
});

test('invalid late motion commands leave Korean draft, committed document and history intact', () => {
  const c = new CommandController(fixture()), id = c.activeSlide.elements[0].id;
  c.beginText(id); c.updateText(['미확정 한글']); c.setComposing(true); const before = state(c), draft = copy(c.textSession);
  assert.throws(() => c.runBatch([{ id: 'document.set_title', params: { title: '실패하면 남지 않음' } }, { id: 'slide.set_motions', params: { slideId: c.activeSlideId, motions: [{ ...motion('invalid', id), duration: -1 }] } }]));
  assert.deepEqual(state(c), before); assert.deepEqual(c.textSession, draft);
});

test('guarded motion batches enforce CAS, busy, dryRun and one shared Undo', async () => {
  const activity = {}, c = new CommandController(fixture(), { activityProvider: () => activity });
  const authored = copy(c.document), commands = [{ id: 'slide.set_transition', params: { slideId: c.activeSlideId, transition: { type: 'zoom', duration: 600, easing: 'ease' } } }];
  const before = state(c), dry = await c.applyCommands(guarded(c, commands, { dryRun: true })); assert.equal(dry.ok, true); assert.deepEqual(state(c), before);
  activity.controls = [{ fieldId: 'motion-properties', slideId: c.activeSlideId }];
  const busy = await c.applyCommands(guarded(c, commands)); assert.equal(busy.error.code, 'EDITOR_BUSY'); assert.equal(busy.error.mutated, false); delete activity.controls;
  const request = guarded(c, commands), result = await c.applyCommands(request); assert.equal(result.ok, true); assert.equal(c.undoCount, 1);
  const repeated = await c.applyCommands(request); assert.equal(repeated.error.code, 'REVISION_CONFLICT'); assert.equal(c.undoCount, 1);
  const conflict = await c.applyCommands({ ...request, operationId: crypto.randomUUID() }); assert.equal(conflict.error.code, 'REVISION_CONFLICT');
  const undone = await c.undoGuarded({ target: request.target, expectedRevision: c.revision, operationId: crypto.randomUUID(), expectedTopEntryId: result.value.undoEntryId });
  assert.equal(undone.ok, true); assert.deepEqual(c.document, authored);
});

test('locked motion and interaction targets cannot be changed while unchanged tracks can coexist', () => {
  const document = fixture(); document.slides[0].elements[0].locked = true;
  const c = new CommandController(document), before = state(c), motions = copy(c.activeSlide.motions); motions[0].duration = 100;
  assert.throws(() => c.setMotions(c.activeSlideId, motions)); assert.deepEqual(state(c), before);
  const retargeted = copy(c.activeSlide.motions); retargeted[0].targetId = 'open-details';
  assert.throws(() => c.setMotions(c.activeSlideId, retargeted)); assert.deepEqual(state(c), before);
  c.setMotions(c.activeSlideId, [...c.activeSlide.motions, motion('new-button', 'open-details', 'pulse')]); assert.equal(c.undoCount, 1);
  assert.throws(() => c.setBinding(c.activeSlide.elements[0].id, null));
});

test('element, motion, panel and variable deletion clean only affected links and Undo restores them', () => {
  const c = new CommandController(fixture()), authored = copy(c.document), titleId = c.activeSlide.elements[0].id;
  c.deleteElement(titleId); assert.equal(c.activeSlide.motions.length, 1); assert.equal(c.document.variables.length, 1); c.undo(); assert.deepEqual(c.document, authored);
  c.deleteElement('panel-body'); assert.deepEqual(c.activeSlide.elements[1].component.contentIds, []); assert.equal(c.activeSlide.interactions.length, 1); c.undo();
  c.setMotions(c.activeSlideId, []); assert.equal(c.activeSlide.interactions[0].actions.length, 1); c.undo();
  c.setComponent(c.activeSlide.elements[1].id, null); assert.equal(c.activeSlide.interactions[0].actions[0].type, 'playMotion'); c.undo();
  c.setVariables([]); assert.equal(c.activeSlide.elements[0].binding, undefined); assert.equal(c.activeSlide.elements.find(e => e.id === 'year-tabs').component, undefined); c.undo(); assert.deepEqual(c.document, authored);
});

test('v2 clipboard copies panel content and remaps all contained links in one Undo, including across documents', () => {
  const source = new CommandController(fixture()), panelId = source.activeSlide.elements[1].id;
  const panelOnly = source.copyElements([panelId]); assert.equal(panelOnly.version, 2); assert.equal(panelOnly.elements.length, 2);
  source.groupElements([panelId, 'open-details']);
  const groupCopy = source.copyElements(['open-details']); assert.equal(groupCopy.elements.length, 3, 'copying a panel through its group also includes the panel contents');
  source.undo();
  const target = copy(legacy); target.id = 'different-document';
  const all = source.copyElements(source.activeSlide.elements.map(e => e.id)), destination = new CommandController(target);
  const before = copy(destination.document), created = destination.pasteElements(all, { offsetX: 0, offsetY: 0 });
  assert.equal(destination.undoCount, 1); assert.equal(created.length, all.elements.length); assert.equal(destination.document.schemaVersion, MOTION_SCHEMA);
  const pasted = destination.activeSlide.elements.filter(e => created.includes(e.id)), panel = pasted.find(e => e.component?.kind === 'panel');
  assert.equal(panel.component.contentIds.length, 1); assert.ok(created.includes(panel.component.contentIds[0]));
  const variable = destination.document.variables[0]; assert.notEqual(variable.id, 'variable-year'); assert.equal(pasted.find(e => e.binding).binding.variableId, variable.id);
  assert.ok(destination.activeSlide.motions.every(m => created.includes(m.targetId))); assert.ok(destination.activeSlide.interactions.every(i => created.includes(i.sourceId)));
  const interaction = destination.activeSlide.interactions.find(i => i.actions.some(a => a.type === 'openPanel')); assert.equal(interaction.actions[0].targetId, panel.id);
  assert.equal(destination.activeSlide.interactions.some(i => i.actions.some(a => a.type === 'goToSlide')), false, 'cross-document external navigation is intentionally removed');
  destination.undo(); assert.deepEqual(destination.document, before); destination.redo(); assert.equal(destination.document.variables.length, 1);
});

test('whole-slide import remaps navigation between imported slides and retains references and image bytes', () => {
  const source = fixture(), c = new CommandController(legacy), before = copy(c.document), assetBytes = copy(source.assets);
  const created = c.importSlides(source, source.slides.map(s => s.id));
  assert.equal(c.undoCount, 1); assert.equal(created.length, 3);
  const imported = c.document.slides.filter(s => created.includes(s.id)), navigation = imported[0].interactions.flatMap(i => i.actions).find(a => a.type === 'goToSlide');
  assert.equal(navigation.targetId, imported[1].id); assert.equal(imported[0].motions[0].targetId, imported[0].elements[0].id);
  for (const incoming of assetBytes) assert.ok(c.document.assets.some(a => a.dataBase64 === incoming.dataBase64 && a.sha256 === incoming.sha256));
  c.undo(); assert.deepEqual(c.document, before); c.redo(); assert.deepEqual(normalizeDocument(c.document), c.document);
  const duplicates = c.duplicateSlides([imported[0].id]); assert.equal(duplicates.length, 1); assert.deepEqual(normalizeDocument(c.document), c.document);
});

test('bad advanced clipboard input fails before committing or ending an IME draft', () => {
  const c = new CommandController(fixture()), id = c.activeSlide.elements[0].id, payload = c.copyElements(c.activeSlide.elements.map(e => e.id));
  c.beginText(id); c.updateText(['조합 보호']); c.setComposing(true); const before = state(c), draft = copy(c.textSession);
  for (const mutate of [p => p.elements[1].id = p.elements[0].id, p => p.motions[0].duration = -1, p => p.elements.find(e => e.component?.kind === 'panel').component.contentIds = ['missing'], p => p.script = 'eval']) {
    const input = copy(payload); mutate(input); assert.throws(() => c.pasteElements(input)); assert.deepEqual(state(c), before); assert.deepEqual(c.textSession, draft);
  }
});

test('initial runtime hiding is distinct from layer exclusion, versioned, reversible and copied without loss', () => {
  const c = new CommandController(legacy), id = c.activeSlide.elements[0].id;
  assert.equal(c.setElementFlags(id, { initiallyHidden: false }), false); assert.deepEqual(c.document, legacy);
  c.setElementFlags(id, { initiallyHidden: true }); assert.equal(c.document.schemaVersion, MOTION_SCHEMA); assert.equal(c.activeSlide.elements[0].hidden, undefined);
  assert.equal(c.activeSlide.elements[0].initiallyHidden, true); assert.equal(c.undoCount, 1);
  const authored = copy(c.document); assert.deepEqual(normalizeDocument(authored), authored);
  const legacyWithFlag = copy(legacy); legacyWithFlag.slides[0].elements[0].initiallyHidden = true; assert.throws(() => normalizeDocument(legacyWithFlag));
  const copied = c.copyElements([id]), created = c.pasteElements(copied); assert.equal(c.activeSlide.elements.find(e => e.id === created[0]).initiallyHidden, true);
  c.undo(); assert.deepEqual(c.document, authored); c.undo(); assert.deepEqual(c.document, legacy); c.redo(); assert.deepEqual(c.document, authored);
});

test('duplicating a button alone keeps live same-slide action links and cross-document paste removes external links', () => {
  const document = fixture(); document.slides[0].interactions[0].actions.push({ type: 'playMotion', motionId: 'motion-title-in' });
  const c = new CommandController(document), payload = c.copyElements(['open-details']);
  assert.equal(payload.elements.length, 1); assert.equal(payload.interactions[0].actions.length, 3);
  const created = c.pasteElements(payload), linked = c.activeSlide.interactions.find(i => i.sourceId === created[0]);
  assert.equal(linked.actions[0].targetId, c.activeSlide.elements[1].id);
  assert.equal(c.activeSlide.motions.find(m => m.id === linked.actions[1].motionId).targetId, created[0], 'the copied own effect points at the copied button');
  assert.equal(linked.actions[2].motionId, 'motion-title-in', 'a live same-slide external effect stays linked');
  const otherDoc = copy(legacy); otherDoc.id = 'clipboard-destination'; const destination = new CommandController(otherDoc);
  const crossCreated = destination.pasteElements(payload), crossRule = destination.activeSlide.interactions.find(i => i.sourceId === crossCreated[0]);
  assert.equal(crossRule.actions.length, 1); assert.equal(crossRule.actions[0].type, 'playMotion');
  assert.equal(destination.activeSlide.motions.find(m => m.id === crossRule.actions[0].motionId).targetId, crossCreated[0]);
  c.switchSlide(c.document.slides[1].id); const otherSlideCreated = c.pasteElements(payload);
  const otherSlideRule = c.activeSlide.interactions.find(i => i.sourceId === otherSlideCreated[0]);
  assert.equal(otherSlideRule.actions.length, 1); assert.equal(otherSlideRule.actions[0].type, 'playMotion');
});

test('navigation is a single terminal action so later authored actions cannot be silently skipped', () => {
  const document = fixture(), slide = document.slides[0], targetId = document.slides[1].id;
  for (const actions of [
    [{ type: 'goToSlide', targetId }, { type: 'setVariable', variableId: 'variable-year', value: '2025' }],
    [{ type: 'goToSlide', targetId }, { type: 'goToSlide', targetId }],
  ]) {
    const c = new CommandController(document), before = state(c);
    assert.throws(() => c.setInteractions(slide.id, [{ id: 'bad-terminal', sourceId: 'open-details', event: 'click', actions }]));
    assert.deepEqual(state(c), before);
  }
  const c = new CommandController(document);
  c.setInteractions(slide.id, [{ id: 'good-terminal', sourceId: 'open-details', event: 'click', actions: [{ type: 'setVariable', variableId: 'variable-year', value: '2026' }, { type: 'goToSlide', targetId }] }]);
  assert.equal(c.undoCount, 1); c.undo(); assert.deepEqual(c.document, document);
});
