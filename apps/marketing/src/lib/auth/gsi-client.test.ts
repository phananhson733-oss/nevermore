// @vitest-environment jsdom
// @input  -- a stubbed nonce endpoint, a stubbed credential endpoint, and a fake window.google
// @output -- proof that signed-in listeners run synchronously between a credential becoming a
//            session and the reload, never on a refused credential, and never after unregistering
// @pos    -- the seam the draft tool uses to keep its brief across the sign-in reload

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureGoogleIdentity,
  onGoogleSignedIn,
  resetGoogleIdentityForTests,
  type GoogleIdentityServices,
} from "./gsi-client.ts";

type Callback = Parameters<GoogleIdentityServices["accounts"]["id"]["initialize"]>[0]["callback"];

let callback: Callback | null = null;
let settleCredential: ((response: Response) => void) | null = null;
const reload = vi.fn();

beforeEach(() => {
  resetGoogleIdentityForTests();
  callback = null;
  settleCredential = null;
  reload.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  // jsdom never loads the external script: pre-seed the tag and the global so
  // ensureGoogleIdentity takes its "already loaded" branch.
  const script = document.createElement("script");
  script.id = "google-identity-services";
  document.head.append(script);
  window.google = {
    accounts: {
      id: {
        initialize: vi.fn((config) => {
          callback = config.callback;
        }),
        prompt: vi.fn(),
        cancel: vi.fn(),
        renderButton: vi.fn(),
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/one-tap/nonce") return Response.json({ clientId: "client-id", nonce: "abc123" });
      if (url === "/api/auth/one-tap") {
        return new Promise<Response>((resolve) => {
          settleCredential = resolve;
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => {
  delete window.google;
  document.head.replaceChildren();
  vi.unstubAllGlobals();
  resetGoogleIdentityForTests();
});

async function signInWithCredential(): Promise<void> {
  await ensureGoogleIdentity();
  if (callback === null) throw new Error("GSI callback was not registered");
  callback({ credential: "jwt" });
  // Let the POST be issued and await its deferred response.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(status: number): Promise<void> {
  if (settleCredential === null) throw new Error("credential POST not in flight");
  settleCredential(new Response(null, { status }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("onGoogleSignedIn", () => {
  it("runs a listener after the credential became a session and before the reload", async () => {
    const order: string[] = [];
    reload.mockImplementation(() => order.push("reload"));
    onGoogleSignedIn(() => order.push("listener"));
    await signInWithCredential();
    expect(order).toEqual([]);
    await settle(200);
    expect(order).toEqual(["listener", "reload"]);
  });

  it("completes a credential posted before the listener's dialog closed", async () => {
    // The dialog closing does not unregister anything; only unmounting does.
    const listener = vi.fn();
    onGoogleSignedIn(listener);
    await signInWithCredential();
    await settle(200);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never runs a listener for a refused credential, and does not reload", async () => {
    const listener = vi.fn();
    onGoogleSignedIn(listener);
    await signInWithCredential();
    await settle(401);
    expect(listener).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops running a listener once it is unregistered", async () => {
    const listener = vi.fn();
    const unregister = onGoogleSignedIn(listener);
    unregister();
    await signInWithCredential();
    await settle(200);
    expect(listener).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads when a listener throws", async () => {
    onGoogleSignedIn(() => {
      throw new Error("listener");
    });
    await signInWithCredential();
    await settle(200);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
