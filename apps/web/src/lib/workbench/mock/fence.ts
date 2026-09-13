import { DATA_BLOCK_NOTICE } from "./labels-zh.ts";

/** Fenced data blocks for prompts (R6). A structural separator, not an injection defence. */
export type FenceInfo = "json" | "text";

declare const fencedBrand: unique symbol;
/** Text produced by `fenceBlock` / `fenceJson`; `dataSection` accepts nothing else. */
export type FencedBlock = string & { readonly [fencedBrand]: true };

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

export function fenceBlock(
  body: string,
  info: FenceInfo = "text",
): FencedBlock {
  const normalized = body.replace(/\r\n?/g, "\n");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(normalized) + 1));
  const newline = normalized === "" || normalized.endsWith("\n") ? "" : "\n";
  return `${fence}${info}\n${normalized}${newline}${fence}` as FencedBlock;
}

export function fenceJson(value: unknown): FencedBlock {
  // JSON.stringify returns undefined for undefined, functions and symbols despite its declared type.
  const json: unknown = JSON.stringify(value, null, 2);
  if (typeof json !== "string") {
    throw new Error("fenceJson: value has no JSON representation");
  }
  return fenceBlock(json, "json");
}

/** The only way a prompt builder emits a block: the notice sits on the line right before the fence. */
export function dataSection(block: FencedBlock): string {
  return `${DATA_BLOCK_NOTICE}\n${block}`;
}
