/**
 * The "copy for an AI agent" wrapper (Q23, R6). One artifact's canonical text
 * goes in and a prompt comes out with that text appearing exactly once, inside
 * the announced fenced block, byte for byte apart from the line endings
 * `fenceBlock` normalises — so this action and the other three (copy, export,
 * save) all carry the same payload.
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
