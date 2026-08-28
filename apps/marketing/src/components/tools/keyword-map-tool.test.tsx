// @vitest-environment jsdom
// @input  -- connected Keyword Map form plus one exact website snapshot
// @output -- detached import and exact-reference interaction guarantees
// @pos    -- component tests for the private profile overlay on Keyword Map

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  emptyMarketingWebsiteProfile,
  profileSha256,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
} from "../../lib/account-websites/contracts.ts";

const PROFILE = {
  ...emptyMarketingWebsiteProfile(),
  productName: "Acme",
  oneLinePositioning: "Revenue operations for clinics",
  valueProposition: "Find and fix revenue leakage",
  categories: ["Revenue operations"],
  coreFeatures: ["Claim automation"],
  useCases: ["Recover denied claims"],
  icpInterests: ["Faster cash flow"],
  primaryIcp: "Clinic finance teams",
  jtbd: "Reduce days in accounts receivable",
  country: "GB",
  locale: "fr-FR",
};
const PROFILE_HASH = await profileSha256(PROFILE);
const REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
  websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
  snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
  snapshotRevision: 4,
  profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
  profileHash: PROFILE_HASH,
};
const WEBSITE: WebsiteDetails = {
  websiteId: REFERENCE.websiteId,
  origin: "https://acme.example",
  submittedUrl: "https://acme.example/",
  host: "acme.example",
  canonicalSiteKey: "acme.example",
  displayName: "Acme",
  isPrimary: true,
  profileState: "confirmed",
  confirmedSnapshotId: REFERENCE.snapshotId,
  confirmedSnapshotRevision: REFERENCE.snapshotRevision,
  confirmedAt: "2026-08-28T00:00:00.000Z",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  draft: {
    draftVersion: 5,
    updatedAt: "2026-08-28T00:00:00.000Z",
    profileHash: PROFILE_HASH,
    profile: PROFILE,
  },
  currentConfirmedSnapshot: {
    ...REFERENCE,
    confirmedAt: "2026-08-28T00:00:00.000Z",
    profile: PROFILE,
  },
};

vi.mock("../layout/google-analytics.tsx", () => ({
  trackMarketingEvent: vi.fn(),
}));

vi.mock("../../lib/tools/property-label.ts", () => ({
  formatPropertyLabel: (value: string) => value,
}));

vi.mock("./gsc-connect-panel", () => ({
  GscConnectPanel: () => <div data-testid="gsc-connect" />,
  gscAuthorizeHref: () => "/connect",
}));

vi.mock("./gsc-disconnect", () => ({
  GscDisconnect: () => <div data-testid="gsc-disconnect" />,
}));

vi.mock("./keyword-map-results", () => ({
  KeywordMapResults: () => <div data-testid="keyword-results" />,
}));

vi.mock("../account/website-profile-picker.tsx", () => ({
  WebsiteProfilePicker: ({
    targetUrl,
    onImport,
    onReference,
  }: {
    readonly targetUrl: string;
    readonly onImport?: (website: WebsiteDetails) => void;
    readonly onReference: (website: WebsiteDetails) => void;
  }) => (
    <div data-testid="profile-picker" data-target-url={targetUrl}>
      <button type="button" onClick={() => onImport?.(WEBSITE)}>
        Test import profile
      </button>
      <button type="button" onClick={() => onReference(WEBSITE)}>
        Test reference profile
      </button>
    </div>
  ),
}));

const { KeywordMapTool } = await import("./keyword-map-tool.tsx");

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function response(reference?: WebsiteProfileReferenceV1): Response {
  return Response.json(
    {
      data: {
        contextToken: "sealed-context",
        propositions: [],
        pagesFetched: 3,
        productPagesFetched: 1,
        contextSufficient: true,
        ...(reference === undefined
          ? {}
          : { websiteProfileReference: reference }),
      },
    },
    { status: 200 },
  );
}

