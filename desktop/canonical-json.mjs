/** Deterministic JSON identity: object key order is irrelevant; arrays and value types retain meaning. */
export function canonicalJson(input) {
  const ancestors = new Set(); let nodes = 0;
  const visit = (value, depth) => {
    if (++nodes > 1000000 || depth > 64) throw new TypeError('JSON structure exceeds the bridge limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Finite, acyclic JSON data is required');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError('Plain JSON objects are required');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) throw new TypeError('JSON string keys are required');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array && value.length > 1000000 - nodes) throw new TypeError('JSON array exceeds the bridge limit');
    const fields = array ? Array.from({ length: value.length }, (_, index) => String(index)) : keys.sort();
    if (array && (keys.length !== fields.length + 1 || fields.some(key => !Object.hasOwn(descriptors, key)))) throw new TypeError('Dense JSON arrays are required');
    ancestors.add(value);
    try {
      const values = fields.map(key => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Enumerable JSON data fields are required');
        const encoded = visit(descriptor.value, depth + 1);
        return array ? encoded : `${JSON.stringify(key)}:${encoded}`;
      });
      return array ? `[${values.join(',')}]` : `{${values.join(',')}}`;
    } finally { ancestors.delete(value); }
  };
  return visit(input, 0);
}
