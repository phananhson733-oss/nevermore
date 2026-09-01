// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "../../lib/geo-tools/kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2, type GeoCompetitorEvidenceV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import type { GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoQuestionSetV2 } from "../../lib/geo-tools/kb-question-set-v2.ts";
import { GeoKbVersionContent, type GeoKbVersionContentProps } from "./geo-kb-version-content.tsx";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";

const TIME = "2026-08-31T00:00:00.000Z";
const RECEIPT = "33333333-3333-4333-8333-333333333333";
function fixture(): GeoKbVersionContentProps {
  const base = completePayloadV2();
  const payload: GeoKbPayloadV2 = { ...base, officialName: "Acme matching name", aliases: ["Acme", "Acme Analytics"], categoryTerms: ["analytics software"],
    roles: [{ ...base.roles[0]!, source: { kind: "model", generationId: "generation-record-1", itemId: "original-role-1", evidenceRefs: ["manual:r1"] } }],
    facts: [base.facts[0]!, { ...base.facts[0]!, key: "Free plan", value: "Unlimited free plan", review: "pending" },
      { ...base.facts[0]!, key: "Conflicting price", value: "10 dollars", reason: "conflicting", review: "excluded" },
      { ...base.facts[0]!, key: "Crawled seats", value: "5", sourceUrl: "https://example.com/pricing?plan=team#limits", supportRef: { receiptId: RECEIPT, evidenceId: "F1" } }] };
  const semantic = questionSetV2();
  const questionSet: GeoQuestionSetV2 = { ...semantic, registryVersion: "registry.v1", questions: [semantic.questions[0]!,
    { id: "global-question", text: "Which analytics software is suitable?", layer: "discovery", mode: "retrieval", roleId: null, requiredEntities: [], templateId: "registry-template", calibrated: true, provenance: { kind: "registry", generatorVersion: "registry.v1", evidenceRefs: [], entityRefs: [] } }] };
  const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet,
    sourceReceiptRefs: [{ receiptId: RECEIPT, contentHash: "a".repeat(64) }],
    evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams struggle with late invoices" }],
    sourceSummary: { gsc: { status: "available", reason: null, property: "sc-domain:example.com", window: { startDate: "2026-06-01", endDate: "2026-08-29" }, queryCount: 7, truncated: true, observedAt: TIME }, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 29, gsc: 7, crawl: 3, manual: 1 } },
    modelRoleEdits: { r1: true }, verifiedFactSupport: [{ receiptId: RECEIPT, evidenceId: "F1", key: "Crawled seats", value: "5", sourceUrl: "https://example.com/pricing?plan=team#limits", observedAt: TIME }] });
  return { payload, questionSet, context, locale: "en" };
}
function captureFixture(captures?: readonly GeoCompetitorEvidenceV2[]): GeoKbVersionContentProps {
  const base = fixture(), payload = { ...base.payload, competitors: [{ domain: "rival.example", brandName: "Manual Rival", aliases: ["Manual Rival Alias"], confirmed: true }, { domain: "conflict.example", brandName: "", aliases: [], confirmed: false }] };
  const competitorEvidence: readonly GeoCompetitorEvidenceV2[] = captures ?? [
    { receiptId: RECEIPT, contentHash: "a".repeat(64), receiptCreatedAt: TIME, capture: { evidenceId: "C1", domain: "rival.example", confirmed: false, source: null, sourceUrl: "https://rival.example/?capture=1", observedAt: null, bodyHash: null, status: "unavailable", reason: "fetch_failed", brandName: null, aliases: [], method: null, signals: [], signalsTruncated: false } },
    { receiptId: RECEIPT, contentHash: "a".repeat(64), receiptCreatedAt: TIME, capture: { evidenceId: "C2", domain: "conflict.example", confirmed: false, source: "crawl", sourceUrl: "https://conflict.example/", observedAt: TIME, bodyHash: "d".repeat(64), status: "conflict", reason: "identity_conflict", brandName: null, aliases: [], method: "conflicting_signals", signalsTruncated: false, signals: ["Captured Alpha", "Captured Beta"].map(name => ({ kind: "json_ld_organization", name, aliases: [], url: "https://conflict.example/", hostMatched: true, excludedReason: null })) } },
  ];
  return { ...base, payload, context: buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet: base.questionSet, sourceReceiptRefs: base.context.sourceReceiptRefs, evidenceCatalog: base.context.evidenceCatalog, sourceSummary: base.context.sourceSummary, modelRoleEdits: { r1: true }, competitorEvidence,
    verifiedFactSupport: [{ receiptId: RECEIPT, evidenceId: "F1", key: "Crawled seats", value: "5", sourceUrl: "https://example.com/pricing?plan=team#limits", observedAt: TIME }] }) };
}
let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchSpy = vi.fn(() => { throw new Error("Read-only version must not fetch"); }); vi.stubGlobal("fetch", fetchSpy);
  errorSpy = vi.spyOn(console, "error");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); errorSpy.mockRestore(); vi.unstubAllGlobals(); });
