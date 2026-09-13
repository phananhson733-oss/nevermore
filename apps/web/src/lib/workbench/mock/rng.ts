/** Deterministic randomness for mock data. Same input, same output; no ambient state. */

/** FNV-1a over UTF-16 code units (jsx:324). */
export function hashOf(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 (jsx:325). Returns a generator of floats in [0, 1). */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Joins seed parts with a unit separator so ("Acmeprev") and ("Acme", "prev") never collide (jsx concatenated). */
export function seedKey(...parts: readonly string[]): number {
  return hashOf(parts.join("\u001f"));
}

export function pick<T>(items: readonly T[], next: () => number): T {
  const item = items[Math.floor(next() * items.length)];
  if (item === undefined) throw new Error("pick() needs a non-empty list");
  return item;
}

/** Up to `count` distinct items, order drawn from `next` (partial Fisher-Yates on a copy). */
export function sampleDistinct<T>(items: readonly T[], count: number, next: () => number): readonly T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const index = Math.floor(next() * pool.length);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) out.push(item);
  }
  return out;
}
