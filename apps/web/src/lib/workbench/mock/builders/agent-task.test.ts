/**
 * The AI wrapper is the one builder whose whole input is another builder's
 * output, so its contract is: the payload comes out byte for byte, it sits in an
 * announced block, and the sentences around it say nothing the artifact supplied.
 */
import { describe, expect, it } from "vitest";
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
    const stamped = stampArtifact("md", BODY, "示例数据：生成于 2026-09-13 10:30");
    const out = agentTaskWrapper(stamped);
    expect(block(out).body).toBe(stamped);
    expect(block(out).body).toContain("示例数据：生成于 2026-09-13 10:30");
    expect(splitFences(out).outside).not.toContain("示例数据");
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