async function render(props = fixture()) {
  await act(async () => root.render(<NextIntlClientProvider locale={props.locale} timeZone="UTC" messages={props.locale === "zh" ? zh : en}><GeoKbVersionContent {...props} /></NextIntlClientProvider>));
}

describe("complete V2 knowledge-base version content", () => {
  it("renders shared Profile, identity, role details, review and original model lineage", async () => {
    const props = fixture(); await render(props);
    expect(host.querySelector('[data-geo-profile-field="productName"] input')).toHaveProperty("value", "Acme");
    for (const text of ["Acme matching name", "Acme Analytics", "analytics software", "rival.example", "Rival Analytics", "Finance teams", "small companies", "late invoices", "spreadsheets", "setup effort", "receivables", "generation-record-1", "original-role-1", "Model proposal", "User edited the model proposal"]) expect(host.textContent).toContain(text);
    expect(host.querySelector('[data-version-role="r1"] [data-role-user-edited]')?.textContent).toBe("Yes");
    expect(host.textContent).toContain(geoKbV2Copy("en").profileDescription);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(errorSpy).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("input,textarea")].every(node => (node as HTMLInputElement).readOnly)).toBe(true);
  });
  it("shows the declared fact independently from the actual admitted context value and source", async () => {
    await render();
    const pending = host.querySelector('[data-version-fact="Free plan"]');
    expect(pending?.textContent).toContain("Unlimited free plan");
    expect(pending?.querySelector("[data-admitted-value]")?.textContent).toBe("Not admitted as positive evidence");
    expect(pending?.textContent).toContain("Pending review");
    const conflict = host.querySelector('[data-version-fact="Conflicting price"]');
    expect(conflict?.textContent).toContain("10 dollars"); expect(conflict?.textContent).toContain("Conflicting evidence");
    expect(host.querySelector('[data-version-fact="Seats"]')?.textContent).toContain("User-confirmed declaration");
    expect(host.querySelector('[data-version-fact="Crawled seats"]')?.textContent).toContain("Crawl-supported");
    expect(host.querySelector('[data-version-fact="Crawled seats"] [data-admitted-value]')?.textContent).toBe("5");
    expect([...host.querySelectorAll("h1,h2,h3,h4")].map(node => node.textContent).join(" ")).not.toMatch(/verified facts|已核实事实/iu);
  });
  it("renders every question with readable role names, all-roles scope and calibration provenance", async () => {
    await render();
    expect(host.querySelectorAll("[data-version-question]")).toHaveLength(2);
    const semantic = host.querySelector('[data-version-question="q1"]');
    expect(semantic?.querySelector("[data-question-role]")?.textContent).toBe("Finance teams");
    expect(semantic?.textContent).toContain("late invoices"); expect(semantic?.textContent).toContain("Uncalibrated"); expect(semantic?.textContent).toContain("Semantic generation");
    const global = host.querySelector('[data-version-question="global-question"]');
    expect(global?.querySelector("[data-question-role]")?.textContent).toBe("All roles");
    expect(global?.textContent).toContain("Calibrated registry probe"); expect(global?.textContent).toContain("registry-template");
  });
  it("shows actual source metadata, selected/available counts and expandable original evidence", async () => {
    await render();
    expect(host.textContent).toContain("sc-domain:example.com"); expect(host.textContent).toContain("2026-06-01"); expect(host.textContent).toContain("2026-08-29"); expect(host.textContent).toContain(TIME);
    expect(host.querySelector("[data-gsc-query-count]")?.textContent).toBe("7");
    expect(host.querySelector('[data-source-count="profile"]')?.textContent).toContain("29");
    expect(host.querySelector('[data-source-count="manual"]')?.querySelector("[data-selected-count]")?.textContent).toBe("1");
    const evidence = host.querySelector("details[data-evidence-catalog]");
    expect(evidence?.querySelector("summary")).not.toBeNull(); expect(evidence?.textContent).toContain("Finance teams struggle with late invoices");
    expect(evidence?.textContent).toContain("manual:r1");
  });
  it.each([null, { status: "unavailable", reason: "not_connected", property: null, window: null, queryCount: null, truncated: null, observedAt: null }] as const)("does not turn unavailable GSC metadata into zero", async gsc => {
    const props = fixture();
    await render({ ...props, context: { ...props.context, sourceSummary: { ...props.context.sourceSummary, gsc } } });
    expect(host.querySelector("[data-gsc-query-count]")?.textContent).toBe("Unknown");
    expect(host.querySelector("[data-gsc-truncated]")?.textContent).toBe("Unknown");
  });
  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///private/file", "/pricing", "http://127.0.0.1/private"])("never links an unsafe supplied source URL: %s", async sourceUrl => {
    const props = fixture();
    await render({ ...props, payload: { ...props.payload, facts: [{ ...props.payload.facts[0]!, sourceUrl }] }, context: { ...props.context, facts: [{ ...props.context.facts[0]!, sourceUrl }] } });
    expect(host.textContent).toContain(sourceUrl);
    expect([...host.querySelectorAll("a")].some(link => link.getAttribute("href") === sourceUrl)).toBe(false);
  });
  it("preserves full public source URL identity without joining to the latest Profile", async () => {
    await render();
    expect(host.querySelector('a[href="https://example.com/pricing?plan=team#limits"]')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("renders Chinese neutral labels and the same exact underlying content", async () => {
    await render({ ...fixture(), locale: "zh" });
    expect(host.textContent).toContain("事实声明与实际采用的证据"); expect(host.textContent).toContain("未作为正向证据采用");
    expect(host.querySelector('[data-version-question="global-question"] [data-question-role]')?.textContent).toBe("全部角色");
    expect(host.textContent).toContain("Unlimited free plan"); expect(errorSpy).not.toHaveBeenCalled();
  });
  it("keeps two displayed versions independent and gives their controls unique identities", async () => {
    const saved = fixture(), current = fixture();
    const payload = { ...current.payload, roles: [{ ...current.payload.roles[0]!, label: "Current draft-only role" }] };
    await act(async () => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={en}><GeoKbVersionContent {...saved} /><GeoKbVersionContent {...current} payload={payload} /></NextIntlClientProvider>));
    const views = host.querySelectorAll("[data-geo-version-content]");
    expect(views[0]?.textContent).toContain("Finance teams"); expect(views[0]?.textContent).not.toContain("Current draft-only role");
    expect(views[1]?.textContent).toContain("Current draft-only role");
    const ids = [...host.querySelectorAll("[id]")].map(node => node.id); expect(new Set(ids).size).toBe(ids.length);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(errorSpy).not.toHaveBeenCalled();
  });
  it("counts only distinct GSC query texts actually referenced by this role and discloses raw lineage separately", async () => {
    const props = fixture(), original = props.payload.roles[0]!;
    const role = { ...original, source: { ...original.source, evidenceRefs: ["gsc-first", "gsc-repeat", "gsc-second", "profile-one"] } };
    await render({ ...props, payload: { ...props.payload, roles: [role] }, context: { ...props.context, evidenceCatalog: [
      ...props.context.evidenceCatalog, { id: "gsc-first", kind: "gsc", text: "invoice reminder software" }, { id: "gsc-repeat", kind: "gsc", text: "invoice reminder software" },
      { id: "gsc-second", kind: "gsc", text: "audit trail for invoices" }, { id: "gsc-unused", kind: "gsc", text: "unrelated tax reporting" }, { id: "profile-one", kind: "profile", text: "Profile finance role" },
    ] } });
    const article = host.querySelector('[data-version-role="r1"]')!;
    expect(article.querySelector('[data-role-referenced-query-count]')?.textContent).toBe("2");
    expect(article.querySelector('[data-role-source-badge]')?.textContent).toContain("GSC");
    expect(article.querySelector('[data-role-source-badge]')?.textContent).toContain("Profile");
    expect(article.textContent).toContain("not a count of people");
    const details = article.querySelector('details[data-role-lineage]'); expect(details?.querySelector("summary")).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    for (const value of ["generation-record-1", "original-role-1", "gsc-first", "gsc-repeat"]) expect(details?.textContent).toContain(value);
    expect(article.querySelector('[data-role-source-badge]')?.closest("details")).toBeNull(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("does not label a Profile/manual/crawl model inference as observed GSC or display a fabricated zero", async () => {
    const props = fixture(), role = { ...props.payload.roles[0]!, source: { ...props.payload.roles[0]!.source, evidenceRefs: ["profile-one", "manual:r1", "crawl-one"] } };
    await render({ ...props, payload: { ...props.payload, roles: [role] }, context: { ...props.context, evidenceCatalog: [...props.context.evidenceCatalog, { id: "profile-one", kind: "profile", text: "Profile role basis" }, { id: "crawl-one", kind: "crawl", text: "Public page wording" }] } });
    const article = host.querySelector('[data-version-role="r1"]')!;
    expect(article.querySelector('[data-role-referenced-query-count]')).toBeNull();
    const badge = article.querySelector('[data-role-source-badge]')?.textContent ?? "";
    expect(badge).toContain("Model inference"); expect(badge).toContain("Profile"); expect(badge).toContain("Manual"); expect(badge).toContain("Public-page");
    expect(article.textContent).toContain("No GSC query references"); expect(badge).not.toMatch(/observed|calibrated|0/u);
  });
  it("keeps absent or unresolved role evidence explicit instead of borrowing the global GSC count", async () => {
    const props = fixture(), role = { ...props.payload.roles[0]!, source: { ...props.payload.roles[0]!.source, evidenceRefs: ["missing-reference"] } };
    await render({ ...props, payload: { ...props.payload, roles: [role] } });
    const article = host.querySelector('[data-version-role="r1"]')!;
    expect(article.querySelector('[data-role-source-badge]')?.textContent).toContain("Source evidence unavailable");
    expect(article.querySelector('[data-role-source-missing]')?.textContent).toContain("unavailable");
    expect(article.querySelector('[data-role-referenced-query-count]')).toBeNull(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps failed/conflicting captures self-contained in both pending and frozen presentation", async () => {
    const props = captureFixture();
    await act(async () => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={en}><section data-phase="pending"><GeoKbVersionContent {...props} /></section><section data-phase="frozen"><GeoKbVersionContent {...props} /></section></NextIntlClientProvider>));
    for (const phase of ["pending", "frozen"]) {
      const version = host.querySelector(`[data-phase="${phase}"]`)!;
      const failed = version.querySelector('[data-version-competitor="rival.example"]')!, conflict = version.querySelector('[data-version-competitor="conflict.example"]')!;
      expect(failed?.querySelector('[data-current-competitor-mapping]')?.textContent).toContain("Manual Rival");
      expect(failed?.querySelector('[data-competitor-capture-status]')?.textContent).toContain("Capture unavailable");
      expect(failed?.querySelector('[data-competitor-capture]')?.textContent).toContain("Fetch failed");
      expect(failed?.querySelector('[data-competitor-capture]')?.textContent).toContain("not proof that the current mapping came from it");
      expect(failed?.querySelector('[data-competitor-capture]')?.textContent).not.toContain("Manual Rival");
      expect(failed?.querySelector('a[href="https://rival.example/?capture=1"]')).not.toBeNull();
      expect(conflict?.querySelector('[data-competitor-capture-status]')?.textContent).toContain("Identity conflict");
      expect(conflict?.querySelector('[data-competitor-capture-status]')?.closest("details")).toBeNull();
      expect(conflict?.querySelector('[data-competitor-signals]')?.textContent).toContain("Captured Alpha");
      expect(conflict?.querySelector('[data-competitor-signals]')?.textContent).toContain("Captured Beta");
      expect(conflict?.textContent).toContain("conflicting_signals"); expect(conflict?.textContent).toContain(TIME);
      expect(conflict?.querySelector('[data-sov-eligibility]')?.textContent).toContain("Excluded from SOV");
      expect(failed?.querySelector('[data-sov-eligibility]')?.textContent).toContain("brand deduplication");
    }
    expect(fetchSpy).not.toHaveBeenCalled(); expect(errorSpy).not.toHaveBeenCalled();
  });
  it("an empty capture history means not recorded, never a fetch failure or zero", async () => {
    await render(); const rival = host.querySelector('[data-version-competitor="rival.example"]')!;
    expect(rival?.querySelector('[data-competitor-no-capture]')?.textContent).toBe("No extraction capture recorded in this version.");
    expect(rival?.querySelector('[data-competitor-capture-status]')).toBeNull();
    expect(rival?.textContent).not.toMatch(/Fetch failed|0 captures/u); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("localizes capture failures without changing the frozen manual mapping or requesting current sources", async () => {
    await render({ ...captureFixture(), locale: "zh" });
    expect(host.querySelector('[data-version-competitor="rival.example"]')?.textContent).toContain("Manual Rival");
    expect(host.querySelector('[data-competitor-capture-status]')?.textContent).toContain("采集不可用");
    expect(host.textContent).toContain("抓取失败"); expect(host.textContent).toContain("不证明当前映射源于这次采集"); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps successful extracted identity distinct from a different manual mapping and labels exact hashes", async () => {
    const first = captureFixture().context.competitorEvidence[0]!;
    const evidence: GeoCompetitorEvidenceV2 = { ...first, capture: { evidenceId: "C1", domain: "rival.example", confirmed: false, source: "crawl", sourceUrl: "https://rival.example/?capture=1", observedAt: TIME, bodyHash: "e".repeat(64), status: "available", reason: null, brandName: "Captured Rival LLC", aliases: ["Captured Rival"], method: "json_ld", signalsTruncated: false, signals: [{ kind: "json_ld_organization", name: "Captured Rival LLC", aliases: ["Captured Rival"], url: "https://rival.example/", hostMatched: true, excludedReason: null }] } };
    await render(captureFixture([evidence])); const rival = host.querySelector('[data-version-competitor="rival.example"]')!;
    expect(rival.querySelector('[data-current-competitor-mapping]')?.textContent).toContain("Manual Rival");
    const capture = rival.querySelector('[data-competitor-capture]')!;
    expect(capture.textContent).toContain("Capture succeeded"); expect(capture.textContent).toContain("Captured Rival LLC"); expect(capture.textContent).not.toContain("Manual Rival");
    const receipt = capture.querySelector('[data-competitor-receipt]')!;
    expect(receipt.textContent).toContain("Receipt content hash"); expect(receipt.textContent).toContain(first.contentHash);
    expect(receipt.textContent).toContain("Captured body hash"); expect(receipt.textContent).toContain("e".repeat(64)); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("never turns malformed carried capture or signal URLs into executable links", async () => {
    const props = captureFixture(), capture = props.context.competitorEvidence[1]!;
    await render({ ...props, context: { ...props.context, competitorEvidence: [{ ...capture, capture: { ...capture.capture, sourceUrl: "javascript:alert(1)", signals: capture.capture.signals.map(signal => ({ ...signal, url: "http://127.0.0.1/private" })) } }] } });
    const shown = host.querySelector('[data-version-competitor="conflict.example"]')!;
    expect(shown.textContent).toContain("javascript:alert(1)"); expect(shown.textContent).toContain("http://127.0.0.1/private");
    expect(shown.querySelector('a[href="javascript:alert(1)"]')).toBeNull(); expect(shown.querySelector('a[href="http://127.0.0.1/private"]')).toBeNull(); expect(fetchSpy).not.toHaveBeenCalled();
  });
});
