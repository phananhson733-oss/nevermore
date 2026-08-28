// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
} from "../../lib/account-websites/contracts.ts";
import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  type AgentProfileRefreshData,
  type AgentProfileRefreshField,
} from "../../lib/agents/profile-refresh-contract.ts";

vi.mock("../ui/button.tsx", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<"button"> & {
    variant?: string;
    size?: string;
  }) => <button {...props} />,
}));
vi.mock("../ui/card.tsx", () => ({
  Card: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardHeader: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  CardTitle: ({ children, ...props }: React.ComponentProps<"div">) => (
    <h3 {...props}>{children}</h3>
  ),
  CardDescription: ({ children, ...props }: React.ComponentProps<"div">) => (
    <p {...props}>{children}</p>
  ),
}));
vi.mock("../ui/input.tsx", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("../ui/textarea.tsx", () => ({
  Textarea: (props: React.ComponentProps<"textarea">) => (
    <textarea {...props} />
  ),
}));
vi.mock("../ui/label.tsx", () => ({
  Label: (props: React.ComponentProps<"label">) => <label {...props} />,
}));

const { WebsiteProfileEditor } = await import("./website-profile-editor.tsx");

const WEBSITE_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const NOW = "2026-08-28T00:00:00.000Z";

const EDITOR = {
  loading: "Loading profile…",
  signedOut: "Sign in to edit this profile.",
  unavailable: "Profile unavailable.",
  notFound: "Website not found.",
  productSection: "Product",
  icpSection: "ICP",
  marketSection: "Market and alternatives",
  sourcesSection: "Sources and versions",
  listAdd: "Add item",
  listRemove: "Remove",
  saveDraft: "Save draft",
  retrySave: "Retry save",
  listIncomplete: "Finish or remove empty list items before saving.",
  rescan: "Re-scan website",
  generating: "Scanning…",
  generationFailed: "Refresh failed.",
  saveState: {
    unsaved: "Unsaved",
    saving: "Saving…",
    saved: "Saved",
    failed: "Save failed",
    conflicted: "Conflict",
  },
  conflict: {
    title: "Resolve conflict",
    body: "Choose local or server values, then save against the latest version.",
    local: "Local",
    server: "Server",
    keepLocal: "Keep local",
    useServer: "Use server",
    save: "Save merged draft",
  },
  confirm: {
    title: "Confirm profile",
    missing: "Complete required fields before confirming.",
    changes: "{count} changes from the current confirmed version",
    action: "Confirm profile",
    confirming: "Confirming…",
    version: "Confirmed v{revision}",
    failed: "Confirmation failed.",
  },
  draftVersion: "Draft v{version}",
  noSources: "No source URLs yet.",
};

const MESSAGES = {
  account: {
    websites: {
      fields: {
        productName: "Product name",
        oneLinePositioning: "One-line positioning",
        valueProposition: "Value proposition",
        coreFeatures: "Core features",
        categories: "Categories",
        businessModel: "Business model",
        primaryCta: "Primary CTA",
        trustSignals: "Trust signals",
        primaryIcp: "Primary ICP",
        buyer: "Buyer",
        user: "User",
        triggerPain: "Trigger pain",
        icpInterests: "ICP interests",
        icpPain: "ICP pain",
        icpBehavior: "ICP behavior",
        icpPositioning: "ICP positioning",
        jtbd: "Job to be done",
        useCases: "Use cases",
        outcomes: "Desired outcomes",
        barriers: "Barriers",
        qualificationSignals: "Qualification signals",
        disqualifiers: "Disqualifiers",
        directCompetitors: "Direct competitors",
        indirectAlternatives: "Indirect alternatives",
        excludedAlternatives: "Excluded alternatives",
        firstOutcome: "First outcome",
        country: "Primary market",
        locale: "Primary language",
      },
      refresh: {
        title: "Review refresh",
        available: "A complete refresh is ready.",
        partial: "A partial refresh is ready.",
        no_data: "No reusable fields were found.",
        current: "Current",
        proposed: "Proposed",
        evidence: "Sources",
        applyAll: "Apply all proposals",
        applyField: "Apply",
        dismiss: "Dismiss",
        noChanges: "No field changes were proposed.",
      },
      editor: EDITOR,
    },
  },
};

function profile(
  overrides: Partial<MarketingWebsiteProfileV1> = {},
): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: "Example",
    oneLinePositioning: "Focused positioning",
    valueProposition: "Old value",
    coreFeatures: ["Feature A", "Feature B"],
    primaryIcp: "Growth teams",
    country: "US",
    locale: "en-US",
    fieldProvenance: [
      {
        path: "/productName",
        derivation: "declared",
        confidence: "high",
        source: "user_edit",
        limitation: null,
        observedAt: null,
        evidenceUrls: [],
      },
    ],
    ...overrides,
  };
}

