// @vitest-environment jsdom
// @input  -- a harness component around useSignedInListener, over a mocked gsi-client
// @output -- proof the optional onSignedIn is registered for as long as the component is mounted
//            and released on unmount, and that callers without it register nothing
// @pos    -- the contract other tools rely on staying unchanged: no prop, no listener

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { onGoogleSignedInMock, unregisterMock } = vi.hoisted(() => {
  const unregisterMock = vi.fn();
  return { unregisterMock, onGoogleSignedInMock: vi.fn(() => unregisterMock) };
});

vi.mock("../../lib/auth/gsi-client", () => ({
  onGoogleSignedIn: onGoogleSignedInMock,
}));

const { useSignedInListener } = await import("./use-signed-in-listener.ts");

function Harness({ onSignedIn }: { readonly onSignedIn?: () => void }) {
  useSignedInListener(onSignedIn);
  return null;
}

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onGoogleSignedInMock.mockClear();
  unregisterMock.mockClear();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

async function render(onSignedIn?: () => void): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Harness onSignedIn={onSignedIn} />);
  });
}

describe("useSignedInListener", () => {
  it("registers the listener while mounted and releases it on unmount", async () => {
    const onSignedIn = () => undefined;
    await render(onSignedIn);
    expect(onGoogleSignedInMock).toHaveBeenCalledTimes(1);
    expect(onGoogleSignedInMock).toHaveBeenCalledWith(onSignedIn);
    expect(unregisterMock).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
    root = null;
    expect(unregisterMock).toHaveBeenCalledTimes(1);
  });

  it("registers nothing for callers that do not pass a listener", async () => {
    await render(undefined);
    expect(onGoogleSignedInMock).not.toHaveBeenCalled();
  });
});
