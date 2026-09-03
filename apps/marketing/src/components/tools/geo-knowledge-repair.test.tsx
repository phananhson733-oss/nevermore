// @vitest-environment jsdom
// @input -- owned knowledge views and the knowledge editor's real controls
// @output -- repair loads, explicit save/freeze, accessible fields, and bounded return selection
// @pos -- the Brief-to-knowledge repair interaction regression suite

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../i18n/messages/en.json";
import { emptyMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";
import { emptyGeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { consumeGeoBriefReturn, GEO_BRIEF_RETURN_KEY, GEO_KNOWLEDGE_REPAIR_KEY, writeGeoKnowledgeRepair } from "../../lib/geo-tools/brief-knowledge-handoff.ts";
import { GeoKnowledgeBase } from "./geo-knowledge-base.tsx";
import type { GeoKbView } from "./geo-kb-wire.ts";
import { renderedText } from "./rendered-text.test-helper.ts";

const KB_ID = "36d8b87a-cbd5-45c0-b921-ffb283d9f4b1";
const OLD_SNAPSHOT = "282d7c7c-e641-43ea-8cfb-c34f57c973cb";
const NEW_SNAPSHOT = "fa4b2fab-5ba7-4fcb-b76f-b52d0293dd38";
const ORIGIN = "https://acme-kb.test";

function knowledge(): GeoKbView {
  return {
    kbId: KB_ID,
    origin: ORIGIN,
    host: "acme-kb.test",
    draftVersion: 2,
    importAvailable: false,
    payload: {
      ...emptyGeoKbPayload(`${ORIGIN}/`),
      officialName: "Acme Analytics",
      aliases: ["Acme"],
      categoryTerms: ["project management"],
      roles: [{ id: "role-1", label: "agency owners", segment: "small agencies", painPoints: ["deadlines"], decisionCriteria: ["price"], vocabulary: ["client work"] }],
      competitors: [{ domain: "linear.app", brandName: "Linear", confirmed: true }],
      facts: [{ key: "pricing", value: "$10 per month", reason: "", sourceUrl: `${ORIGIN}/pricing`, observedAt: "2026-08-31" }],
    },
    frozen: {
      snapshotId: OLD_SNAPSHOT, revision: 1, frozenAt: "2026-08-30T00:00:00Z",
      contentHash: "a".repeat(64), questionCount: 1, retrievalCount: 1,
      questions: [{ id: "question-old", text: "Which project management tool fits an agency?", layer: "discovery", mode: "retrieval", calibrated: true }],
    },
  };
}

function knowledgeWithProfile(): GeoKbView {
  const fullProfile = {
    ...emptyMarketingWebsiteProfile(),
    productName: "Original Profile name",
    oneLinePositioning: "Confirmed positioning",
    coreFeatures: ["Confirmed feature"],
    country: "US",
    locale: "en",
  };
  return { ...knowledge(), profile: {
    reference: { schemaVersion: "website-profile-reference.v1", websiteId: "890a3970-4cbb-4d4e-a3b3-c908c0d0f0b2", snapshotId: "e3694870-cc92-4f64-b9da-b52cbe9e3f01", snapshotRevision: 3, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "c".repeat(64) },
    productName: fullProfile.productName, oneLinePositioning: fullProfile.oneLinePositioning, coreFeatures: fullProfile.coreFeatures,
    market: { country: fullProfile.country, language: fullProfile.locale }, fullProfile,
  } };
}

let root: Root | null = null;
let container: HTMLElement;
let intlErrors: string[];
let navigationPreventedBeforeHarness: boolean | undefined;
const originalFetch = globalThis.fetch;

function copy(path: string): string {
  let value: unknown = enMessages.tools.geoKnowledgeBase;
  for (const part of path.split(".")) value = (value as Record<string, unknown>)[part];
  if (typeof value !== "string") throw new Error(`missing message: ${path}`);
  return value;
}

function field(label: string): HTMLInputElement {
  const element = [...container.querySelectorAll("label")].find((entry) => entry.textContent === label);
  const control = element?.control;
  expect(control, `accessible input for ${label}`).toBeInstanceOf(HTMLInputElement);
  return control as HTMLInputElement;
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!found) throw new Error(`missing button: ${label}`);
  return found;
}

function returnLink(): HTMLAnchorElement {
  const found = container.querySelector("[data-geo-brief-return]");
  expect(found).toBeInstanceOf(HTMLAnchorElement);
  return found as HTMLAnchorElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function chooseQuestion(value: string): Promise<void> {
  const select = container.querySelector("#kb-repair-question");
  expect(select).toBeInstanceOf(HTMLSelectElement);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function stageRepair(options: { questionId?: string | null; manualQuestion?: string | null; now?: number } = {}): void {
  const { now, ...selection } = options;
  expect(writeGeoKnowledgeRepair(window.sessionStorage, { kbId: KB_ID, snapshotId: OLD_SNAPSHOT, questionId: "question-old", reason: "question", ...selection }, now)).toBe(true);
  window.history.replaceState({}, "", "/tools/geo-knowledge-base?repair=brief");
}

function frozen(questions = knowledge().frozen!.questions!) {
  return { snapshotId: NEW_SNAPSHOT, revision: 2, frozenAt: "2026-08-31T00:00:00Z", contentHash: "b".repeat(64),
    questionCount: questions.length, retrievalCount: questions.length, questions, reusedExisting: false };
}

async function freeze(questions = knowledge().frozen!.questions!): Promise<void> {
  globalThis.fetch = vi.fn(async () => Response.json({ data: frozen(questions) }));
  await click(button(copy("freeze.action")));
}

async function mount(props: Partial<Parameters<typeof GeoKnowledgeBase>[0]> = {}, strict = false): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    const editor = <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC" onError={(error) => intlErrors.push(error.message)}>
      <GeoKnowledgeBase locale="en" signedIn {...props} />
    </NextIntlClientProvider>;
    root?.render(strict ? <StrictMode>{editor}</StrictMode> : editor);
  });
  // Observe the real link handler without asking jsdom to navigate a document.
  container.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) {
      navigationPreventedBeforeHarness = event.defaultPrevented;
      event.preventDefault();
    }
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/tools/geo-knowledge-base");
  intlErrors = [];
  navigationPreventedBeforeHarness = undefined;
  globalThis.fetch = vi.fn(async () => Response.json({ data: knowledge() }));
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("knowledge repair", () => {
  it("edits the primary category directly while preserving all background terms in order", async () => {
    stageRepair();
    const categories = ["项目管理", "team collaboration", "agency workflows"];
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...knowledge(), payload: { ...knowledge().payload, categoryTerms: categories } } }));
    await mount();
    const primary = field("Primary category used in questions");
    expect(primary.value).toBe("项目管理");
    expect(container.querySelector("#kb-repair-category")?.contains(primary)).toBe(true);
    expect(primary.compareDocumentPosition(field(copy("brand.categoryLabel"))) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await type(primary, "project management");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { draftVersion: 3, updatedAt: "2026-09-01T00:00:00Z", blockers: [] } }));
    await click(button(copy("draft.save")));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).payload.categoryTerms).toEqual(["project management", "team collaboration", "agency workflows"]);
    expect(button(copy("freeze.action")).disabled).toBe(false);
    expect(intlErrors).toEqual([]);
  });

  it("keeps a temporarily empty primary category without saving a background term as the primary", async () => {
    stageRepair();
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...knowledge(), payload: { ...knowledge().payload, categoryTerms: ["project management", "team collaboration"] } } }));
    await mount();
    await type(field("Primary category used in questions"), "");
    expect(field("Primary category used in questions").value).toBe("");
    expect(container.textContent).toContain(copy("freeze.blockers.category_terms_missing"));
    expect(button(copy("freeze.action")).disabled).toBe(true);
    await click(button(copy("draft.save")));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role='alert']")?.textContent).toContain(copy("freeze.blockers.category_terms_missing"));
    expect(container.textContent).toContain("team collaboration");
    await type(field("Primary category used in questions"), "project automation");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { draftVersion: 3, updatedAt: "2026-09-01T00:00:00Z", blockers: [] } }));
    await click(button(copy("draft.save")));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).payload.categoryTerms).toEqual(["project automation", "team collaboration"]);
  });

  it.each(["", "  "])("blocks save and freeze for an initially blank primary category %j even with English background terms", async (primary) => {
    stageRepair();
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...knowledge(), payload: { ...knowledge().payload, categoryTerms: [primary, "team collaboration"] } } }));
    await mount();
    expect(button(copy("freeze.action")).disabled).toBe(true);
    expect(container.textContent).toContain(copy("freeze.blockers.category_terms_missing"));
    await click(button(copy("draft.save")));
    await click(button(copy("freeze.action")));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role='alert']")?.textContent).toContain(copy("freeze.blockers.category_terms_missing"));
  });

  it("associates category, brand and fact labels with their editable controls", async () => {
    await mount({ initialView: knowledge() });
    expect([...container.querySelectorAll("label")].some((label) => label.textContent === "Primary category used in questions")).toBe(false);
    expect(field(copy("brand.categoryLabel")).id).not.toBe("");
    expect(field(copy("brand.officialNameLabel")).value).toBe("Acme Analytics");
    expect(field(copy("facts.keyLabel")).value).toBe("pricing");
    expect(field(copy("facts.valueLabel")).value).toBe("$10 per month");
    expect(field(copy("facts.sourceLabel")).value).toBe(`${ORIGIN}/pricing`);
    expect(new Set([...container.querySelectorAll("input")].map((input) => input.id)).size).toBe(container.querySelectorAll("input").length);
    expect(fetch).not.toHaveBeenCalled();
    expect(intlErrors).toEqual([]);
  });

  it("opens the exact existing knowledge once in StrictMode without creating, saving, freezing or enriching", async () => {
    stageRepair();
    await mount({}, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ kbId: KB_ID });
    expect(container.querySelector("#kb-site-url")).toBeNull();
    expect(container.textContent).toContain("acme-kb.test");
    expect(container.textContent).toContain("Which project management tool fits an agency?");
    for (const anchor of ["#kb-repair-category", "#kb-repair-facts", "#kb-repair-freeze"]) {
      expect(container.querySelector(`a[href='${anchor}']`)).not.toBeNull();
      expect(container.querySelector(anchor)).not.toBeNull();
    }
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    expect(window.sessionStorage.getItem(GEO_KNOWLEDGE_REPAIR_KEY)).toBeNull();
    expect(intlErrors).toEqual([]);
  });

  it("retains the same repair target after a network error and retries without showing a create form", async () => {
    stageRepair();
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ data: knowledge() }));
    await mount();
    expect(container.querySelector("#kb-site-url")).toBeNull();
    expect(container.textContent).toContain(copy("repair.loadError"));
    await click(button(copy("repair.retry")));
    expect(vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([{ kbId: KB_ID }, { kbId: KB_ID }]);
    expect(field(copy("brand.officialNameLabel")).value).toBe("Acme Analytics");
  });

  it("rejects a response for another knowledge base and preserves the original retry", async () => {
    stageRepair();
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...knowledge(), kbId: "wrong-kb", payload: { ...knowledge().payload, officialName: "Another site" } } }));
    await mount();
    expect(container.textContent).not.toContain("Another site");
    expect(container.textContent).toContain(copy("errors.schema_mismatch"));
    expect(container.querySelector("#kb-site-url")).toBeNull();
    globalThis.fetch = vi.fn(async () => Response.json({ data: knowledge() }));
    await click(button(copy("repair.retry")));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ kbId: KB_ID });
  });

  it.each(["missing", "expired", "malformed", "unreadable"])("shows recovery for %s repair context without loading or opening a blank editor", async (kind) => {
    if (kind === "expired") stageRepair({ now: Date.now() - 60 * 60_000 - 1 });
    if (kind === "malformed") window.sessionStorage.setItem(GEO_KNOWLEDGE_REPAIR_KEY, "{}");
    if (kind === "unreadable") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    window.history.replaceState({}, "", "/tools/geo-knowledge-base?repair=brief");
    await mount();
    expect(container.textContent).toContain(copy("repair.invalid"));
    expect(container.querySelector("#kb-site-url")).toBeNull();
    expect(container.querySelector("a[href='/tools/geo-brief']")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the ordinary site form when there is no repair context", async () => {
    await mount();
    expect(container.querySelector("#kb-site-url")).toBeInstanceOf(HTMLInputElement);
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector("[data-geo-brief-return]")).toBeNull();
  });

  it("does not consume repair context in a canonical website editor", async () => {
    stageRepair();
    const staged = window.sessionStorage.getItem(GEO_KNOWLEDGE_REPAIR_KEY);
    await mount({ initialView: knowledge(), canonicalWebsiteId: "website-1" });
    expect(window.sessionStorage.getItem(GEO_KNOWLEDGE_REPAIR_KEY)).toBe(staged);
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector("[data-geo-brief-return]")).toBeNull();
  });

  it("returns only after an explicit freeze, staging the exact new snapshot and retained question without run evidence", async () => {
    stageRepair();
    await mount();
    await click(returnLink());
    expect(navigationPreventedBeforeHarness).toBe(true);
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).toBeNull();
    await freeze();
    expect(returnLink().getAttribute("aria-disabled")).toBe("false");
    expect(returnLink().getAttribute("href")).toBe("/tools/geo-brief?resume=knowledge");
    await click(returnLink());
    expect(navigationPreventedBeforeHarness).toBe(false);
    expect(consumeGeoBriefReturn(window.sessionStorage)).toEqual({ kbId: KB_ID, snapshotId: NEW_SNAPSHOT, questionId: "question-old", manualQuestion: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit replacement question instead of silently switching to the first new question", async () => {
    stageRepair();
    await mount();
    await freeze([
      { id: "question-first", text: "Which tool is suitable for agencies?", layer: "discovery", mode: "retrieval", calibrated: true },
      { id: "question-chosen", text: "Which tool automates project planning?", layer: "problem", mode: "retrieval", calibrated: true },
    ]);
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    const select = container.querySelector<HTMLSelectElement>("#kb-repair-question");
    expect(select?.value).toBe("");
    expect(select?.options[0]?.textContent).toBe(copy("repair.chooseQuestionPlaceholder"));
    expect(container.querySelector("label[for='kb-repair-question']")?.textContent).toBe(copy("repair.chooseQuestion"));
    expect(container.textContent).toContain(copy("repair.questionRemoved"));
    await click(returnLink());
    expect(consumeGeoBriefReturn(window.sessionStorage)).toBeNull();
    await chooseQuestion("question-chosen");
    expect(returnLink().getAttribute("aria-disabled")).toBe("false");
    await click(returnLink());
    expect(consumeGeoBriefReturn(window.sessionStorage)?.questionId).toBe("question-chosen");
  });

  it("clears a replacement question after editing and after every new freeze", async () => {
    stageRepair();
    await mount();
    const changedQuestions = [{ id: "question-new", text: "Which tool is suitable for agencies?", layer: "discovery", mode: "retrieval" as const, calibrated: true }];
    await freeze(changedQuestions);
    await chooseQuestion("question-new");
    await freeze(changedQuestions);
    expect(container.querySelector<HTMLSelectElement>("#kb-repair-question")?.value).toBe("");
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    await chooseQuestion("question-new");
    await click(returnLink());
    await type(field(copy("brand.officialNameLabel")), "Acme Updated");
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).toBeNull();
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [] } }));
    await click(button(copy("draft.save")));
    await freeze(changedQuestions);
    expect(container.querySelector<HTMLSelectElement>("#kb-repair-question")?.value).toBe("");
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
  });

  it("opens Profile editing and website GEO settings separately during repair so the draft stays here", async () => {
    stageRepair();
    globalThis.fetch = vi.fn(async () => Response.json({ data: knowledgeWithProfile() }));
    await mount();
    await type(field(copy("brand.officialNameLabel")), "Unsaved repair draft");
    for (const label of [copy("asset.editProfile"), copy("asset.canonicalLink")]) {
      const link = [...container.querySelectorAll("a")].find((entry) => entry.textContent === label);
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toBe("noopener");
    }
    expect(field(copy("brand.officialNameLabel")).value).toBe("Unsaved repair draft");
    expect(container.querySelector("[data-geo-knowledge-repair]")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves same-tab Profile links in the ordinary knowledge editor", async () => {
    await mount({ initialView: knowledgeWithProfile() });
    for (const label of [copy("asset.editProfile"), copy("asset.canonicalLink")]) {
      const link = [...container.querySelectorAll("a")].find((entry) => entry.textContent === label);
      expect(link?.hasAttribute("target")).toBe(false);
      expect(link?.hasAttribute("rel")).toBe(false);
    }
  });

  it("preserves a manually entered question and the locale on return", async () => {
    stageRepair({ questionId: null, manualQuestion: "What are the best tools for my agency?" });
    await mount({ locale: "zh" });
    await freeze();
    expect(returnLink().getAttribute("href")).toBe("/zh/tools/geo-brief?resume=knowledge");
    await click(returnLink());
    expect(consumeGeoBriefReturn(window.sessionStorage)).toEqual({ kbId: KB_ID, snapshotId: NEW_SNAPSHOT, questionId: null, manualQuestion: "What are the best tools for my agency?" });
  });

  it("invalidates a staged return after edits and requires a new freeze even after save", async () => {
    stageRepair();
    await mount();
    await freeze();
    await click(returnLink());
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).not.toBeNull();
    await type(field(copy("brand.officialNameLabel")), "Acme Updated");
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).toBeNull();
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [] } }));
    await click(button(copy("draft.save")));
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    await click(returnLink());
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).toBeNull();
  });

  it("does not enable return for a failed freeze or an unchanged old snapshot", async () => {
    stageRepair();
    await mount();
    globalThis.fetch = vi.fn(async () => Response.json({ error: { code: "store_unavailable" } }, { status: 503 }));
    await click(button(copy("freeze.action")));
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...frozen(), snapshotId: OLD_SNAPSHOT, reusedExisting: true } }));
    await click(button(copy("freeze.action")));
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the editor open with an actionable error if return storage fails", async () => {
    stageRepair();
    await mount();
    await freeze();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { returnLink().dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(navigationPreventedBeforeHarness).toBe(true);
    expect(container.textContent).toContain(copy("repair.storageError"));
    expect(field(copy("brand.officialNameLabel")).value).toBe("Acme Analytics");
    expect(returnLink().getAttribute("aria-disabled")).toBe("false");
  });

  it("clears staged return during a save and prevents returning after an uncertain save failure", async () => {
    stageRepair();
    await mount();
    await freeze();
    await click(returnLink());
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).not.toBeNull();
    let rejectSave: (reason: Error) => void = () => { throw new Error("save did not start"); };
    globalThis.fetch = vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectSave = reject; }));
    await click(button(copy("draft.save")));
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).toBeNull();
    await act(async () => { rejectSave(new Error("reply lost")); });
    expect(returnLink().getAttribute("aria-disabled")).toBe("true");
    await click(returnLink());
    expect(window.sessionStorage.getItem(GEO_BRIEF_RETURN_KEY)).toBeNull();
  });

  it("keeps Profile facts read-only while a user corrects category, adds a sourced fact, saves with CAS and freezes", async () => {
    stageRepair();
    const profile = knowledgeWithProfile().profile!;
    const loaded = { ...knowledge(), profile,
      payload: { ...knowledge().payload, categoryTerms: ["项目管理"], facts: [] } };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: loaded }))
      .mockResolvedValueOnce(Response.json({ data: loaded }))
      .mockResolvedValueOnce(Response.json({ data: { draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [] } }));
    await mount();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(renderedText(container)).toContain("Confirmed feature");
    expect([...container.querySelectorAll("input")].some((input) => input.value === "Original Profile name")).toBe(false);
    expect(container.textContent).toContain("项目管理");
    expect(button(copy("freeze.action")).disabled).toBe(true);
    await type(field(copy("repair.primaryCategory")), "project management");
    await click(button(copy("facts.add")));
    await type(field(copy("facts.keyLabel")), "Automation");
    await type(field(copy("facts.valueLabel")), "Supports recurring project tasks");
    await type(field(copy("facts.sourceLabel")), `${ORIGIN}/features`);
    await type(field(copy("facts.observedLabel")), "2026-08-31");
    expect(button(copy("freeze.action")).disabled).toBe(true);
    await click(button(copy("asset.reviewCopy")));
    expect(fetch).toHaveBeenCalledTimes(2);
    await click(button(copy("asset.applyCopy")));
    // The adopted copy is read out, and there is no control to type it into:
    // it is edited in the Profile, not here.
    expect(renderedText(container.querySelector("[data-geo-profile-field='productName']"))).toContain("Original Profile name");
    expect([...container.querySelectorAll("input")].some(input => input.value === "Original Profile name")).toBe(false);
    await click(button(copy("draft.save")));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body));
    expect(request).toMatchObject({ kbId: KB_ID, baseVersion: 2, expectedProfileReference: profile.reference,
      payload: { officialName: "Acme Analytics", categoryTerms: ["project management"], profileCopy: { profile: profile.fullProfile }, facts: [{ key: "Automation", value: "Supports recurring project tasks", sourceUrl: `${ORIGIN}/features`, observedAt: "2026-08-31" }] } });
    expect(button(copy("freeze.action")).disabled).toBe(false);
    await freeze();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ kbId: KB_ID, baseVersion: 3 });
    await click(returnLink());
    expect(consumeGeoBriefReturn(window.sessionStorage)?.snapshotId).toBe(NEW_SNAPSHOT);
    expect(intlErrors).toEqual([]);
  });
});
