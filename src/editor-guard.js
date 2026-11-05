/** Closed, data-only preconditions for one agent document command. No UI or transport access. */
import { validateCommand, validateCommands } from './commands.js';
import { validateReadTarget } from './editor-read.js';

export const GUARDED_COMMAND_VERSION = 'vividly.guarded-command/0.1';
export const BATCH_CONTRACT_VERSION = 'vividly.batch/0.1';
const fields = ['target', 'expectedRevision', 'expectedViewRevision', 'operationId', 'targeting', 'command'];
const required = fields.filter(key => key !== 'expectedViewRevision');
const failure = (code, message, path) => ({ ok: false, error: { code, message, path, mutated: false } });

function readFields(input, fields, required) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    return failure('INVALID_REQUEST', '문서 변경 요청 객체가 필요합니다.', '$');
  const keys = Reflect.ownKeys(input), value = {};
  if (keys.length > fields.length || keys.some(key => !fields.includes(key)))
    return failure('INVALID_REQUEST', '알 수 없는 변경 요청 필드입니다.', '$');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      return failure('INVALID_REQUEST', 'JSON 데이터 필드가 필요합니다.', '$');
    value[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(value, key))
    return failure('INVALID_REQUEST', '필수 변경 요청 필드가 없습니다.', `$.${key}`);
  return { ok: true, value };
}
function validatePreconditions(value) {
  if (value.target === undefined) return failure('INVALID_TARGET', '명시적인 문서 대상이 필요합니다.', '$.target');
  const targetError = validateReadTarget(value.target, value.target);
  if (targetError) return { ok: false, error: { ...targetError, mutated: false } };
  value.target = { ...value.target }; // Already checked data descriptors; do not retain the caller's object.
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)
    return failure('INVALID_PRECONDITION', '0 이상의 안전한 revision 정수가 필요합니다.', '$.expectedRevision');
  if (!['id', 'selection'].includes(value.targeting))
    return failure('INVALID_PRECONDITION', 'id 또는 selection 대상 지정이 필요합니다.', '$.targeting');
  if (value.targeting === 'selection') {
    if (!Number.isSafeInteger(value.expectedViewRevision) || value.expectedViewRevision < 0)
      return failure('INVALID_PRECONDITION', '선택 기반 변경에는 view revision이 필요합니다.', '$.expectedViewRevision');
  } else if (Object.hasOwn(value, 'expectedViewRevision'))
    return failure('INVALID_PRECONDITION', 'ID 직접 지정에는 view revision을 사용하지 않습니다.', '$.expectedViewRevision');
  if (typeof value.operationId !== 'string' || !value.operationId.trim() || value.operationId.length > 256)
    return failure('INVALID_REQUEST', '길이 1~256의 작업 ID가 필요합니다.', '$.operationId');
  return { ok: true, value };
}
export function validateGuardedCommand(input) {
  const fieldsResult = readFields(input, fields, required);
  if (!fieldsResult.ok) return fieldsResult;
  const preconditions = validatePreconditions(fieldsResult.value);
  if (!preconditions.ok) return preconditions;
  const value = preconditions.value;
  const checked = validateCommand(value.command);
  if (!checked.ok) return { ok: false, error: { ...checked.error, mutated: false } };
  value.command = checked.value; // Detached, bounded JSON validated against the same command registry as the UI.
  if (value.targeting === 'selection' && !Object.hasOwn(value.command.params, 'elementId'))
    return failure('INVALID_PRECONDITION', '선택 기반 변경에는 명시적인 개체 ID가 필요합니다.', '$.command.params.elementId');
  return { ok: true, value };
}

export function validateGuardedBatch(input) {
  const names = ['target', 'expectedRevision', 'expectedViewRevision', 'operationId', 'targeting', 'commands', 'dryRun', 'label'];
  const fieldsResult = readFields(input, names, ['target', 'expectedRevision', 'operationId', 'targeting', 'commands']);
  if (!fieldsResult.ok) return fieldsResult;
  const preconditions = validatePreconditions(fieldsResult.value);
  if (!preconditions.ok) return preconditions;
  const value = preconditions.value;
  if (Object.hasOwn(value, 'dryRun') && typeof value.dryRun !== 'boolean')
    return failure('INVALID_REQUEST', 'dryRun은 boolean이어야 합니다.', '$.dryRun');
  if (Object.hasOwn(value, 'label') && (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 256))
    return failure('INVALID_REQUEST', '길이 1~256의 작업 설명이 필요합니다.', '$.label');
  const checked = validateCommands(value.commands);
  if (!checked.ok) return { ok: false, error: { ...checked.error, mutated: false } };
  value.commands = checked.value;
  if (value.targeting === 'selection' && value.commands.some(command => !Object.hasOwn(command.params, 'elementId')))
    return failure('INVALID_PRECONDITION', '선택 기반 묶음에는 명시적인 개체 ID만 사용할 수 있습니다.', '$.commands');
  return { ok: true, value: { ...value, dryRun: value.dryRun ?? false, label: value.label ?? '에이전트 묶음 편집' } };
}

/** Global history is intentional: the caller must identify exactly the current top entry. */
export function validateGuardedHistory(input) {
  const names = ['target', 'expectedRevision', 'operationId', 'expectedTopEntryId'];
  const fieldsResult = readFields(input, names, names);
  if (!fieldsResult.ok) return fieldsResult;
  const value = fieldsResult.value;
  // History has no implicit selection target or view precondition.
  const preconditions = validatePreconditions({ ...value, targeting: 'id' });
  if (!preconditions.ok) return preconditions;
  if (typeof value.expectedTopEntryId !== 'string' || !value.expectedTopEntryId.trim() || value.expectedTopEntryId.length > 256)
    return failure('INVALID_PRECONDITION', '현재 맨 위 이력 ID가 필요합니다.', '$.expectedTopEntryId');
  return { ok: true, value: preconditions.value };
}
