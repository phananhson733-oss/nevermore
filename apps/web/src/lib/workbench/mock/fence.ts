import { DATA_BLOCK_NOTICE } from "./labels-zh.ts";

/** Fenced data blocks for prompts (R6). A structural separator, not an injection defence. */
export type FenceInfo = "json" | "text";

/**
 * Longest backtick run in `text`. Folded with `reduce` rather than
 * `Math.max(...runs)`: spreading ~200k runs into one call throws
 * "Maximum call stack size exceeded" on Node 24.
 */
function longestBacktickRun(text: string): number {
  return Array.from(text.matchAll(/`+/g), (m) => m[0].length).reduce(
    (longest, length) => Math.max(longest, length),
    0,
  );
}

export function fenceBlock(body: string, info: FenceInfo = "text"): string {
  const normalized = body.replace(/\r\n?/g, "\n");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(normalized) + 1));
  const newline = normalized === "" || normalized.endsWith("\n") ? "" : "\n";
  return `${fence}${info}\n${normalized}${newline}${fence}`;
}

export function fenceJson(value: unknown): string {
  return fenceBlock(JSON.stringify(value, null, 2), "json");
}

/** The only way a prompt builder emits a block: the notice sits on the line right before the fence. */
export function dataSection(block: string): string {
  return `${DATA_BLOCK_NOTICE}\n${block}`;
}
