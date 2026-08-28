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
  type WebsiteSummary,
} from "../../lib/account-websites/contracts.ts";

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

const { WebsiteProfilePicker } = await import("./website-profile-picker.tsx");

const EXACT_ID = "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6";
const PRIMARY_ID = "b4f53f12-8090-4c5f-8ddb-7d9587758d7a";
const SNAPSHOT_ID = "a53f4ddb-7cd6-42da-af53-88cc68b41987";
const NOW = "2026-08-28T00:00:00.000Z";
const MESSAGES = {
  agents: {
    workbench: {
      websiteProfile: {
        title: "Saved website profile",
        open: "Use saved website profile",
        loading: "Loading saved websites…",
        unavailable: "Saved websites unavailable.",
        select: "Choose website",
        placeholder: "Choose a website",
        suggested: "Exact URL match",
        primary: "Primary",
        import: "Import",
        reference: "Reference exact version",
        draftOnly: "Confirm this website profile before referencing it.",
        noProfile: "This website has no saved profile yet.",
      },
    },
  },
};

function profile(name = "Example"): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    productName: name,
    oneLinePositioning: "Focused positioning",
    valueProposition: "Evidence-backed value",
    primaryIcp: "Growth teams",
    country: "US",
    locale: "en-US",
  };
}

function summary(
  websiteId: string,
  host: string,
  isPrimary: boolean,
  state: WebsiteSummary["profileState"] = "confirmed",
): WebsiteSummary {
  const confirmed = state === "confirmed" || state === "unconfirmed_changes";
  return {
    websiteId,
    origin: "https://" + host,
    host,
    canonicalSiteKey: host,
    displayName: host === "example.com" ? "Example" : "Primary Co",
    isPrimary,
    profileState: state,
    confirmedSnapshotId: confirmed ? SNAPSHOT_ID : null,
    confirmedSnapshotRevision: confirmed ? 3 : null,
    confirmedAt: confirmed ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function details(
  website: WebsiteSummary,
  options: { readonly confirmed?: boolean; readonly draft?: boolean } = {},
): Promise<WebsiteDetails> {
  const hasDraft = options.draft ?? true;
  const confirmed = options.confirmed ?? true;
  const savedProfile = profile();
  const hash = await profileSha256(savedProfile);
  return {
    ...website,
    submittedUrl: `${website.origin}/`,
    profileState: confirmed ? "confirmed" : hasDraft ? "draft" : "not_generated",
    confirmedSnapshotId: confirmed ? SNAPSHOT_ID : null,
    confirmedSnapshotRevision: confirmed ? 3 : null,
    confirmedAt: confirmed ? NOW : null,
    draft: hasDraft
      ? {
          draftVersion: 4,
          updatedAt: NOW,
          profileHash: hash,
          profile: savedProfile,
        }
      : null,
    currentConfirmedSnapshot: confirmed
      ? {
          schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
          websiteId: website.websiteId,
          snapshotId: SNAPSHOT_ID,
          snapshotRevision: 3,
          profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
          profileHash: hash,
          confirmedAt: NOW,
          profile: savedProfile,
        }
      : null,
  };
}

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

describe("WebsiteProfilePicker", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onImport: (website: WebsiteDetails) => void;
  let onReference: (website: WebsiteDetails) => void;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onImport = vi.fn<(website: WebsiteDetails) => void>();
    onReference = vi.fn<(website: WebsiteDetails) => void>();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function mount(
    targetUrl: string,
    options: { readonly referenceOnly?: boolean } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <WebsiteProfilePicker
            targetUrl={targetUrl}
            onImport={options.referenceOnly === true ? undefined : onImport}
            onReference={onReference}
          />
        </NextIntlClientProvider>,
      );
    });
    const open = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Use saved website profile",
    );
    await act(async () => open?.click());
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
  }

  it("suggests only an exact normalized URL match, never a mismatched primary", async () => {
    const exact = summary(EXACT_ID, "example.com", false);
    const primary = summary(PRIMARY_ID, "other.com", true);
    const exactDetails = await details(exact);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url === "/api/auth/session") {
          return answer(200, { signedIn: true });
        }
        if (url === "/api/account/websites") {
          return answer(200, { data: { websites: [primary, exact] } });
        }
        return answer(200, { data: { website: exactDetails } });
      },
    );
    await mount("https://www.example.com/pricing");
    await settle();

    const select = host.querySelector("select");
    expect(select?.value).toBe(EXACT_ID);
    expect(host.textContent).toContain("Exact URL match");
    expect(onImport).not.toHaveBeenCalled();
    expect(onReference).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/websites/" + EXACT_ID,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not preselect or read details for an unrelated primary website", async () => {
    const primary = summary(PRIMARY_ID, "other.com", true);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(answer(200, { signedIn: true }))
      .mockResolvedValueOnce(
        answer(200, { data: { websites: [primary] } }),
      );
    await mount("https://example.com");
    await settle();

    expect(host.querySelector("select")?.value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches no private website data for a signed-out visitor", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(answer(200, { signedIn: false }));
    await mount("https://example.com");
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("/api/account/websites"),
      ),
    ).toBe(false);
  });

  it.each([
    ["a non-OK session response", answer(503, { error: "unavailable" })],
    ["a malformed signed-in response", answer(200, {})],
  ])("shows unavailable and reads no private website data for %s", async (_label, sessionResponse) => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sessionResponse);

    await mount("https://example.com");
    await settle();

    expect(host.textContent).toContain("Saved websites unavailable.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("/api/account/websites"),
      ),
    ).toBe(false);
  });

  it("shows unavailable and reads no private website data when the session request fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("session transport failed"));

    await mount("https://example.com");
    await settle();

    expect(host.textContent).toContain("Saved websites unavailable.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("/api/account/websites"),
      ),
    ).toBe(false);
  });

  it("refuses both import and reference until a snapshot is confirmed", async () => {
    const draftSummary = summary(EXACT_ID, "example.com", true, "draft");
    const draftDetails = await details(draftSummary, {
      confirmed: false,
      draft: true,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return answer(200, { signedIn: true });
      }
      if (url === "/api/account/websites") {
        return answer(200, { data: { websites: [draftSummary] } });
      }
      return answer(200, { data: { website: draftDetails } });
    });
    await mount("https://example.com");
    await settle();

    const buttons = [...host.querySelectorAll("button")];
    const importButton = buttons.find((button) => button.textContent === "Import");
    const referenceButton = buttons.find(
      (button) => button.textContent === "Reference exact version",
    );
    expect(importButton?.disabled).toBe(true);
    expect(referenceButton?.disabled).toBe(true);
    await act(async () => importButton?.click());
    expect(onImport).not.toHaveBeenCalled();
    expect(onReference).not.toHaveBeenCalled();
  });

  it("returns the exact confirmed profile and reference only on explicit action", async () => {
    const exact = summary(EXACT_ID, "example.com", true);
    const exactDetails = await details(exact);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return answer(200, { signedIn: true });
      }
      if (url === "/api/account/websites") {
        return answer(200, { data: { websites: [exact] } });
      }
      return answer(200, { data: { website: exactDetails } });
    });
    await mount("example.com");
    await settle();

    const referenceButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Reference exact version",
    );
    await act(async () => referenceButton?.click());

    expect(onReference).toHaveBeenCalledWith(exactDetails);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("offers only exact Reference when the consumer omits detached Import", async () => {
    const exact = summary(EXACT_ID, "example.com", true);
    const exactDetails = await details(exact);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return answer(200, { signedIn: true });
      }
      if (url === "/api/account/websites") {
        return answer(200, { data: { websites: [exact] } });
      }
      return answer(200, { data: { website: exactDetails } });
    });
    await mount("https://example.com", { referenceOnly: true });
    await settle();

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.some((button) => button.textContent === "Import")).toBe(false);
    const referenceButton = buttons.find(
      (button) => button.textContent === "Reference exact version",
    );
    expect(referenceButton?.disabled).toBe(false);

    await act(async () => referenceButton?.click());
    expect(onReference).toHaveBeenCalledWith(exactDetails);
    expect(onImport).not.toHaveBeenCalled();
  });
});
