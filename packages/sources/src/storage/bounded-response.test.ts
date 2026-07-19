import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResponseBodyTooLargeError,
  cancelResponseBody,
  createRequestAbortScope,
  readBoundedResponseBytes,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "./bounded-response.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRequestAbortScope", () => {
  it("propagates an already-aborted caller signal", () => {
    const caller = new AbortController();
    caller.abort("caller-stop");

    const scope = createRequestAbortScope(1_000, [null, caller.signal]);
    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBe("caller-stop");
    expect(scope.timedOut()).toBe(false);
    scope.dispose();
  });

  it("marks its own timeout and disposal prevents a late timeout", async () => {
    vi.useFakeTimers();
    const timedOut = createRequestAbortScope(25);
    await vi.advanceTimersByTimeAsync(25);
    expect(timedOut.signal.aborted).toBe(true);
    expect(timedOut.signal.reason).toMatchObject({ name: "TimeoutError" });
    expect(timedOut.timedOut()).toBe(true);
    timedOut.dispose();

    const disposed = createRequestAbortScope(25);
    disposed.dispose();
    await vi.advanceTimersByTimeAsync(25);
    expect(disposed.signal.aborted).toBe(false);
  });

  it("propagates a later caller abort and disposes its listener", () => {
    const caller = new AbortController();
    const scope = createRequestAbortScope(1_000, [caller.signal]);

    caller.abort("caller-stop-later");

    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBe("caller-stop-later");
    expect(scope.timedOut()).toBe(false);
    scope.dispose();
  });
});

describe("bounded response decoding", () => {
  it("rejects Content-Length above the cap before reading and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      headers: { "content-length": "10" },
    });

    const pending = readBoundedResponseBytes(response, 4);
    await expect(pending).rejects.toMatchObject({
      name: "ResponseBodyTooLargeError",
      limitBytes: 4,
    });
    expect(cancelled).toBe(true);
  });

  it("handles an absent body and ignores empty chunks", async () => {
    await expect(
      readBoundedResponseBytes(new Response(null), 4),
    ).resolves.toEqual(new Uint8Array());

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array());
        controller.enqueue(new TextEncoder().encode("ok"));
        controller.close();
      },
    });
    await expect(
      readBoundedResponseText(new Response(stream), 4),
    ).resolves.toBe("ok");
  });

  it("decodes bounded JSON and preserves parse failures", async () => {
    await expect(
      readBoundedResponseJson(new Response('{"ok":true}'), 32),
    ).resolves.toEqual({ ok: true });
    await expect(
      readBoundedResponseJson(new Response("not-json"), 32),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it("cancels a stream that errors while being read", async () => {
    const failure = new Error("stream failed");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(
      readBoundedResponseBytes(new Response(stream), 32),
    ).rejects.toBe(failure);
  });

  it("settles reads through an active signal and rejects when it aborts", async () => {
    const active = new AbortController();
    await expect(
      readBoundedResponseText(new Response("ok"), 4, active.signal),
    ).resolves.toBe("ok");

    const aborting = new AbortController();
    const hanging = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Deliberately leave the body open so only the signal can settle it.
        },
      }),
    );
    const pending = readBoundedResponseBytes(hanging, 4, aborting.signal);
    aborting.abort("body-stop");

    await expect(pending).rejects.toBe("body-stop");
  });

  it("preserves a reader rejection while a signal is active", async () => {
    const failure = new Error("reader failed");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });

    await expect(
      readBoundedResponseBytes(
        new Response(stream),
        32,
        new AbortController().signal,
      ),
    ).rejects.toBe(failure);
  });

  it("keeps stable failures when a reader cannot be cancelled", async () => {
    const oversizedReader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(5),
      }),
      cancel: vi.fn().mockRejectedValue(new Error("cancel rejected")),
      releaseLock: vi.fn(),
    };
    const oversizedResponse = {
      headers: { get: () => null },
      body: { getReader: () => oversizedReader },
    } as unknown as Response;

    await expect(
      readBoundedResponseBytes(oversizedResponse, 4),
    ).rejects.toBeInstanceOf(ResponseBodyTooLargeError);

    const readFailure = new Error("original reader failure");
    const failingReader = {
      read: vi.fn().mockRejectedValue(readFailure),
      cancel: vi.fn(() => {
        throw new Error("cancel threw");
      }),
      releaseLock: vi.fn(),
    };
    const failingResponse = {
      headers: { get: () => null },
      body: { getReader: () => failingReader },
    } as unknown as Response;

    await expect(
      readBoundedResponseBytes(
        failingResponse,
        4,
        new AbortController().signal,
      ),
    ).rejects.toBe(readFailure);
  });

  it("uses a stable AbortError when an injected signal has no reason", async () => {
    const signal = {
      aborted: true,
      reason: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onabort: null,
      throwIfAborted: vi.fn(),
    } as unknown as AbortSignal;

    await expect(
      readBoundedResponseBytes(new Response("x"), 4, signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("best-effort cancellation tolerates a response without a body", async () => {
    await expect(cancelResponseBody(new Response(null))).resolves.toBeUndefined();
    expect(new ResponseBodyTooLargeError(7).limitBytes).toBe(7);
  });

  it("best-effort cancellation ignores sync throws and async rejections", async () => {
    const throwing = {
      body: {
        cancel: () => {
          throw new Error("cancel threw");
        },
      },
    } as unknown as Response;
    const rejecting = {
      body: {
        cancel: () => Promise.reject(new Error("cancel rejected")),
      },
    } as unknown as Response;

    await expect(cancelResponseBody(throwing)).resolves.toBeUndefined();
    await expect(cancelResponseBody(rejecting)).resolves.toBeUndefined();
  });
});
