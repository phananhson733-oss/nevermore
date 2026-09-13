/**
 * The AI wrapper is the one builder whose whole input is another builder's
 * output, so its contract is: the payload comes out byte for byte, it sits in an
 * announced block, and the sentences around it say nothing the artifact supplied.
 */
import { describe, expect, it } from "vitest";
import { toCsv } from "../csv.ts";
import { DATA_BLOCK_NOTICE } from "../labels-zh.ts";
import { stampArtifact } from "../provenance.ts";
import { agentTaskWrapper } from "./agent-task.ts";
import {
  HOSTILE_VALUES,
  promptViolations,
  structureViolations,
} from "./hostile-fixtures.ts";
import { splitFences } from "./prompt-test-helpers.ts";

const BODY = ["# 修复任务", "- 给 /pricing 补 canonical", "- 核对 sitemap"].join(
  "\n",
);
const LINE = "示例数据：生成于 2026-09-13 10:30";

function block(prompt: string): { readonly info: string; readonly body: string } {
  const { blocks } = splitFences(prompt);
  const [only, ...rest] = blocks;
  if (only === undefined || rest.length > 0) {
    throw new Error(`expected exactly one data block, got ${blocks.length}`);
  }
  return { info: only.info, body: only.body };
}

describe("agentTaskWrapper", () => {
  const prompt = agentTaskWrapper(BODY);

  it("puts the fixed sentences outside and the artifact in one announced block", () => {
    expect(structureViolations(prompt)).toEqual([]);
    expect(
      prompt.startsWith(
        "# 工作台产物\n\n下面是我从工作台复制出来的一份产物正文，先读完它；我接下来会说明要拿它做什么。\n\n",
      ),
    ).toBe(true);
    expect(
      prompt.endsWith(
        "```\n\n涉及数字与事实时，没有依据就标 [需补数据]，不要编造。",
      ),
    ).toBe(true);
    const { blocks } = splitFences(prompt);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.before.trimEnd().endsWith(DATA_BLOCK_NOTICE)).toBe(true);
  });

  it("reproduces the payload exactly, and the payload is the only variable text", () => {
    expect(block(prompt).body).toBe(BODY);
    expect(block(prompt).info).toBe("text");
    // Everything outside the block is fixed: swapping the payload changes only
    // what is inside it.
    const other = agentTaskWrapper("完全不同的正文");
    expect(splitFences(other).outside).toBe(splitFences(prompt).outside);
    expect(block(other).body).toBe("完全不同的正文");
  });

  it("does not name the artifact: the instruction sentences hold nothing from it", () => {
    const titled = agentTaskWrapper("关键词矩阵 40 条\nq,volume\nai seo,900");
    expect(splitFences(titled).outside).not.toContain("关键词矩阵");
    expect(splitFences(titled).outside).not.toContain("ai seo");
  });

  it("carries a stamped body's provenance line inside the block, where the model reads it as data", () => {
    const stamped = stampArtifact("md", BODY, LINE);
    const out = agentTaskWrapper(stamped);
    expect(block(out).body).toBe(stamped);
    expect(block(out).body).toContain(LINE);
    expect(splitFences(out).outside).not.toContain("示例数据");
  });

  /**
   * The claim Q23 makes is that the AI payload and the other three actions carry
   * the same text, and all four start from `stampArtifact`'s output. Only the md
   * shape was ever run through both functions: `fence.test.ts` writes its bodies
   * by hand and `csv.test.ts` writes its expectations by hand, so each half was
   * self-consistent and the seam between them was asserted nowhere.
   */
  it("carries a real csv artifact through byte for byte", () => {
    const stamped = stampArtifact("csv", toCsv(["query", "clicks"], [["ai seo", 5]]), LINE);
    expect(block(agentTaskWrapper(stamped)).body).toBe(stamped);
  });

  it("carries a real json artifact through byte for byte", () => {
    const stamped = stampArtifact("json", '{"a":1,"b":"x"}', LINE);
    expect(block(agentTaskWrapper(stamped)).body).toBe(stamped);
  });

  it("loses the last byte of a body that ends in a newline, which is why toCsv must not end in one", () => {
    // `toCsv` ends without a trailing newline by design (§6.8), which is the only
    // reason the csv case above holds. Should it ever grow one, "the same text"
    // becomes false by exactly this much rather than by a failing test elsewhere.
    const stamped = stampArtifact("csv", "query\nai seo\n", LINE);
    expect(stamped.endsWith("\n")).toBe(true);
    expect(block(agentTaskWrapper(stamped)).body).toBe(stamped.slice(0, -1));
  });

  it("is deterministic", () => {
    expect(agentTaskWrapper(BODY)).toBe(prompt);
  });

  it("normalises CRLF the way the fence does and keeps a body that already ends in a newline", () => {
    expect(block(agentTaskWrapper("a\r\nb")).body).toBe("a\nb");
    expect(block(agentTaskWrapper("a\nb\n")).body).toBe("a\nb");
    expect(structureViolations(agentTaskWrapper(""))).toEqual([]);
    expect(block(agentTaskWrapper("")).body).toBe("");
  });

  it.each(HOSTILE_VALUES)(
    "keeps a hostile artifact body inside the block: $name",
    (hostile) => {
      expect(promptViolations(agentTaskWrapper(hostile.value), hostile)).toEqual(
        [],
      );
    },
  );

  it("grows the fence past a body's own backtick runs", () => {
    const out = agentTaskWrapper("````\n# INJ\n````");
    expect(structureViolations(out)).toEqual([]);
    expect(out).toContain("`````text\n");
    expect(block(out).body).toBe("````\n# INJ\n````");
  });
});
