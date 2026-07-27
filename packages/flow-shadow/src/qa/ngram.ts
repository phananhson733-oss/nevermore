import { QA_THRESHOLDS } from "./thresholds.ts";

/**
 * Token-overlap primitives.
 *
 * `longestCommonNgram` is the dynamic program the sibling tooling used for
 * SERP-wide plagiarism detection. The frozen pack has no SERP snippet corpus,
 * so that rule is not ported — but the algorithm is, because the gate does own
 * the pinned content brief (SC-DUP). Captured page bodies use the separate
 * bounded shingle/Jaccard rule rather than multiplying this O(n·m) comparison.
 *
 * The DP is O(n·m), so both sides are capped before it runs. The cap is a
 * deterministic prefix, never a sample.
 */
export function longestCommonNgram(
  left: readonly string[],
  right: readonly string[],
  maxTokens: number = QA_THRESHOLDS.maxNgramTokens,
): number {
  const a = left.length > maxTokens ? left.slice(0, maxTokens) : left;
  const b = right.length > maxTokens ? right.slice(0, maxTokens) : right;
  if (a.length === 0 || b.length === 0) return 0;

  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        const run = (previous[j - 1] ?? 0) + 1;
        current[j] = run;
        if (run > best) best = run;
      } else {
        current[j] = 0;
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }
  return best;
}

export function shingles(
  tokens: readonly string[],
  size: number,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (size <= 0 || tokens.length < size) return out;
  for (let i = 0; i + size <= tokens.length; i += 1) {
    out.add(tokens.slice(i, i + size).join(" "));
  }
  return out;
}

export function jaccard(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Fraction of `needles` present in `haystack`. */
export function recall(
  needles: readonly string[],
  haystack: ReadonlySet<string>,
): number {
  if (needles.length === 0) return 1;
  let hit = 0;
  for (const needle of needles) if (haystack.has(needle)) hit += 1;
  return hit / needles.length;
}