async function details(
  draftProfile: MarketingWebsiteProfileV1,
  options: {
    readonly draftVersion?: number;
    readonly snapshotProfile?: MarketingWebsiteProfileV1 | null;
    readonly snapshotRevision?: number;
  } = {},
): Promise<WebsiteDetails> {
  const draftVersion = options.draftVersion ?? 2;
  const snapshotProfile =
    options.snapshotProfile === undefined
      ? draftProfile
      : options.snapshotProfile;
  const draftHash = await profileSha256(draftProfile);
  const snapshotHash =
    snapshotProfile === null ? null : await profileSha256(snapshotProfile);
  const state =
    snapshotHash === null
      ? "draft"
      : snapshotHash === draftHash
        ? "confirmed"
        : "unconfirmed_changes";
  const revision = options.snapshotRevision ?? 1;
  return {
    websiteId: WEBSITE_ID,
    origin: "https://example.com",
    submittedUrl: "https://example.com/",
    host: "example.com",
    canonicalSiteKey: "example.com",
    displayName: "Example",
    isPrimary: true,
    profileState: state,
    confirmedSnapshotId: snapshotProfile === null ? null : SNAPSHOT_ID,
    confirmedSnapshotRevision: snapshotProfile === null ? null : revision,
    confirmedAt: snapshotProfile === null ? null : NOW,
    createdAt: NOW,
    updatedAt: NOW,
    draft: {
      draftVersion,
      updatedAt: NOW,
      profileHash: draftHash,
      profile: draftProfile,
    },
    currentConfirmedSnapshot:
      snapshotProfile === null
        ? null
        : {
            schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
            websiteId: WEBSITE_ID,
            snapshotId: SNAPSHOT_ID,
            snapshotRevision: revision,
            profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
            profileHash: snapshotHash as string,
            confirmedAt: NOW,
            profile: snapshotProfile,
          },
  };
}

function refresh(): AgentProfileRefreshData {
  const available = {
    productName: {
      value: "Crawler suggestion",
      confidence: "medium" as const,
    },
    valueProposition: {
      value: "Fresh evidenced value",
      confidence: "high" as const,
    },
  };
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) => {
    if (path === "productName" || path === "valueProposition") {
      return {
        path,
        state: "available",
        value: available[path].value,
        derivation: "inferred",
        confidence: available[path].confidence,
        source: "public_page",
        limitation: null,
        evidenceUrls: ["https://example.com/"],
      } as AgentProfileRefreshField;
    }
    return {
      path,
      state: "unavailable",
      value: null,
      derivation: "missing",
      confidence: "unknown",
      source: "not_available",
      limitation: "Not found in the bounded public pages.",
      evidenceUrls: [],
    } as AgentProfileRefreshField;
  });
  return {
    schemaVersion: "agent_profile_refresh.v1",
    agent: "seo",
    request: {
      submittedUrl: "https://example.com/",
      normalizedUrl: "https://example.com/",
      targetHost: "example.com",
      marketCode: "US",
      languageTag: "en-US",
      outputLocale: "en",
    },
    availability: "partial",
    observedAt: NOW,
    cache: { status: "fresh", capturedAt: NOW },
    diagnostics: {
      resolvedOrigin: "https://example.com",
      pagesFetched: 1,
      productPagesFetched: 1,
      stopReason: null,
      contextSufficient: false,
      sourceUrls: ["https://example.com/"],
      fieldsAvailable: 2,
      fieldsMissing: fields.length - 2,
    },
    fields,
  };
}

