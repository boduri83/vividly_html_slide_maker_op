/** Font names are data. Quote each family before using it in a CSS declaration. */
export function isFontFamily(value) {
  return typeof value === 'string' && value.length <= 256 && !!value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split(',').every(part => !!part.trim());
}
const generic = new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui']);
export function fontStack(value) {
  if (!isFontFamily(value)) throw new Error('유효한 글꼴 이름이 필요합니다.');
  return value.split(',').map(part => {
    const name = part.trim();
    return generic.has(name.toLowerCase()) ? name.toLowerCase() : '"' + name.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/</g,'\\3c ').replace(/>/g,'\\3e ') + '"';
  }).join(',');
}
