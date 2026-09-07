// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { GeoKnowledgePack } from "./geo-knowledge-pack.tsx";
import { geoKnowledgePackFixture } from "./geo-knowledge-pack.test-fixtures.ts";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(locale = "zh", pack = geoKnowledgePackFixture()) {
  await act(async () => root.render(<GeoKnowledgePack pack={pack} locale={locale} heading={3} />));
}

it("renders all customer knowledge modules in the shared section-card language", async () => {
  await render();

  const headings = Array.from(host.querySelectorAll("h3")).map((node) => node.textContent);
  expect(headings).toEqual([
    "实体定义",
    "可靠事实",
    "问答知识",
    "对比知识",
    "能力边界",
    "证据与可信度",
    "机器可读状态",
    "覆盖与缺口",
  ]);
  expect(host.textContent).toContain("Example Cloud gives small teams a shared workflow");
  expect(host.textContent).toContain("Does Example Cloud replace human approval?");
  expect(host.textContent).toContain("Rival");
  expect(host.textContent).toContain("Publish an About page with company history.");
  expect(host.querySelectorAll("section.rounded-card")).toHaveLength(8);
});

it("shows public evidence labels and links without exposing internal lineage", async () => {
  const pack = geoKnowledgePackFixture();
  await render("en", pack);

  expect(host.querySelector('a[href="https://example.com/"]')).not.toBeNull();
  expect(host.querySelector('a[href="https://example.com/docs"]')).not.toBeNull();
  expect(host.textContent).toContain("Product page");
  expect(host.querySelector("[data-public-sources]")?.textContent).toContain("Sep 4, 2026");
  for (const hidden of [
    pack.contentHash,
    pack.meta.generatedAt,
    "marketing-geo-knowledge-pack.v1",
    "source:home",
    "source:rival",
    "fact:approval",
    "qa:approval",
    "comparison:rival",
  ]) expect(host.textContent).not.toContain(hidden);
  expect(host.querySelector("details")).toBeNull();
});

it("renders partial and unavailable states honestly without raw reason codes", async () => {
  const original = geoKnowledgePackFixture();
  const pack = {
    ...original,
    facts: { status: "unavailable" as const, reason: "insufficient_evidence" as const },
    machine: { status: "unavailable" as const, reason: "timeout" as const },
  };
  await render("zh", pack);

  expect(host.textContent).toContain("当前限制");
  expect(host.textContent).toContain("Only questions supported by the published pages are included.");
  expect(host.textContent).toContain("现有证据不足，暂时无法形成这部分内容");
  expect(host.textContent).toContain("读取公开页面超时，暂时无法确认这部分内容");
  expect(host.textContent).not.toContain("insufficient_evidence");
  expect(host.textContent).not.toContain("timeout");
});

it("keeps every comparison-row evidence state visible on desktop and mobile", async () => {
  const original = geoKnowledgePackFixture();
  if (original.comparisons.status === "unavailable") throw new Error("Comparison fixture required");
  const comparison = original.comparisons.value[0]!;
  const row = comparison.rows[0]!;
  const pack = { ...original, comparisons: { ...original.comparisons, value: [{ ...comparison, rows: [
    { ...row, id: "row:both", availability: "partial" as const },
    { ...row, id: "row:product", competitor: null, availability: "partial" as const },
    { ...row, id: "row:competitor", product: null, availability: "partial" as const },
    { ...row, id: "row:none", product: null, competitor: null, availability: "unavailable" as const },
  ] }] } };
  await render("en", pack);

  const statuses = Array.from(host.querySelectorAll("[data-comparison-row-status]"));
  expect(statuses.map(node => node.textContent)).toEqual(["Partial evidence", "Partial evidence", "Partial evidence", "Not enough evidence"]);
  expect(statuses.every(node => !node.classList.contains("sm:hidden"))).toBe(true);
});

it("uses explicit compact text elements instead of bare paragraphs that inherit the global p scale", async () => {
  await render();
  expect(host.querySelector("p")).toBeNull();
  expect(host.querySelectorAll('[data-knowledge-copy="compact"]')).not.toHaveLength(0);
  expect(Array.from(host.querySelectorAll('[data-knowledge-copy="compact"]')).every((node) => node.classList.contains("text-[13px]"))).toBe(true);
});
