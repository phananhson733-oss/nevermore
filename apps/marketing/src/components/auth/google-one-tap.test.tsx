// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureGoogleIdentity = vi.hoisted(() => vi.fn());

vi.mock("../../lib/auth/gsi-client", () => ({
  ensureGoogleIdentity,
}));

const { GoogleOneTap } = await import("./google-one-tap");

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  ensureGoogleIdentity.mockReset().mockResolvedValue("client-id");
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  delete window.google;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("GoogleOneTap session check", () => {
  it("does not prompt when authentication state is unavailable", async () => {
    const prompt = vi.fn();
    window.google = {
      accounts: {
        id: {
          initialize: vi.fn(),
          prompt,
          cancel: vi.fn(),
          renderButton: vi.fn(),
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "auth_unavailable" } },
          { status: 503 },
        ),
      ),
    );

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<GoogleOneTap />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ensureGoogleIdentity).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });
});
