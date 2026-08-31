// @vitest-environment jsdom
// @input  -- the four knowledge-base endpoints answered by the real handlers, and the real EN catalog
// @output -- proof an unfinished row cannot take the rest of a save with it, that one 409 is not
//            permanent, that a server-side blocker is a sentence, and that a non-JSON reply is not "no network"
// @pos    -- the seam between apps/marketing's knowledge-base handlers and its only editor

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../i18n/messages/en.json";
import {
  emptyGeoKbPayload,
  type GeoKbPayload,
} from "../../lib/geo-tools/kb-contract.ts";
import {
  handleGeoKbFreeze,
  handleGeoKbImport,
  handleGeoKbLoad,
  handleGeoKbSaveDraft,
  type GeoKbHandlerDependencies,
} from "../../lib/geo-tools/kb-handler.ts";
import { GeoKnowledgeBase } from "./geo-knowledge-base.tsx";

const ORIGIN = "https://acme-kb.test";

/** A knowledge base with nothing blocking a freeze. */
function ready(overrides: Partial<GeoKbPayload> = {}): GeoKbPayload {
  return {
    ...emptyGeoKbPayload(`${ORIGIN}/`),
    officialName: "Acme Analytics",
    aliases: ["Acme"],
    categoryTerms: ["project management"],
    roles: [
      {
        id: "role-1",
        label: "agency owners",
        segment: "5 to 20 person agencies",
        painPoints: ["missed deadlines"],
        decisionCriteria: ["price"],
        vocabulary: ["client work"],
      },
    ],
    competitors: [{ domain: "linear.app", brandName: "Linear", confirmed: true }],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* The store the handlers run against                                  */
/* ------------------------------------------------------------------ */

interface Store {
  draftVersion: number;
  payload: GeoKbPayload;
  /** What `readDraftPayload` answers with, when it differs from the draft. */
  frozenSource?: GeoKbPayload;
}

let store: Store;
let saveCalls = 0;
/** Requests that left the browser, which a refused payload also does. */
let draftPosts = 0;

function dependencies(): GeoKbHandlerDependencies {
  return {
    authenticate: async () => ({ ok: true, userId: "user-1" }),
    loadKnowledgeBase: async () => ({
      kind: "ok",
      value: {
        kbId: "kb-1",
        origin: ORIGIN,
        host: "acme-kb.test",
        draftVersion: store.draftVersion,
        payload: store.payload,
        frozen: null,
        importAvailable: false,
      },
    }),
    saveDraft: async ({ payload, baseVersion }) => {
      saveCalls += 1;
      if (baseVersion !== store.draftVersion) {
        return { kind: "conflict", draftVersion: store.draftVersion };
      }
      store.payload = payload;
      store.draftVersion += 1;
      return {
        kind: "ok",
        value: {
          draftVersion: store.draftVersion,
          updatedAt: "2026-08-29T10:00:00.000Z",
        },
      };
    },
    readDraftPayload: async () => ({
      kind: "ok",
      value: {
        payload: store.frozenSource ?? store.payload,
        draftVersion: store.draftVersion,
      },
    }),
    freeze: async () => ({
      kind: "ok",
      value: {
        snapshotId: "snap-1",
        revision: 1,
        frozenAt: "2026-08-29T10:00:00.000Z",
        contentHash: "a".repeat(64),
        questionCount: 15,
        retrievalCount: 13,
        reusedExisting: false,
      },
    }),
    importFromProfile: async () => ({ kind: "ok", value: ready() }),
  };
}

/**
 * The browser's fetch, rebuilt as the four routes receive it.
 *
 * Routed through the real handlers on purpose: the defects this suite is about
 * are all disagreements between what the server sends and what the page reads,
 * and a hand-written response body cannot disagree with anything.
 */
function installFetch(): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const request = new Request(`https://gengrowth.ai${url}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://gengrowth.ai",
          "sec-fetch-site": "same-origin",
        },
        body: typeof init?.body === "string" ? init.body : "{}",
      });
      if (url.endsWith("/load")) return handleGeoKbLoad(request, dependencies());
      if (url.endsWith("/draft")) {
        draftPosts += 1;
        return handleGeoKbSaveDraft(request, dependencies());
      }
      if (url.endsWith("/freeze")) {
        return handleGeoKbFreeze(request, dependencies());
      }
      return handleGeoKbImport(request, dependencies());
    },
  ) as unknown as typeof fetch;
}

/* ------------------------------------------------------------------ */
/* Rendering and interaction                                           */
/* ------------------------------------------------------------------ */

const originalFetch = globalThis.fetch;
let root: Root | null = null;
let container: HTMLElement | null = null;
let intlErrors: string[] = [];

function text(): string {
  return container?.textContent ?? "";
}

function copy(path: string): string {
  let node: unknown = enMessages.tools.geoKnowledgeBase;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") throw new Error(`no message at ${path}`);
  return node;
}

/** The longest literal run in a message, so a needle is never empty. */
function literal(path: string): string {
  const longest = copy(path)
    .split(/\{[^}]*\}/u)
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length)[0];
  if (longest === undefined || longest.length < 8) {
    throw new Error(`no usable literal in ${path}`);
  }
  return longest;
}

function button(label: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === label,
  );
  if (found === undefined) throw new Error(`no button labelled ${label}`);
  return found;
}

/** The input under a given field label, by position among same-labelled fields. */
function field(label: string, occurrence = 0): HTMLInputElement {
  const matches = [...(container?.querySelectorAll("span") ?? [])]
    .filter((span) => span.textContent === label)
    .map((span) => span.parentElement?.querySelector("input"))
    .filter((element): element is HTMLInputElement => element !== null);
  const found = matches[occurrence];
  if (found === undefined) throw new Error(`no field labelled ${label}`);
  return found;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale="en"
        messages={{
          tools: { geoKnowledgeBase: enMessages.tools.geoKnowledgeBase },
        }}
        onError={(error) => {
          intlErrors.push(error.message);
        }}
        timeZone="UTC"
      >
        <GeoKnowledgeBase locale="en" signedIn />
      </NextIntlClientProvider>,
    );
  });
}

/** Mount and load the knowledge base, which is where every test starts. */
async function open(): Promise<void> {
  await mount();
  const site = container?.querySelector("#kb-site-url");
  if (!(site instanceof HTMLInputElement)) throw new Error("no site field");
  await type(site, `${ORIGIN}/`);
  await click(button(copy("site.start")));
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  intlErrors = [];
  saveCalls = 0;
  draftPosts = 0;
  store = { draftVersion: 2, payload: ready() };
  installFetch();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("a row that was added but not filled in", () => {
  it("explains English category wording and limits required entities before freezing", async () => {
    await open();
    expect(text()).toContain("The first term supplies the English question subject.");
    expect(text()).toContain("secondary terms stay as context, not automatic required entities.");
    expect(intlErrors).toEqual([]);
  });

  // The reported failure, exactly: "Add a competitor" inserts an empty row,
  // the write contract refuses a row that identifies nobody, and the refusal
  // is of the whole payload - so the name typed in the same minute is gone
  // too, and the page prints the field identifier `competitors`.
  it("does not take the rest of the save down with it", async () => {
    await open();
    await click(button(copy("competitors.add")));
    await type(field(copy("brand.officialNameLabel")), "Acme Analytics Ltd");
    await click(button(copy("draft.save")));

    expect(store.payload.officialName).toBe("Acme Analytics Ltd");
    // The untouched row is not in the draft, and was not invented into one.
    expect(store.payload.competitors).toHaveLength(1);
    expect(text()).toContain(literal("draft.saved"));
    expect(text()).not.toContain(literal("errors.invalid_payload"));
    expect(intlErrors).toEqual([]);
  });

  // A row with something in it is a different case: it cannot be dropped, so
  // it has to be pointed at instead. Nothing is sent while it is unfinished.
  it("names the unfinished row rather than sending a payload that is refused", async () => {
    await open();
    await click(button(copy("facts.add")));
    await type(field(copy("facts.keyLabel")), "starting price");
    await type(field(copy("brand.officialNameLabel")), "Acme Analytics Ltd");
    await click(button(copy("draft.save")));

    expect(draftPosts).toBe(0);
    expect(saveCalls).toBe(0);
    expect(text()).toContain(copy("errors.form_invalid"));
    expect(text()).toContain(copy("facts.issues.reasonMissing"));
    // The other edit is still on screen, not thrown away with the save.
    expect(field(copy("brand.officialNameLabel")).value).toBe(
      "Acme Analytics Ltd",
    );
    expect(intlErrors).toEqual([]);
  });

  // The empty option was the default and said "-", so the state the contract
  // refuses was the one the form arrived in.
  it("saves once the empty value says why it is empty", async () => {
    await open();
    await click(button(copy("facts.add")));
    await type(field(copy("facts.keyLabel")), "starting price");
    await click(button(copy("draft.save")));
    const reason = container?.querySelector("#kb-fact-reason-0");
    if (!(reason instanceof HTMLSelectElement)) throw new Error("no reason");
    expect(reason.options[0]?.textContent).toBe(copy("facts.reasonPlaceholder"));
    await choose(reason, "notPublished");
    await click(button(copy("draft.save")));

    // One request, not two: the first press never left the browser. Counted at
    // the wire, because a payload the contract refuses never reaches the store.
    expect(draftPosts).toBe(1);
    expect(store.payload.facts).toEqual([
      {
        key: "starting price",
        value: "",
        reason: "notPublished",
        sourceUrl: "",
        observedAt: "",
      },
    ]);
    expect(text()).toContain(literal("draft.saved"));
    expect(intlErrors).toEqual([]);
  });
});

describe("a save that lost a race", () => {
  it.each([
    ["later edit", ["Later Unsaved Brand"]],
    ["successive edits", ["Later Unsaved Brand", "Newest Unsaved Brand"]],
    ["edit back to submitted text", ["Later Unsaved Brand", "Sent Brand"]],
  ] as const)("keeps %s during save unsaved until the next successful save", async (_name, edits) => {
    await open();
    const serverFetch = globalThis.fetch;
    let releaseSave!: () => void;
    const pendingResponse = new Promise<void>((resolve) => { releaseSave = resolve; });
    let delayNextSave = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      let response = await serverFetch(input, init);
      if (String(input).endsWith("/draft")) {
        const body = await response.json();
        response = Response.json({ data: { ...body.data, context: {
          skippedLayers: [], questionSetHash: "f".repeat(64), contentHash: (draftPosts === 1 ? "c" : "d").repeat(64),
        } } });
        if (delayNextSave) {
          delayNextSave = false;
          await pendingResponse;
        }
      }
      return response;
    });
    globalThis.fetch = fetcher;

    await type(field(copy("brand.officialNameLabel")), "Sent Brand");
    await click(button(copy("draft.save")));
    for (const value of edits) await type(field(copy("brand.officialNameLabel")), value);
    expect(store.payload.officialName).toBe("Sent Brand");
    expect(text()).toContain(copy("draft.unsaved"));
    await act(async () => { releaseSave(); });

    const latest = edits.at(-1)!;
    expect(field(copy("brand.officialNameLabel")).value).toBe(latest);
    expect(text()).toContain(copy("draft.unsaved"));
    expect(text()).not.toContain(literal("draft.saved"));
    expect(button(copy("freeze.action")).disabled).toBe(true);
    await click(button(copy("freeze.action")));
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/freeze"))).toBe(false);

    await click(button(copy("draft.save")));
    expect(store.payload.officialName).toBe(latest);
    expect(store.draftVersion).toBe(4);
    expect(text()).not.toContain(copy("draft.unsaved"));
    expect(text()).toContain(literal("draft.saved"));
    expect(button(copy("freeze.action")).disabled).toBe(false);
    await click(button(copy("freeze.action")));
    const freezeCall = fetcher.mock.calls.find(([url]) => String(url).endsWith("/freeze"));
    expect(JSON.parse(String(freezeCall?.[1]?.body))).toMatchObject({ kbId: "kb-1", baseVersion: 4, contextHash: "d".repeat(64) });
    expect(draftPosts).toBe(2);
    expect(intlErrors).toEqual([]);
  });

  it("does not label subsequent edits with the last successful save time", async () => {
    await open();
    await click(button(copy("draft.save")));
    expect(text()).toContain(literal("draft.saved"));
    await type(field(copy("brand.officialNameLabel")), "An unsaved update");
    expect(text()).toContain(copy("draft.unsaved"));
    expect(text()).not.toContain(literal("draft.saved"));
    expect(button(copy("freeze.action")).disabled).toBe(true);
  });

  // A 409 carries the version that is now current. The page never read it, so
  // it kept sending the version it loaded with: the first conflict was
  // permanent, and the only control that refreshed the number - "switch site" -
  // throws away everything unsaved.
  it("retries successfully without the edits being reloaded away", async () => {
    await open();
    // Someone else saves while this tab is open.
    store.draftVersion = 5;

    await type(field(copy("brand.officialNameLabel")), "Acme Analytics Ltd");
    await click(button(copy("draft.save")));

    expect(text()).toContain(literal("errors.conflict"));
    expect(store.payload.officialName).toBe("Acme Analytics");
    expect(field(copy("brand.officialNameLabel")).value).toBe(
      "Acme Analytics Ltd",
    );

    await click(button(copy("draft.save")));

    expect(store.payload.officialName).toBe("Acme Analytics Ltd");
    expect(store.draftVersion).toBe(6);
    expect(text()).toContain(literal("draft.saved"));
    expect(text()).not.toContain(literal("errors.conflict"));
    expect(intlErrors).toEqual([]);
  });
});

describe("a freeze the server refuses", () => {
  // `not_ready` had no message in either catalog. It was unreachable only
  // because this page kept its own copy of the blocker list and the two
  // happened to agree; the moment a sixth blocker existed server-side, the
  // button stayed live and the page printed the key path.
  it("states what is missing instead of printing a message key", async () => {
    await open();
    // The stored draft is not the one on screen: its competitor is unconfirmed.
    store.frozenSource = ready({
      competitors: [{ domain: "linear.app", brandName: "Linear", confirmed: false }],
    });
    await click(button(copy("freeze.action")));

    expect(text()).toContain(copy("errors.not_ready"));
    expect(text()).toContain(copy("freeze.blockers.no_confirmed_competitor"));
    expect(text()).not.toContain("errors.not_ready");
    expect(intlErrors).toEqual([]);
  });

  // The other half of the same defect: the gate is now the server's own
  // function, so a blocker this page never knew about disables the button
  // rather than being discovered by spending a request on it.
  it("disables the freeze for a blocker only the contract knows about", async () => {
    // Every spelling too short for the mention matcher to look for, which is
    // the set the contract tests: one usable name anywhere in it is enough.
    store = {
      draftVersion: 2,
      payload: ready({ officialName: "Ac", aliases: ["Ax"] }),
    };
    await open();

    expect(button(copy("freeze.action")).disabled).toBe(true);
    expect(text()).toContain(literal("freeze.blockers.alias_too_short"));
    expect(intlErrors).toEqual([]);
  });
});

describe("a reply that is not what this page reads", () => {
  // A gateway timeout answers in HTML. Read as a network failure it becomes
  // "the request did not reach the tool", which sends the visitor to check a
  // working connection and hides that a 502 can arrive after the write.
  it("does not report a non-JSON reply as a connection problem", async () => {
    await open();
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;
    await type(field(copy("brand.officialNameLabel")), "Acme Analytics Ltd");
    await click(button(copy("draft.save")));

    expect(text()).toContain(literal("errors.bad_response"));
    expect(text()).not.toContain(copy("errors.network"));
    expect(intlErrors).toEqual([]);
  });

  it("refuses a knowledge base whose payload is missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        data: {
          kbId: "kb-1",
          origin: ORIGIN,
          host: "acme-kb.test",
          draftVersion: 2,
          frozen: null,
          importAvailable: false,
        },
      }),
    ) as unknown as typeof fetch;
    await open();

    expect(text()).toContain(copy("errors.schema_mismatch"));
    expect(text()).not.toContain(copy("brand.title"));
    expect(intlErrors).toEqual([]);
  });

  it("refuses a saved reply that carries an unknown blocker code", async () => {
    await open();
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        data: {
          draftVersion: 3,
          updatedAt: "2026-08-29T10:00:00.000Z",
          blockers: ["something_new"],
        },
      }),
    ) as unknown as typeof fetch;
    await type(field(copy("brand.officialNameLabel")), "Acme Analytics Ltd");
    await click(button(copy("draft.save")));

    expect(text()).toContain(copy("errors.schema_mismatch"));
    expect(text()).not.toContain(literal("draft.saved"));
    expect(intlErrors).toEqual([]);
  });
});

describe("which site the knowledge base was actually loaded for", () => {
  it.each(["en", "en-US", "en-GB"])("explicitly changes only the GEO language to %s while preserving its Profile and frozen view", async (language) => {
    store.payload = ready({ market: { country: "CA", language: "zh-cn" } });
    const originalPayload = store.payload;
    const reference = { schemaVersion: "website-profile-reference.v1", websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987", snapshotRevision: 2, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) };
    const profile = { reference, productName: "Original Profile product", oneLinePositioning: "Original positioning", coreFeatures: ["Original feature"], market: { country: "CA", language: "en" } };
    const frozen = { snapshotId: "old-snapshot", revision: 1, frozenAt: "2026-08-30T00:00:00Z", contentHash: "b".repeat(64), questionCount: 1, retrievalCount: 1,
      questions: [{ id: "old-question", text: "Original frozen question", layer: "discovery", mode: "retrieval", calibrated: true }] };
    const serverFetch = globalThis.fetch;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await serverFetch(input, init);
      if (!String(input).endsWith("/load")) return response;
      const body = await response.json();
      return Response.json({ data: { ...body.data, profile, frozen } });
    });
    globalThis.fetch = fetcher;
    await open();
    const select = container?.querySelector("#kb-language");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    if (!(select instanceof HTMLSelectElement)) throw new Error("no GEO language selector");
    expect(select.value).toBe("zh-cn");
    expect(select.selectedOptions[0]?.textContent).toBe("zh-cn");
    expect([...select.options].map((option) => option.value)).toEqual(["zh-cn", "en", "en-US", "en-GB"]);
    expect(container?.querySelector('label[for="kb-language"]')?.textContent).toBe(copy("brand.languageLabel"));
    expect(button(copy("freeze.action")).disabled).toBe(true);
    await click(button(copy("freeze.preview")));
    await choose(select, language);
    expect(select.value).toBe(language);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.payload).toEqual(originalPayload);
    expect(text()).toContain(copy("draft.unsaved"));
    expect(button(copy("freeze.action")).disabled).toBe(true);
    expect(text()).toContain("Original frozen question");
    expect(text()).toContain("Original Profile product");
    expect(text()).toContain("b".repeat(64));

    await click(button(copy("draft.save")));
    const saved = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(saved.payload).toEqual({ ...originalPayload, market: { ...originalPayload.market, language } });
    expect(saved.expectedProfileReference).toEqual(reference);
    expect(store.payload).toEqual({ ...originalPayload, market: { ...originalPayload.market, language: language.toLowerCase() } });
    expect(button(copy("freeze.action")).disabled).toBe(false);
    expect(text()).toContain("Original frozen question");
    expect(text()).toContain("b".repeat(64));
    expect(profile.market.language).toBe("en");
    expect(fetcher.mock.calls.every(([url]) => ["/load", "/draft"].some((suffix) => String(url).endsWith(suffix)))).toBe(true);
    expect(intlErrors).toEqual([]);
  });

  it("shows a loaded country outside the presets without writing a replacement", async () => {
    store.payload = ready({ market: { country: "CA", language: "en" } });
    await open();
    const country = container?.querySelector<HTMLSelectElement>("#kb-country");
    expect(country?.value).toBe("CA");
    expect(country?.selectedOptions[0]?.textContent).toBe("CA");
    expect(draftPosts).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("directs an unregistered site to Website settings without discarding its saved draft", async () => {
    await open();
    globalThis.fetch = vi.fn(async () => Response.json({ error: { code: "website_required" } }, { status: 422 }));
    await click(button(copy("freeze.action")));
    expect(text()).toContain(copy("errors.website_required"));
    expect(container?.querySelector('[role="alert"] a[href="/en/account/websites"]')).not.toBeNull();
    expect(field(copy("brand.officialNameLabel")).value).toBe("Acme Analytics");
    expect(intlErrors).toEqual([]);
  });
  it("pins the source context seen by the user in the freeze request", async () => {
    const loaded = await dependencies().loadKnowledgeBase({ userId: "user-1", url: ORIGIN });
    if (loaded.kind !== "ok") throw new Error("fixture missing");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: { ...loaded.value, context: { skippedLayers: [], questionSetHash: "c".repeat(64), contentHash: "e".repeat(64) } } }));
    globalThis.fetch = fetcher;
    await open();
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "context_stale" } }, { status: 409 }));
    await click(button(copy("freeze.action")));
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ contextHash: "e".repeat(64), kbId: "kb-1", baseVersion: 2 });
    expect(text()).toContain(copy("errors.context_stale"));
  });

  it("pins Profile identity on save and reloads changed sources without discarding the local draft", async () => {
    const loaded = await dependencies().loadKnowledgeBase({ userId: "user-1", url: ORIGIN });
    if (loaded.kind !== "ok") throw new Error("fixture missing");
    const reference = { schemaVersion: "website-profile-reference.v1", websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6", snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "a".repeat(64) };
    const profile = { reference, productName: "Original product", oneLinePositioning: "Original position", coreFeatures: [], market: { country: "US", language: "en" } };
    const context = { skippedLayers: [], questionSetHash: "c".repeat(64), contentHash: "e".repeat(64) };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: { ...loaded.value, profile, context } }));
    globalThis.fetch = fetcher;
    await open();
    await type(field(copy("brand.officialNameLabel")), "My unsaved name");
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "context_stale" } }, { status: 409 }));
    await click(button(copy("draft.save")));
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).expectedProfileReference).toEqual(reference);
    const nextReference = { ...reference, snapshotRevision: 2, profileHash: "b".repeat(64) };
    fetcher.mockResolvedValueOnce(Response.json({ data: { ...loaded.value, profile: { ...profile, reference: nextReference, productName: "Changed product" }, context: { ...context, contentHash: "f".repeat(64) } } }));
    await click(button(copy("asset.reloadSources")));
    expect(field(copy("brand.officialNameLabel")).value).toBe("My unsaved name");
    expect(text()).toContain("Changed product");
    expect(button(copy("freeze.action")).disabled).toBe(true);
    fetcher.mockResolvedValueOnce(Response.json({ data: { draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [], context: { ...context, contentHash: "f".repeat(64) } } }));
    await click(button(copy("draft.save")));
    const saved = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    expect(saved.expectedProfileReference).toEqual(nextReference);
    expect(saved.payload.officialName).toBe("My unsaved name");
  });
  it("allows a role-free freeze only when server source policy skips both role layers", async () => {
    store.payload = ready({ roles: [] });
    const loaded = await dependencies().loadKnowledgeBase({ userId: "user-1", url: ORIGIN });
    if (loaded.kind !== "ok") throw new Error("fixture missing");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...loaded.value, context: { skippedLayers: ["problem", "evaluation"], questionSetHash: "c".repeat(64), contentHash: "e".repeat(64) } } }));
    await open();
    expect(button(copy("freeze.action")).disabled).toBe(false);
    expect(text()).not.toContain(copy("freeze.blockers.role_missing"));
  });

  it("keeps the legacy role gate when no server source policy was supplied", async () => {
    store.payload = ready({ roles: [] });
    await open();
    expect(button(copy("freeze.action")).disabled).toBe(true);
    expect(text()).toContain(copy("freeze.blockers.role_missing"));
  });

  it("adopts the source-policy preview returned by saving without resetting editor text", async () => {
    store.payload = ready({ roles: [] });
    await open();
    globalThis.fetch = vi.fn(async () => Response.json({ data: { draftVersion: 3, updatedAt: "2026-08-31T00:00:00Z", blockers: [], context: { skippedLayers: ["problem", "evaluation"], questionSetHash: "c".repeat(64), contentHash: "e".repeat(64) } } }));
    await type(field(copy("brand.officialNameLabel")), "User edited name");
    await click(button(copy("draft.save")));
    expect(button(copy("freeze.action")).disabled).toBe(false);
    expect(field(copy("brand.officialNameLabel")).value).toBe("User edited name");
  });

  it("reloads frozen questions and prompt identity without regenerating from the current draft", async () => {
    const loaded = await dependencies().loadKnowledgeBase({ userId: "user-1", url: ORIGIN });
    if (loaded.kind !== "ok") throw new Error("fixture missing");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...loaded.value, frozen: {
      snapshotId: "frozen-original", revision: 3, frozenAt: "2026-08-30T00:00:00Z", contentHash: "b".repeat(64),
      questionCount: 1, retrievalCount: 1, questionSetHash: "d".repeat(64), registryVersion: "original-registry.v2",
      skippedLayers: ["problem", "evaluation"],
      questions: [{ id: "original-q", text: "Original frozen question unchanged", layer: "discovery", mode: "retrieval", calibrated: true, roleId: null, requiredEntities: ["Frozen entity"], templateId: "frozen-template" }],
    } } }));
    await open();
    await click(button(copy("freeze.preview")));
    expect(text()).toContain("Original frozen question unchanged");
    expect(text()).toContain("Frozen entity");
    expect(text()).toContain("original-registry.v2");
    expect(text()).toContain("d".repeat(64));
    expect(text()).toContain("b".repeat(64));
    await type(field(copy("brand.officialNameLabel")), "Mutable current name");
    expect(text()).toContain("Original frozen question unchanged");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("offers explicit source enrichment and preserves saved competitor aliases", async () => {
    store.payload = ready({ competitors: [{ domain: "linear.app", brandName: "Linear", confirmed: true, aliases: ["Linear App"] }] });
    await open();
    expect(button(copy("enrichment.action"))).toBeDefined();
    expect(text()).toContain("Linear App");
    await type(field(copy("brand.officialNameLabel")), "Edited brand");
    expect(button(copy("enrichment.action")).disabled).toBe(true);
    await click(button(copy("draft.save")));
    expect(store.payload.competitors[0]?.aliases).toEqual(["Linear App"]);
  });
  // The record is keyed on the host without `www.`, so a site typed one way
  // lands on the record made the other way. Deliberate, and invisible: both
  // fields were on the response and neither was ever rendered.
  it("names the origin the record is stored under", async () => {
    await open();

    expect(text()).toContain(ORIGIN);
    expect(text()).toContain(literal("site.loaded"));
    expect(intlErrors).toEqual([]);
  });

  it("links a shortcut load to the same canonical website and renders inherited facts read-only", async () => {
    const websiteId = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
    const view = await dependencies().loadKnowledgeBase({ userId: "user-1", url: ORIGIN });
    if (view.kind !== "ok") throw new Error("fixture missing");
    globalThis.fetch = vi.fn(async () => Response.json({ data: { ...view.value, profile: {
      reference: { schemaVersion: "website-profile-reference.v1", websiteId, snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987", snapshotRevision: 3, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "b".repeat(64) },
      productName: "Original Profile product", oneLinePositioning: "Read-only positioning", coreFeatures: ["Core feature from Profile"], market: { country: "US", language: "en" },
    } } }));
    await open();
    expect(container?.querySelector(`a[href='/en/account/websites/${websiteId}/geo']`)).not.toBeNull();
    expect(text()).toContain("Original Profile product");
    expect(text()).toContain("Read-only positioning");
    expect(text()).toContain("Core feature from Profile");
    expect([...(container?.querySelectorAll("input") ?? [])].some((input) => input.value === "Original Profile product")).toBe(false);
    expect(field(copy("brand.officialNameLabel")).value).toBe("Acme Analytics");
  });

  it("renders supplied role and required-entity metadata in the frozen question preview", async () => {
    await open();
    globalThis.fetch = vi.fn(async () => Response.json({ data: {
      snapshotId: "snapshot", revision: 1, frozenAt: "2026-08-31T00:00:00Z", contentHash: "a".repeat(64),
      questionCount: 1, retrievalCount: 1, reusedExisting: false,
      questions: [{ id: "question-one", text: "A real frozen question", layer: "problem", mode: "retrieval", calibrated: true, roleId: "role-1", requiredEntities: ["client work", "team planning"] }],
    } }));
    await click(button(copy("freeze.action")));
    await click(button(copy("freeze.preview")));
    expect(text()).toContain("role-1");
    expect(text()).toContain("client work, team planning");
  });
});
