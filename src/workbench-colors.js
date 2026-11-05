/** RGB-only color inputs must not discard the model's shorthand or alpha channel. */
function parts(color) {
  if (typeof color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color))
    throw new TypeError('HEX 색상이 필요합니다.');
  const hex = color.slice(1).toLowerCase();
  const expanded = hex.length <= 4 ? [...hex].map(digit => digit + digit).join('') : hex;
  return { rgb: '#' + expanded.slice(0, 6), alpha: expanded.slice(6) };
}

export function colorInputRgb(color) {
  return parts(color).rgb;
}

export function mergeColorInput(originalColor, rgb) {
  const original = parts(originalColor), current = parts(rgb);
  if (current.rgb === original.rgb) return originalColor;
  return current.rgb + original.alpha;
}
