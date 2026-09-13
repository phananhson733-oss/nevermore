/**
 * Test-only: split a prompt into fenced blocks and the text outside them,
 * following CommonMark's backtick-fence rules closely enough that a block this
 * helper reports closed is also closed for a real renderer. Not a `*.test.ts`
 * file so every builder test can share it; its own tests live in
 * `../fence.test.ts`. Body lines are not de-indented for an indented opener
 * (the generators never indent a fence).
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

/** CommonMark line endings: CRLF, lone CR, or LF. */
const LINE_BREAK = /\r\n|\r|\n/;
/** Up to three spaces, three or more backticks, then an info string that has no backtick. */
const OPENING_FENCE = /^ {0,3}(`{3,})([^`]*)$/;
/** Up to three spaces, a backtick run, then nothing but spaces or tabs. */
const CLOSING_FENCE = /^ {0,3}(`{3,})[ \t]*$/;
/** The generators never emit tilde fences, so one outside a block means this split cannot be trusted. */
const TILDE_FENCE = /^ {0,3}~{3,}/;

function closes(line: string, open: OpenBlock): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1];
  return run !== undefined && run.length >= open.fence;
}

function scanOutside(state: ScanState, line: string): ScanState {
  if (TILDE_FENCE.test(line)) {
    throw new Error(
      `splitFences: tilde fence outside a block: ${JSON.stringify(line)}`,
    );
  }
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
  if (closes(line, open)) {
    const block: PromptBlock = {
      info: open.info,
      body: open.lines.join("\n"),
      before: open.before,
    };
    return { blocks: [...state.blocks, block], pending: [], open: null };
  }
  return { ...state, open: { ...open, lines: [...open.lines, line] } };
}

/** Throws on an unclosed fence or a tilde fence outside a block: either is a failing builder. */
export function splitFences(prompt: string): PromptParts {
  const initial: ScanState = { blocks: [], pending: [], open: null };
  const end = prompt
    .split(LINE_BREAK)
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
