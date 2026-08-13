// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureGoogleIdentity = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("../../lib/auth/gsi-client", () => ({
  ensureGoogleIdentity,
}));

const { GoogleSignInButton } = await import("./google-sign-in-button");

let root: Root | null = null;

beforeEach(() => {
  ensureGoogleIdentity.mockReset().mockResolvedValue(null);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

describe("GoogleSignInButton fallback", () => {
  it("sends the visitor to the in-site waitlist when GSI is unavailable", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(<GoogleSignInButton />);
      await Promise.resolve();
    });

    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="/waitlist"]',
    );
    expect(link).not.toBeNull();
    expect(link?.target).toBe("");
    expect(link?.rel).toBe("");
  });
});
