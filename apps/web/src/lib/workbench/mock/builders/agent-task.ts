/**
 * The "copy for an AI agent" wrapper (Q23, R6). Text goes in and a prompt comes
 * out with that text inside one announced fenced block.
 *
 * Byte for byte ONLY for canonical input. `fenceBlock` rewrites every CR (CRLF
 * or a lone CR) to LF, and absorbs a final LF of the body into the line before
 * the closing fence, so "x" and "x\n" wrap to the same prompt; any text with a
 * CR or a trailing newline comes back out of the block different. The Q23 claim
 * — this action carries the same text as copy, export and save — is made true
 * upstream: `stampArtifact` emits every artifact in the canonical shape (LF line
 * endings, no trailing newline), on which both rewrites are no-ops. A string
 * that did not come from `stampArtifact` gets no such guarantee here.
 * `provenance.test.ts` runs the hostile set (CRLF, lone CR, trailing LFs,
 * U+2028) through both functions.
 *
 * Every sentence around the block is fixed. Nothing from the artifact — not its
 * title, type or module, let alone its body — is interpolated into them, so no
 * artifact can write an instruction here. The lead does not tell the model to
 * carry out what the block says either: `dataSection` announces the block as
 * data, and an artifact's own wording is not this wrapper's to grant authority
 * to. What to do with it is the next thing the operator types.
 */
import { dataSection, fenceBlock } from "../fence.ts";
import { joinParts } from "./compose.ts";

const TITLE = "# 工作台产物";
const LEAD =
  "下面是我从工作台复制出来的一份产物正文，先读完它；我接下来会说明要拿它做什么。";
const TAIL = "涉及数字与事实时，没有依据就标 [需补数据]，不要编造。";

export function agentTaskWrapper(body: string): string {
  return joinParts([TITLE, LEAD, dataSection(fenceBlock(body)), TAIL]);
}
