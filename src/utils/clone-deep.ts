const cloneArray = (
  val: unknown[],
  cache: Map<unknown, unknown>
): unknown[] => {
  const result: unknown[] = [];
  cache.set(val, result);
  val.forEach((item) => result.push(deepClone(item, cache)));
  return result;
};

const cloneMap = (
  val: Map<unknown, unknown>,
  cache: Map<unknown, unknown>
): Map<unknown, unknown> => {
  const result = new Map();
  cache.set(val, result);
  val.forEach((v, k) => result.set(deepClone(k, cache), deepClone(v, cache)));
  return result;
};

const cloneSet = (
  val: Set<unknown>,
  cache: Map<unknown, unknown>
): Set<unknown> => {
  const result = new Set();
  cache.set(val, result);
  val.forEach((v) => result.add(deepClone(v, cache)));
  return result;
};

const cloneObject = (
  val: Record<string, unknown>,
  cache: Map<unknown, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  cache.set(val, result);
  for (const key in val) {
    if (Object.hasOwn(val, key)) {
      result[key] = deepClone(val[key], cache);
    }
  }
  return result;
};

const deepClone = (val: unknown, cache: Map<unknown, unknown>): unknown => {
  if (val === null || typeof val !== 'object') return val;
  if (cache.has(val)) return cache.get(val);

  if (val instanceof Date) return new Date(val);
  if (val instanceof RegExp) return new RegExp(val.source, val.flags);

  if (Array.isArray(val)) return cloneArray(val, cache);
  if (val instanceof Map) return cloneMap(val, cache);
  if (val instanceof Set) return cloneSet(val, cache);

  return cloneObject(val as Record<string, unknown>, cache);
};

export const cloneDeep = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;

  const cache = new Map<unknown, unknown>();
  return deepClone(value, cache) as T;
};
