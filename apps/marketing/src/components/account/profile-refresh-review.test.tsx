// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";

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

const { ProfileRefreshReview } = await import("./profile-refresh-review.tsx");

const MESSAGES = {
  account: {
    websites: {
      fields: {
        productName: "Product name",
        valueProposition: "Value proposition",
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
    },
  },
};

function profiles() {
  const current = {
    ...emptyMarketingWebsiteProfile(),
    productName: "User-edited name",
    valueProposition: "Old value",
    fieldProvenance: [
      {
        path: "/productName" as const,
        derivation: "declared" as const,
        confidence: "high" as const,
        source: "user_edit" as const,
        limitation: null,
        observedAt: "2026-08-27T08:00:00.000Z",
        evidenceUrls: [],
      },
    ],
  };
  const proposal = {
    ...current,
    valueProposition: "New evidenced value",
    fieldProvenance: [
      ...current.fieldProvenance,
      {
        path: "/valueProposition" as const,
        derivation: "inferred" as const,
        confidence: "medium" as const,
        source: "public_page" as const,
        limitation: null,
        observedAt: "2026-08-28T00:00:00.000Z",
        evidenceUrls: ["https://example.com/product"],
      },
    ],
  };
  return { current, proposal };
}

describe("ProfileRefreshReview", () => {
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
    vi.restoreAllMocks();
  });

  it("shows field-level current/proposed values without applying them", async () => {
    const onApply = vi.fn();
    const { current, proposal } = profiles();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <ProfileRefreshReview
            current={current}
            proposal={proposal}
            availability="partial"
            onApply={onApply}
            onDismiss={vi.fn()}
          />
        </NextIntlClientProvider>,
      );
    });

    expect(host.textContent).toContain("Old value");
    expect(host.textContent).toContain("New evidenced value");
    expect(host.textContent).not.toContain("Product name");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies one field or all changed fields only after explicit action", async () => {
    const onApply = vi.fn();
    const { current, proposal } = profiles();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <ProfileRefreshReview
            current={current}
            proposal={proposal}
            availability="partial"
            onApply={onApply}
            onDismiss={vi.fn()}
          />
        </NextIntlClientProvider>,
      );
    });

    const buttons = [...host.querySelectorAll("button")];
    await act(async () => {
      buttons.find((button) => button.textContent === "Apply")?.click();
    });
    expect(onApply).toHaveBeenLastCalledWith(["valueProposition"]);

    await act(async () => {
      buttons
        .find((button) => button.textContent === "Apply all proposals")
        ?.click();
    });
    expect(onApply).toHaveBeenLastCalledWith(["valueProposition"]);
  });

  it("renders evidence as a safe external link", async () => {
    const { current, proposal } = profiles();
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <ProfileRefreshReview
            current={current}
            proposal={proposal}
            availability="available"
            onApply={vi.fn()}
            onDismiss={vi.fn()}
          />
        </NextIntlClientProvider>,
      );
    });

    const link = host.querySelector('a[href="https://example.com/product"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });
});
