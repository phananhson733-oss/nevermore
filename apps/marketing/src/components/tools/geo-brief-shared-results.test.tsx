// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geoBriefFixture } from "@sf/public-tools/content-brief/geo-fixtures";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { CONTENT_BRIEF_HANDOFF_KEY } from "@sf/public-tools/content-brief/contract";
import { SharedGeoBriefResults } from "./geo-brief-shared-results.tsx";
import { sharedGeoBriefFileName, sharedGeoBriefJson, sharedGeoBriefMarkdown } from "../../lib/geo-tools/brief-shared-export.ts";
import en from "../../i18n/messages/en.json";

let root: Root | null = null;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(brief: GeoContentBrief, roleLabel?: string) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><SharedGeoBriefResults brief={brief} roleLabel={roleLabel} /></NextIntlClientProvider>));
  return host;
}
async function clickButton(host: Element, label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(button => button.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
  });
}

describe("GEO Brief Artifact result presentation", () => {
  it("uses semantic question and fact tables, preserving sources and null reasons", async () => {
    const brief = await geoBriefFixture();
    const host = await render(brief);
    expect(Array.from(host.querySelectorAll("[data-brief-section]")).map(node => node.getAttribute("data-brief-section"))).toEqual(["geo_origin", "lead_answer", "must_answer", "fact_table", "outline", "fields", "internal_links"]);
    const questions = host.querySelector('[data-brief-section="must_answer"] table');
    expect(questions).not.toBeNull();
    expect(Array.from(questions!.querySelectorAll("thead th")).map(cell => [cell.textContent, cell.getAttribute("scope")])).toEqual([["id", "col"], ["Question", "col"], ["Coverage", "col"], ["Source", "col"]]);
    const rows = questions!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(brief.must_answer.items.length);
    expect(rows[0]?.textContent).toContain(en.tools.geoBrief.shared.requirement);
    expect(rows[1]?.querySelectorAll("td")[1]?.textContent).toBe("2 / 2 answered samples");
    expect(rows[1]?.querySelector('[title="observed in answer samples"]')?.textContent).toBe("ai_sample");
    const facts = host.querySelector('[data-brief-section="fact_table"] table');
    expect(facts?.querySelectorAll("thead th")).toHaveLength(3);
    const missing = Array.from(facts!.querySelectorAll("tbody tr")).find(row => row.textContent?.includes("Price"));
    expect(missing?.querySelectorAll("td")[0]?.textContent).toBe("—");
    expect(missing?.querySelectorAll("td")[1]?.textContent).toContain("null · missing");
    expect(missing?.textContent).toContain("do not put a value on this");
    expect(host.querySelector('[data-brief-section="outline"]')?.textContent).toContain("H2 · Direct answer");
    expect(host.querySelector('[data-brief-section="outline"]')?.textContent).toContain("Answers Q1");
  });

  it("shows frozen version anchors, readable role and actual receipts without adding failed samples to coverage", async () => {
    const brief = await geoBriefFixture();
    brief.geo_origin.sample_refs.push("S3");
    brief.evidence.samples.push({ ...brief.evidence.samples[0]!, id: "S3", status: "failed", excerpt: "", topics: [] });
    const host = await render(brief, "Buyer · small team");
    const origin = host.querySelector('[data-brief-section="geo_origin"]')!;
    expect(origin.textContent).toContain("Buyer · small team");
    expect(origin.textContent).toContain("kb@v1");
    expect(origin.textContent).toContain("fixture-promptset/v1");
    expect(origin.textContent).toContain("fixture-1");
    expect(origin.textContent).toContain(brief.geo_origin.kb_ref.content_hash);
    expect(origin.textContent).toContain(brief.geo_origin.promptset_ref.hash);
    expect(origin.querySelectorAll("details details")).toHaveLength(0);
    const receipt = Array.from(origin.querySelectorAll("details")).find(item => item.querySelector("summary")?.textContent?.includes("S3"));
    expect(receipt?.textContent).toContain("failed");
    expect(receipt?.textContent).toContain("2026-08-30T00:00:00.000Z");
    const questions = host.querySelector('[data-brief-section="must_answer"]')!;
    expect(questions.textContent).toContain("2 / 2 answered samples");
    expect(questions.textContent).toContain("1 failed samples are excluded from coverage.");
    expect(questions.textContent).not.toContain("2 / 3");
    expect(host.textContent?.toLowerCase()).not.toContain("timeout");
  });

  it("copies and downloads the unchanged result and stages that exact object for Draft", async () => {
    const brief = await geoBriefFixture(); const original = JSON.stringify(brief);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const blobs: Blob[] = []; const downloads: { href: string; name: string }[] = [];
    const revoke = vi.fn(); const BaseURL = URL;
    vi.stubGlobal("URL", class extends BaseURL {
      static override createObjectURL(blob: Blob) { blobs.push(blob); return `blob:fixture-${blobs.length}`; }
      static override revokeObjectURL = revoke;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) { downloads.push({ href: this.href, name: this.download }); });
    const host = await render(brief, "Display-only role name");
    await clickButton(host, en.tools.geoBrief.actions.copy);
    expect(writeText).toHaveBeenCalledWith(sharedGeoBriefMarkdown(brief));
    expect(host.textContent).toContain(en.tools.geoBrief.actions.copied);
    await clickButton(host, en.tools.geoBrief.actions.downloadMarkdown);
    await clickButton(host, en.tools.geoBrief.actions.downloadJson);
    expect(await blobText(blobs[0]!)).toBe(sharedGeoBriefMarkdown(brief));
    expect(await blobText(blobs[1]!)).toBe(sharedGeoBriefJson(brief));
    expect(downloads).toEqual(["md", "json"].map((extension, index) => ({ href: `blob:fixture-${index + 1}`, name: sharedGeoBriefFileName(brief, extension as "md" | "json") })));
    expect(revoke.mock.calls).toEqual([["blob:fixture-1"], ["blob:fixture-2"]]);
    const link = host.querySelector<HTMLAnchorElement>("[data-geo-to-draft]")!;
    expect(link.getAttribute("href")).toBe("/tools/content-draft");
    expect(link.target).toBe("_blank"); expect(link.rel).toBe("opener");
    await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    expect(JSON.parse(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)!).brief).toEqual(brief);
    expect(host.querySelector("[data-geo-market-language]")?.textContent).toBe("market: US · language: en");
    expect(JSON.stringify(brief)).toBe(original);
  });

  it("blocks Draft navigation when storage fails and reports clipboard failure", async () => {
    const host = await render(await geoBriefFixture());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const link = host.querySelector<HTMLAnchorElement>("[data-geo-to-draft]")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.tools.geoBrief.shared.handoffFailed);
    vi.stubGlobal("navigator", {});
    await clickButton(host, en.tools.geoBrief.actions.copy);
    expect(host.textContent).toContain(en.tools.geoBrief.actions.copyFailed);
  });

  it("keeps manual, unavailable and empty result states explicit without a Draft action", async () => {
    const brief = await geoBriefFixture();
    brief.geo_origin = { ...brief.geo_origin, kind: "manual", role: null, layer: null, gap: null, run_ref: null, sample_refs: [] };
    brief.evidence.samples = []; brief.fact_table = []; brief.lead_answer.source = "user_input";
    brief.must_answer.items = [{ ...brief.must_answer.items[0]!, source: "user_input", sample_total: 0 }];
    brief.outline = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    brief.internal_links = { status: "available", items: [] }; brief.draft_readiness.writable = [];
    const host = await render(brief);
    expect(host.textContent).toContain(en.tools.geoBrief.shared.noEvidence);
    expect(host.textContent).toContain(en.tools.geoBrief.shared.manualNote);
    expect(host.querySelector('[data-brief-section="outline"]')?.textContent).toContain("Unavailable: insufficient_evidence");
    expect(host.querySelector('[data-brief-section="fact_table"]')?.textContent).toContain("No facts available");
    expect(host.querySelector('[data-brief-section="internal_links"]')?.textContent).toContain("No internal links in the site index");
    expect(host.querySelector("[data-geo-to-draft]")).toBeNull();
  });
});
