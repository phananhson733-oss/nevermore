import { describe, expect, it, vi } from "vitest";
import { SourceError } from "./adapter.ts";
import { cancelResponseBody, readBoundedJson } from "./provider-http.ts";

const WAIT_MARKER = Symbol("still waiting");

async function settleOrMarker<T>(promise: Promise<T>): Promise<T | typeof WAIT_MARKER> {
  return Promise.race([
    promise,
    new Promise<typeof WAIT_MARKER>((resolve) => {
      setTimeout(() => resolve(WAIT_MARKER), 10);
    }),
  ]);
}

describe("provider HTTP response boundaries", () => {
  it("does not wait for a response-body cancellation that never settles", async () => {
    let releaseCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const response = {
      body: { cancel: vi.fn(() => cancellation) },
    } as unknown as Response;

    const pending = cancelResponseBody(response);
    const outcome = await settleOrMarker(pending);
    releaseCancellation?.();
    await pending;

    expect(outcome).toBeUndefined();
  });

  it("rejects an oversized declared body without awaiting its cancellation", async () => {
    let releaseCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const response = {
      headers: new Headers({ "content-length": "100" }),
      body: { cancel: vi.fn(() => cancellation) },
    } as unknown as Response;

    const pending = readBoundedJson(response, 4, "Provider fixture").catch(
      (error: unknown) => error,
    );
    const outcome = await settleOrMarker(pending);
    releaseCancellation?.();
    await pending;

    expect(outcome).toBeInstanceOf(SourceError);
    expect(outcome).toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("preserves the size error when reader cancel and release cleanup fail", async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(5),
      }),
      cancel: vi.fn(() => {
        throw new Error("cancel-cleanup-secret");
      }),
      releaseLock: vi.fn(() => {
        throw new Error("release-cleanup-secret");
      }),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    const error = await readBoundedJson(response, 4, "Provider fixture").catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect((error as Error).message).not.toContain("cleanup-secret");
  });

  it("preserves the size error when reader cancellation rejects asynchronously", async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(5),
      }),
      cancel: vi.fn().mockRejectedValue(new Error("async-cancel-secret")),
      releaseLock: vi.fn(),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    const error = await readBoundedJson(response, 4, "Provider fixture").catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect((error as Error).message).not.toContain("async-cancel-secret");
  });

  it("preserves the size error when an injected release rejects asynchronously", async () => {
    let releaseObserved = false;
    const reader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(5),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(() => ({
        then(
          _resolve: (value: unknown) => void,
          reject: (error: unknown) => void,
        ) {
          releaseObserved = true;
          reject(new Error("async-release-secret"));
        },
      })),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;

    const error = await readBoundedJson(response, 4, "Provider fixture").catch(
      (value: unknown) => value,
    );
    await Promise.resolve();

    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    expect((error as Error).message).not.toContain("async-release-secret");
    expect(releaseObserved).toBe(true);
  });
});
