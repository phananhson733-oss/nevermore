/**
 * Test-only: split a prompt into fenced blocks and the text outside them
 * (CommonMark backtick fences). Not a `*.test.ts` file so every builder test
 * can share it; its own tests live in `../fence.test.ts`.
 */
export interface PromptBlock {
  readonly info: string;
  readonly body: string;
  /** Outside text from the previous block's closing fence (or the start) to this block's opening fence. */
  readonly before: string;
}

export interface PromptParts {
  /** Every block's `before` plus the text after the last block, joined by LF. */
  readonly outside: string;
  readonly blocks: readonly PromptBlock[];
}

interface OpenBlock {
  readonly fence: number;
  readonly info: string;
  readonly before: string;
  readonly lines: readonly string[];
}

interface ScanState {
  readonly blocks: readonly PromptBlock[];
  readonly pending: readonly string[];
  readonly open: OpenBlock | null;
}

/** Three or more backticks, then an info string that has no backtick. */
const OPENING_FENCE = /^(`{3,})([^`]*)$/;
const BACKTICKS_ONLY = /^`+$/;

function scanOutside(state: ScanState, line: string): ScanState {
  const match = OPENING_FENCE.exec(line);
  const fence = match?.[1];
  if (match === null || fence === undefined) {
    return { ...state, pending: [...state.pending, line] };
  }
  const open: OpenBlock = {
    fence: fence.length,
    info: (match[2] ?? "").trim(),
    before: state.pending.join("\n"),
    lines: [],
  };
  return { ...state, pending: [], open };
}

function scanInside(state: ScanState, open: OpenBlock, line: string): ScanState {
  if (BACKTICKS_ONLY.test(line) && line.length >= open.fence) {
    const block: PromptBlock = {
      info: open.info,
      body: open.lines.join("\n"),
      before: open.before,
    };
    return { blocks: [...state.blocks, block], pending: [], open: null };
  }
  return { ...state, open: { ...open, lines: [...open.lines, line] } };
}

/** Throws on an unclosed fence: a prompt with one is a failing builder. */
export function splitFences(prompt: string): PromptParts {
  const initial: ScanState = { blocks: [], pending: [], open: null };
  const end = prompt
    .split("\n")
    .reduce<ScanState>(
      (state, line) =>
        state.open === null
          ? scanOutside(state, line)
          : scanInside(state, state.open, line),
      initial,
    );
  if (end.open !== null) {
    throw new Error(
      `splitFences: unclosed fence after ${JSON.stringify(end.open.before.slice(-60))}`,
    );
  }
  const outside = [
    ...end.blocks.map((block) => block.before),
    end.pending.join("\n"),
  ].join("\n");
  return { blocks: end.blocks, outside };
}
