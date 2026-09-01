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

async function render(brief: GeoContentBrief, roleLabel?: string, questionNeedsRevision = false) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><SharedGeoBriefResults brief={brief} roleLabel={roleLabel} questionNeedsRevision={questionNeedsRevision} /></NextIntlClientProvider>));
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
  it("prioritizes repairing missing facts and offers only an explicitly limited structural Draft", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = []; brief.evidence.facts = []; brief.evidence.samples = [];
    brief.geo_origin = { ...brief.geo_origin, kind: "manual", role: null, gap: null, run_ref: null, sample_refs: [] };
    brief.draft_readiness = { writable: ["O1", "O2"], gaps: [] };
    const host = await render(brief);
    expect(host.querySelector("[data-brief-quality]")?.getAttribute("data-brief-quality")).toBe("structure_only");
    expect(host.textContent).toContain("0 facts with source records");
    expect(host.textContent).toContain("0 observed topics from 0 answered samples");
    expect(host.textContent).toContain("General question · not persona-specific");
    expect(host.textContent).not.toContain("writable sections");
    expect(host.querySelector("[data-geo-to-draft]")?.textContent).toBe("Continue with a structure-only Draft");
    expect(host.querySelector('[data-geo-knowledge-repair="facts"]')?.getAttribute("href")).toBe("/tools/geo-knowledge-base?repair=brief");
    expect(host.querySelector('[data-geo-run-visibility]')?.getAttribute("href")).toBe("/tools/ai-visibility-check");
  });

  it("retains a historical question verbatim but blocks Draft when the exact frozen version needs revision", async () => {
    const brief = await geoBriefFixture();
    const question = "What are the top 占星工具 tools right now?";
    brief.geo_origin.question.text = question; brief.keyword.primary = question;
    const original = JSON.stringify(brief);
    const host = await render(brief, undefined, true);
    expect(host.textContent).toContain(question);
    expect(host.querySelector("[data-brief-quality]")?.getAttribute("data-brief-quality")).toBe("revise_question");
    expect(host.querySelector("[data-geo-to-draft]")).toBeNull();
    expect(host.textContent).toContain("Revise the question before writing");
    expect(JSON.stringify(brief)).toBe(original);
  });

  it("keeps machine fields and storage instructions in technical details, not primary copy", async () => {
    const brief = await geoBriefFixture();
    const host = await render(brief);
    const primary = host.cloneNode(true) as HTMLElement;
    primary.querySelectorAll("details").forEach(node => node.remove());
    expect(primary.textContent).not.toMatch(/geo_origin|lead_answer|must_answer|fact_table|internal_links|intent_derived|geo_not_serp|insufficient_evidence|sessionStorage|requirement\s*required_entities/);
    expect(primary.textContent).toContain("System opening rule based on the frozen question");
    expect(primary.textContent).toContain("Writing requirement · not observed coverage");
    expect(primary.textContent).toContain("Topic observed in answer samples");
    expect(primary.textContent).toContain("This GEO workflow does not inspect search results");
    expect(host.querySelector("details[data-geo-technical]")?.textContent).toContain(brief.run.fingerprint);
  });

  it("gives frozen website-profile fact keys readable labels without replacing their values", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table[0]!.label = "coreFeatures[0]";
    const host = await render(brief);
    const facts = host.querySelector('[data-brief-section="fact_table"]')!;
    expect(facts.textContent).toContain("Product capability");
    expect(facts.textContent).not.toContain("coreFeatures[0]");
    expect(facts.textContent).toContain(brief.fact_table[0]!.value);
    expect(host.querySelector("details[data-geo-technical]")?.textContent).toContain("coreFeatures[0]");
  });

  it("collapses unavailable profile fields while retaining sourced and explicit knowledge rows", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table[1] = { ...brief.fact_table[1]!, label: "productName", reason: "notPublished" };
    brief.geo_origin.profile_ref = {
      website_id: "fixture-website",
      snapshot_id: "fixture-profile",
      snapshot_revision: 1,
      profile_schema: "marketing-website-profile.v1",
      profile_hash: "d".repeat(64),
    };
    const profileLabels = ["productName", "oneLinePositioning", ...Array.from({ length: 8 }, (_, index) => `coreFeatures[${index}]`)];
    brief.fact_table.push(...profileLabels.map((label, index) => ({
      id: `F${index + 3}`,
      label,
      value: null,
      reason: "unverified" as const,
      evidence_refs: [],
    })));
    const before = JSON.stringify(brief);

    const host = await render(brief);
    const quality = host.querySelector("[data-brief-quality]")!;
    expect(quality.textContent).toContain("Knowledge-base or crawl facts without a usable value or matching source record: 1.");
    expect(quality.textContent).toContain("Website-profile fields excluded from writable facts because they lack a per-field source record: 10.");
    const facts = host.querySelector('[data-brief-section="fact_table"]')!;
    const rows = facts.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(brief.fact_table[0]!.value);
    expect(rows[1]?.textContent).toContain("Product name");
    expect(rows[1]?.textContent).toContain(en.tools.geoBrief.quality.factReasons.notPublished);
    const profileNotice = facts.querySelector("[data-geo-profile-facts-excluded]");
    expect(profileNotice?.textContent).toContain("10 website-profile fields lack a per-field source record, so their values are excluded from writable facts.");
    expect(profileNotice?.querySelector('[data-geo-knowledge-repair="profile"]')).not.toBeNull();
    expect(facts.textContent?.match(/Product name/g)).toHaveLength(1);
    expect(facts.textContent).not.toContain("One-line positioning");
    expect(facts.textContent).not.toContain("Product capability");
    const technical = host.querySelector("details[data-geo-technical]")!;
    for (const label of profileLabels) expect(technical.textContent).toContain(label);
    expect(JSON.stringify(brief)).toBe(before);
  });

  it("offers concrete repair routes for missing profile and site-index evidence even with usable facts", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = brief.fact_table.filter(fact => fact.value !== null);
    brief.evidence.site_index = [];
    brief.internal_links = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    const host = await render(brief);
    const limitations = host.querySelector("[data-brief-quality]")!;
    expect(limitations.querySelector('a[href="/tools/geo-knowledge-base?repair=brief"]')).not.toBeNull();
    const links = host.querySelector('[data-brief-section="internal_links"]')!;
    expect(links.textContent).toContain("No usable site index was supplied");
    expect(links.querySelector('a[href="/tools/ai-visibility-check"]')).not.toBeNull();
  });

  it("treats linked answers with no reusable observed topics as limited evidence", async () => {
    const brief = await geoBriefFixture();
    brief.fact_table = brief.fact_table.filter(fact => fact.value !== null);
    for (const sample of brief.evidence.samples) sample.topics = [];
    for (const item of brief.must_answer.items) if (item.source === "ai_sample") { item.covered_by = 0; item.cluster.members = []; }
    const host = await render(brief);
    expect(host.querySelector("[data-brief-quality]")?.getAttribute("data-brief-quality")).toBe("limited");
    expect(host.textContent).toContain("Linked answers were present, but they did not yield reusable observed topics.");
  });

  it("does not call an older B gap absent when displaying a valid historical result", async () => {
    const brief = await geoBriefFixture(); brief.geo_origin.gap = "B";
    const host = await render(brief);
    const origin = host.querySelector('[data-brief-section="geo_origin"]')!;
    expect(origin.textContent).toContain(en.tools.geoBrief.quality.gapB);
    expect(origin.textContent).not.toContain("No visibility gap linked");
  });

  it("uses semantic question and fact tables, preserving sources and null reasons", async () => {
    const brief = await geoBriefFixture();
    const host = await render(brief);
    expect(Array.from(host.querySelectorAll("[data-brief-section]")).map(node => node.getAttribute("data-brief-section"))).toEqual(["geo_origin", "lead_answer", "must_answer", "fact_table", "outline", "fields", "internal_links"]);
    const questions = host.querySelector('[data-brief-section="must_answer"] table');
    expect(questions).not.toBeNull();
    expect(Array.from(questions!.querySelectorAll("thead th")).map(cell => [cell.textContent, cell.getAttribute("scope")])).toEqual([["ID", "col"], ["Question", "col"], ["Coverage", "col"], ["Source", "col"]]);
    const rows = questions!.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(brief.must_answer.items.length);
    expect(rows[0]?.textContent).toContain(en.tools.geoBrief.quality.requiredItem);
    expect(rows[1]?.querySelectorAll("td")[1]?.textContent).toBe("2 / 2 answered samples");
    expect(rows[1]?.querySelector('[data-source="ai_sample"]')?.textContent).toBe(en.tools.geoBrief.quality.observedQuestion);
    const facts = host.querySelector('[data-brief-section="fact_table"] table');
    expect(facts?.querySelectorAll("thead th")).toHaveLength(3);
    const missing = Array.from(facts!.querySelectorAll("tbody tr")).find(row => row.textContent?.includes("Price"));
    expect(missing?.querySelectorAll("td")[0]?.textContent).toBe(en.tools.geoBrief.quality.noValue);
    expect(missing?.querySelectorAll("td")[1]?.textContent).toContain(en.tools.geoBrief.quality.factReasons.missing);
    expect(missing?.textContent).toContain(en.tools.geoBrief.quality.factRestriction);
    expect(host.querySelector("[data-geo-technical]")?.textContent).toContain('"reason": "missing"');
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
    expect(origin.textContent).toContain("Knowledge base · version 1");
    expect(origin.textContent).toContain("fixture-promptset/v1");
    expect(origin.textContent).toContain("fixture-1");
    expect(origin.textContent).toContain(brief.geo_origin.kb_ref.content_hash);
    expect(origin.textContent).toContain(brief.geo_origin.promptset_ref.hash);
    expect(origin.querySelectorAll("details details")).toHaveLength(0);
    const receipt = Array.from(origin.querySelectorAll("details")).find(item => item.querySelector("summary")?.textContent?.includes("S3"));
    expect(receipt?.textContent).toContain("Failed · excluded from coverage");
    expect(receipt?.querySelector("time")?.dateTime).toBe("2026-08-30T00:00:00.000Z");
    expect(receipt?.textContent).toContain("Aug 30, 2026");
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
    expect(host.querySelector("[data-geo-market-language]")?.textContent).toBe("Market: US · Output language: en");
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
    brief.geo_origin.question.id = null;
    brief.evidence.samples = []; brief.fact_table = []; brief.lead_answer.source = "user_input";
    brief.must_answer.items = [{ ...brief.must_answer.items[0]!, source: "user_input", sample_total: 0 }];
    brief.outline = { status: "unavailable", reason: "insufficient_evidence", attempted: 0 };
    brief.internal_links = { status: "available", items: [] }; brief.draft_readiness.writable = [];
    const host = await render(brief);
    expect(host.textContent).toContain(en.tools.geoBrief.quality.origin.typed_question);
    expect(host.textContent).toContain(en.tools.geoBrief.quality.openingManual);
    expect(host.querySelector('[data-brief-section="outline"]')?.textContent).toContain(en.tools.geoBrief.quality.noOutline);
    expect(host.querySelector('[data-brief-section="fact_table"]')?.textContent).toContain("No facts available");
    expect(host.querySelector('[data-brief-section="internal_links"]')?.textContent).toContain("No internal links in the site index");
    expect(host.querySelector("[data-geo-to-draft]")).toBeNull();
  });
});