describe("KeywordMapTool website profile context", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(
    properties: readonly string[] | null = [
      "sc-domain:acme.example",
      "sc-domain:other.example",
    ],
  ): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          messages={{ tools: en.tools, agents: en.agents }}
        >
          <KeywordMapTool
            locale="en"
            properties={properties}
            propertyTotal={properties?.length ?? 0}
            connectEnabled
            consentNotice="none"
            markets={["US", "GB", "FR"]}
          />
        </NextIntlClientProvider>,
      );
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 2; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
  }

  async function waitFor(
    condition: () => boolean,
    description: string,
  ): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!condition()) {
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${description}`);
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }

  async function waitForProfile(kind: "import" | "reference"): Promise<void> {
    await waitFor(
      () =>
        host.querySelector(
          `[data-keyword-profile-context="${kind}"]`,
        ) !== null,
      `${kind} website profile context`,
    );
  }

  function button(text: string): HTMLButtonElement {
    const match = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === text,
    );
    if (match === undefined) throw new Error(`button not found: ${text}`);
    return match;
  }

  function inputs(): {
    readonly site: HTMLInputElement;
    readonly seeds: HTMLInputElement;
    readonly property: HTMLSelectElement;
    readonly market: HTMLSelectElement;
    readonly language: HTMLSelectElement;
  } {
    const [property, market, language] = host.querySelectorAll("select");
    const site = host.querySelector<HTMLInputElement>('input[type="url"]');
    const seeds = host.querySelector<HTMLInputElement>('input[type="text"]');
    if (
      property === undefined ||
      market === undefined ||
      language === undefined ||
      site === null ||
      seeds === null
    ) {
      throw new Error("keyword form is incomplete");
    }
    return { site, seeds, property, market, language };
  }

  it("renders the picker only on the connected property surface", async () => {
    await render(null);
    expect(host.querySelector('[data-testid="gsc-connect"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="profile-picker"]')).toBeNull();
  });

  it("imports detached editable seeds and sends no profile reference", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(response());
    await render();
    const form = inputs();
    await act(async () => setValue(form.seeds, "old seed"));

    await act(async () => button("Test import profile").click());
    await waitForProfile("import");

    expect(form.site.value).toBe("https://acme.example");
    expect(form.market.value).toBe("GB");
    expect(form.language.value).toBe("fr");
    expect(form.seeds.value).toBe(
      [
        "Revenue operations",
        "Claim automation",
        "Recover denied claims",
        "Faster cash flow",
        "Clinic finance teams",
        "Reduce days in accounts receivable",
      ].join(", "),
    );
    expect(host.textContent).toContain("Detached website profile import");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => button("Read my site").click());
    await settle();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("websiteProfileReference");
    expect(body["seeds"]).toEqual([
      "Revenue operations",
      "Claim automation",
      "Recover denied claims",
      "Faster cash flow",
      "Clinic finance teams",
      "Reduce days in accounts receivable",
    ]);
  });

  it("references exact pinned seeds while sending only the editable overlay", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(response(REFERENCE));
    await render();
    const form = inputs();
    await act(async () => setValue(form.seeds, "old seed"));

    await act(async () => button("Test reference profile").click());
    await waitForProfile("reference");

    expect(form.seeds.value).toBe("");
    expect(host.textContent).toContain("Exact website profile reference");
    expect(host.textContent).toContain("Revision 4");
    expect(host.textContent).toContain(PROFILE_HASH.slice(0, 8));
    expect(host.textContent).toContain("Revenue operations");
    expect(host.textContent?.toLowerCase()).not.toContain("save back");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => setValue(form.seeds, "Clinic scheduling"));
    await act(async () => setValue(form.market, "FR"));
    await act(async () => setValue(form.language, "en"));
    await act(async () => button("Read my site").click());
    await settle();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["websiteProfileReference"]).toEqual(REFERENCE);
    expect(body["seeds"]).toEqual(["Clinic scheduling"]);
    expect(body["marketCode"]).toBe("FR");
    expect(body["languageCode"]).toBe("en");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/tools/hidden-keywords/context",
    );
    expect(host.textContent).toContain("Server accepted this exact version");
  });

  it("rejects a context response that acknowledges a different reference", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      response({ ...REFERENCE, snapshotRevision: REFERENCE.snapshotRevision + 1 }),
    );
    await render();
    await act(async () => button("Test reference profile").click());
    await waitForProfile("reference");

    await act(async () => button("Read my site").click());
    await settle();

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("What we read off your site");
  });

  it.each([
    [
      401,
      "authentication_required",
      "Your account session is no longer available. Sign in again, then reselect the saved website profile.",
    ],
    [
      503,
      "invalid_request",
      "Saved website profiles are temporarily unavailable. No crawl or keyword generation started; try again shortly.",
    ],
    [
      400,
      "invalid_input",
      "Check the site URL, market and language — one of them was not accepted.",
    ],
  ] as const)(
    "renders truthful contextual copy for a %s reference refusal",
    async (status, code, expected) => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValue(
        Response.json({ error: { code } }, { status }),
      );
      await render();
      await act(async () => button("Test reference profile").click());
      await waitForProfile("reference");

      await act(async () => button("Read my site").click());
      await settle();

      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        expected,
      );
      expect(host.textContent).not.toContain("Connect Search Console again");
      expect(host.textContent?.toLowerCase()).not.toContain(
        "search-data provider",
      );
    },
  );

  it("clears an exact reference when the edited site URL is not canonicalizable", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "invalid_input" } },
        { status: 400 },
      ),
    );
    await render();
    const form = inputs();
    await act(async () => button("Test reference profile").click());
    await waitForProfile("reference");

    await act(async () => setValue(form.site, "ftp://acme.example"));
    expect(host.textContent).not.toContain("Exact website profile reference");
    await act(async () => button("Read my site").click());
    await settle();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("websiteProfileReference");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Check the site URL, market and language — one of them was not accepted.",
    );
  });

  it("keeps a reference across a same-host path and clears it on host or property change", async () => {
    await render();
    const form = inputs();
    await act(async () => button("Test reference profile").click());
    await waitForProfile("reference");

    await act(async () =>
      setValue(form.site, "https://www.acme.example/pricing"),
    );
    expect(host.textContent).toContain("Exact website profile reference");

    await act(async () => setValue(form.site, "https://other.example"));
    expect(host.textContent).not.toContain("Exact website profile reference");

    await act(async () => button("Test reference profile").click());
    await waitForProfile("reference");
    expect(host.textContent).toContain("Exact website profile reference");
    await act(async () =>
      setValue(form.property, "sc-domain:other.example"),
    );
    expect(host.textContent).not.toContain("Exact website profile reference");
  });
});