function noDataRefresh(): AgentProfileRefreshData {
  const baseline = refresh();
  const fields = AGENT_PROFILE_REFRESH_FIELD_PATHS.map(
    (path) =>
      ({
        path,
        state: "unavailable",
        value: null,
        derivation: "missing",
        confidence: "unknown",
        source: "not_available",
        limitation: "Not found in the bounded public pages.",
        evidenceUrls: [],
      }) as AgentProfileRefreshField,
  );
  return {
    ...baseline,
    availability: "no_data",
    diagnostics: {
      ...baseline.diagnostics,
      fieldsAvailable: 0,
      fieldsMissing: fields.length,
    },
    fields,
  };
}

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function change(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("WebsiteProfileEditor", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mount(autoGenerate = false): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <WebsiteProfileEditor
            websiteId={WEBSITE_ID}
            autoGenerate={autoGenerate}
          />
        </NextIntlClientProvider>,
      );
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!host.textContent?.includes(EDITOR.loading)) return;
      await settle();
    }
    throw new Error("editor still loading");
  }

  async function settle(): Promise<void> {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (let index = 0; index < 12; index += 1) {
        await Promise.resolve();
      }
    });
  }

  async function waitForSaveState(value: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (host.querySelector(`[data-save-state="${value}"]`) !== null) return;
      await settle();
    }
    throw new Error(`save state ${value} did not render`);
  }

  function field(label: string): HTMLInputElement | HTMLTextAreaElement {
    const labelNode = [...host.querySelectorAll("label")].find(
      (node) => node.textContent?.trim() === label,
    );
    const id = labelNode?.getAttribute("for");
    const node = id ? document.getElementById(id) : null;
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      throw new Error("field missing");
    }
    return node;
  }

  function button(label: string): HTMLButtonElement {
    const node = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!(node instanceof HTMLButtonElement)) throw new Error("button missing");
    return node;
  }

  it("renders four sections and list fields as separate editable items", async () => {
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(EDITOR.productSection);
    expect(host.textContent).toContain(EDITOR.icpSection);
    expect(host.textContent).toContain(EDITOR.marketSection);
    expect(host.textContent).toContain(EDITOR.sourcesSection);
    const featureInputs = host.querySelectorAll(
      '[data-list-field="coreFeatures"] input',
    );
    expect(featureInputs).toHaveLength(2);
    expect([...featureInputs].map((node) => (node as HTMLInputElement).value)).toEqual([
      "Feature A",
      "Feature B",
    ]);
    const cleanNavigation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanNavigation);
    expect(cleanNavigation.defaultPrevented).toBe(false);
  });

  it("fails closed when the detail response belongs to a different website", async () => {
    const initial = await details(profile(), { snapshotProfile: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, {
        data: {
          website: {
            ...initial,
            websiteId: "b4f53f12-8090-4c5f-8ddb-7d9587758d7a",
          },
        },
      }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(EDITOR.unavailable);
    expect(host.textContent).not.toContain(EDITOR.productSection);
  });

  it("debounces autosave and becomes saved only after a valid 200 response", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    let resolvePatch!: (response: Response) => void;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        if (init?.method !== "PATCH") {
          return answer(200, { data: { website: initial } });
        }
        return patchResponse;
      },
    );
    await mount();
    await settle();

    await act(async () => {
      change(field("Product name"), "Edited product");
    });
    expect(host.textContent).toContain(EDITOR.saveState.unsaved);
    await act(async () => vi.advanceTimersByTime(899));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(host.textContent).toContain(EDITOR.saveState.saving);

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    );
    const body = JSON.parse(String(patchCall?.[1]?.body)) as {
      profile: MarketingWebsiteProfileV1;
    };
    resolvePatch(
      answer(200, {
        data: {
          website: await details(body.profile, {
            draftVersion: 3,
            snapshotProfile: profile(),
          }),
        },
      }),
    );
    await waitForSaveState("saved");

    expect(host.textContent).toContain(EDITOR.saveState.saved);
    expect(body.profile.productName).toBe("Edited product");
    expect(
      body.profile.fieldProvenance.find(
        (entry) => entry.path === "/productName",
      )?.source,
    ).toBe("user_edit");
  });

  it("keeps a newly added blank list row unsaved until the user types", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();

    const featureField = host.querySelector('[data-list-field="coreFeatures"]');
    const add = [...(featureField?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent?.trim() === EDITOR.listAdd,
    );
    if (!(add instanceof HTMLButtonElement)) throw new Error("add item missing");
    await act(async () => add.click());

    expect(featureField?.querySelectorAll("input")).toHaveLength(3);
    expect(
      featureField?.querySelectorAll<HTMLInputElement>("input").item(2).value,
    ).toBe("");
    await act(async () => vi.advanceTimersByTime(900));
    await settle();

    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(host.textContent).toContain(EDITOR.saveState.unsaved);
    expect(host.textContent).toContain(EDITOR.listIncomplete);
    expect(button(EDITOR.saveDraft).disabled).toBe(true);
  });

  it("preserves local input on failed save and warns before navigation", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(
        answer(503, {
          error: { code: "account_websites_unavailable" },
        }),
      );
    await mount();
    await settle();

    await act(async () => {
      change(field("Value proposition"), "Local unsaved value");
    });
    await act(async () => vi.advanceTimersByTime(900));
    await waitForSaveState("failed");

    expect(field("Value proposition").value).toBe("Local unsaved value");
    expect(host.textContent).toContain(EDITOR.saveState.failed);
    expect(host.textContent).toContain(EDITOR.retrySave);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps local values and shows field comparison on a 409", async () => {
    vi.useFakeTimers();
    const initial = await details(profile());
    const server = await details(profile({ productName: "Server value" }), {
      draftVersion: 3,
      snapshotProfile: profile(),
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(
        answer(409, {
          error: {
            code: "profile_conflict",
            details: { website: server },
          },
        }),
      );
    await mount();
    await settle();

    await act(async () => {
      change(field("Product name"), "Local value");
    });
    await act(async () => vi.advanceTimersByTime(900));
    await waitForSaveState("conflicted");

    expect(field("Product name").value).toBe("Local value");
    expect(host.textContent).toContain(EDITOR.conflict.title);
    expect(host.textContent).toContain("Local value");
    expect(host.textContent).toContain("Server value");
    expect(host.textContent).toContain(EDITOR.saveState.conflicted);
    expect(button(EDITOR.saveDraft).disabled).toBe(true);
    const conflictNavigation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(conflictNavigation);
    expect(conflictNavigation.defaultPrevented).toBe(true);
  });

  it("reviews refresh proposals without overwriting manual fields or confirming", async () => {
    const initial = await details(profile());
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(200, { data: refresh() }));
    await mount();
    await settle();

    await act(async () => button(EDITOR.rescan).click());
    await settle();

    expect(host.textContent).toContain("Fresh evidenced value");
    expect(host.textContent).not.toContain("Crawler suggestion");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST" &&
      String(init.body).includes("baseVersion"))).toBe(false);

    await act(async () => button("Apply").click());
    expect(field("Value proposition").value).toBe("Fresh evidenced value");
    expect(host.textContent).toContain(EDITOR.saveState.unsaved);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
      false,
    );
  });

  it("honors Add + Generate with a foreground prefer-cache refresh", async () => {
    vi.useFakeTimers();
    const template = await details(profile());
    const submittedUrl =
      "https://www.example.com/pricing?utm_source=account";
    const initial: WebsiteDetails = {
      ...template,
      submittedUrl,
      profileState: "not_generated",
      confirmedSnapshotId: null,
      confirmedSnapshotRevision: null,
      confirmedAt: null,
      draft: null,
      currentConfirmedSnapshot: null,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        if (url.endsWith("/profile-refresh")) {
          const refreshed = refresh();
          return answer(200, {
            data: {
              ...refreshed,
              request: {
                ...refreshed.request,
                submittedUrl,
                normalizedUrl: submittedUrl,
                targetHost: "www.example.com",
              },
            },
          });
        }
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as {
            profile: MarketingWebsiteProfileV1;
          };
          return answer(200, {
            data: {
              website: await details(body.profile, {
                draftVersion: 1,
                snapshotProfile: null,
              }),
            },
          });
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount(true);
    await settle();
    await settle();
    await act(async () => vi.advanceTimersByTime(900));
    await settle();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const refreshBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    ) as { mode: string; url: string };
    expect(refreshBody.mode).toBe("prefer_cache");
    expect(refreshBody.url).toBe(submittedUrl);
    expect(field("Value proposition").value).toBe("Fresh evidenced value");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("PATCH");
    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input).endsWith("/confirm"),
      ),
    ).toBe(false);
  });

  it("rebases a late refresh on edits made while scanning", async () => {
    const initial = await details(profile());
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return refreshResponse;
      return answer(200, { data: { website: initial } });
    });
    await mount();
    await settle();

    await act(async () => button(EDITOR.rescan).click());
    await act(async () => {
      change(field("Value proposition"), "Typed while scanning");
    });
    resolveRefresh(answer(200, { data: refresh() }));
    await settle();

    expect(field("Value proposition").value).toBe("Typed while scanning");
    expect(host.textContent).not.toContain("Fresh evidenced value");
  });

  it("lists missing required fields and disables confirmation", async () => {
    const incomplete = profile({ valueProposition: "" });
    const initial = await details(incomplete, { snapshotProfile: null });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    expect(host.textContent).toContain(EDITOR.confirm.missing);
    expect(host.textContent).toContain("Value proposition");
    expect(button(EDITOR.confirm.action).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a no-data first generation distinct and does not create an empty draft", async () => {
    vi.useFakeTimers();
    const template = await details(profile());
    const initial: WebsiteDetails = {
      ...template,
      profileState: "not_generated",
      confirmedSnapshotId: null,
      confirmedSnapshotRevision: null,
      confirmedAt: null,
      draft: null,
      currentConfirmedSnapshot: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(200, { data: noDataRefresh() }));
    await mount(true);
    await settle();
    await settle();
    await act(async () => vi.advanceTimersByTime(900));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("No reusable fields were found.");
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
  });

  it("aborts a foreground refresh when the editor closes", async () => {
    const initial = await details(profile());
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        if (init?.method === "POST") {
          return new Promise<Response>(() => {});
        }
        return answer(200, { data: { website: initial } });
      },
    );
    await mount();
    await settle();

    await act(async () => button(EDITOR.rescan).click());
    const refreshCall = fetchMock.mock.calls.find(
      ([input]) => String(input).endsWith("/profile-refresh"),
    );
    const signal = refreshCall?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      root.render(<div />);
    });
    expect(signal?.aborted).toBe(true);
  });

  it("previews and confirms an unchanged saved profile without changing revision", async () => {
    const initial = await details(profile(), { snapshotRevision: 1 });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }));
    await mount();
    await settle();

    expect(host.textContent).toContain(
      "0 changes from the current confirmed version",
    );
    await act(async () => button(EDITOR.confirm.action).click());
    await settle();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/account/websites/" + WEBSITE_ID + "/confirm",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: 2 }),
      },
    );
    expect(host.textContent).toContain("Confirmed v1");
  });

  it("surfaces confirmation failures instead of turning the button into a no-op", async () => {
    const initial = await details(profile());
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { data: { website: initial } }))
      .mockResolvedValueOnce(
        answer(503, {
          error: { code: "account_websites_unavailable" },
        }),
      );
    await mount();
    await settle();

    await act(async () => button(EDITOR.confirm.action).click());
    await settle();

    expect(host.textContent).toContain(EDITOR.confirm.failed);
    expect(host.querySelector('[data-confirm-error="true"]')).not.toBeNull();

    await act(async () => {
      change(field("Product name"), "Corrected after failure");
    });
    expect(host.querySelector('[data-confirm-error="true"]')).toBeNull();
  });

  it("previews the exact fields changed from the confirmed snapshot", async () => {
    const confirmed = profile();
    const draft = profile({ productName: "New product name" });
    const initial = await details(draft, {
      snapshotProfile: confirmed,
      snapshotRevision: 1,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer(200, { data: { website: initial } }),
    );
    await mount();
    await settle();

    expect(
      host.querySelector('[data-confirm-change="productName"]')?.textContent,
    ).toContain("Product name");
    expect(host.querySelectorAll("[data-confirm-change]")).toHaveLength(1);
  });
});
