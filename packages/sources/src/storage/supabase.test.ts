import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  BlobStoreConfigurationError,
  InvalidBlobObjectKeyError,
  SupabaseBlobStore,
  SupabaseStorageError,
  type SupabaseBlobStoreConfig,
} from "../index.ts";
import {
  DEFAULT_SUPABASE_DOWNLOAD_MAX_BYTES,
  DEFAULT_SUPABASE_STORAGE_TIMEOUT_MS,
  SUPABASE_LIST_RESPONSE_MAX_BYTES,
  SUPABASE_METADATA_RESPONSE_MAX_BYTES,
} from "./supabase.ts";

const BASE: Omit<SupabaseBlobStoreConfig, "fetch"> = {
  supabaseUrl: "https://proj.supabase.co/",
  serviceRoleKey: "service-role-secret",
  rawBucket: "raw-imports",
  exportBucket: "exports",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function oversizedResponse(status: number): {
  readonly response: Response;
  readonly wasCancelled: () => boolean;
} {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `body-secret-${"x".repeat(SUPABASE_METADATA_RESPONSE_MAX_BYTES)}`,
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { status }),
    wasCancelled: () => cancelled,
  };
}

async function runStorageOperation(
  store: SupabaseBlobStore,
  operation: "put" | "get" | "sign" | "delete" | "list",
): Promise<unknown> {
  switch (operation) {
    case "put":
      return store.put({
        key: "export/p1/r1/timeout-key",
        body: Buffer.from("request-body-secret"),
        contentType: "application/zip",
      });
    case "get":
      return store.get("export/p1/r1/timeout-key");
    case "sign":
      return store.signedUrl("export/p1/r1/timeout-key", 900);
    case "delete":
      return store.delete("export/p1/r1/timeout-key");
    case "list":
      return store.list({ kind: "export", cursor: null, limit: 100 });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SupabaseBlobStore", () => {
  it("defines finite product defaults for request time and decoded downloads", () => {
    expect(DEFAULT_SUPABASE_STORAGE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_SUPABASE_STORAGE_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
    expect(DEFAULT_SUPABASE_DOWNLOAD_MAX_BYTES).toBeGreaterThanOrEqual(
      20 * 1024 * 1024,
    );
    expect(DEFAULT_SUPABASE_DOWNLOAD_MAX_BYTES).toBeLessThanOrEqual(
      128 * 1024 * 1024,
    );
  });

  it("attaches a live timeout signal to every put/get/sign/delete/list fetch by default", async () => {
    const signals: AbortSignal[] = [];
    const responses = [
      jsonResponse({ Key: "exports/export/p1/r1/n1" }),
      new Response("download"),
      jsonResponse({
        signedURL: "/object/sign/exports/export/p1/r1/n1?token=tok",
      }),
      jsonResponse([]),
      jsonResponse({ hasNext: false, folders: [], objects: [] }),
    ];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      signals.push(init!.signal!);
      return responses.shift()!;
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await store.put({
      key: "export/p1/r1/n1",
      body: Buffer.from("zip"),
      contentType: "application/zip",
    });
    await store.get("export/p1/r1/n1");
    await store.signedUrl("export/p1/r1/n1", 900);
    await store.delete("export/p1/r1/n1");
    await store.list({ kind: "export", cursor: null, limit: 100 });

    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it.each(["put", "get", "sign", "delete", "list"] as const)(
    "maps a hanging %s request to a stable, body-safe SupabaseStorageError",
    async (operation) => {
      vi.useFakeTimers();
      const fetch: typeof globalThis.fetch = async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("missing operation signal");
          const rejectAbort = () => reject(signal.reason);
          if (signal.aborted) rejectAbort();
          else signal.addEventListener("abort", rejectAbort, { once: true });
        });
      const store = new SupabaseBlobStore({
        ...BASE,
        fetch,
        requestTimeoutMs: 25,
      });

      const pending = runStorageOperation(store, operation);
      const assertion = expect(pending).rejects.toMatchObject({
        name: "SupabaseStorageError",
        operation,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      await expect(pending).rejects.not.toThrow(
        /request-body-secret|timeout-key|service-role-secret/,
      );
    },
  );

  it("composes a caller AbortSignal with the internal timeout without leaking its reason", async () => {
    const caller = new AbortController();
    let received: AbortSignal | undefined;
    const fetch: typeof globalThis.fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        received = init?.signal ?? undefined;
        if (!received) throw new Error("missing composed signal");
        received.addEventListener("abort", () => reject(received!.reason), {
          once: true,
        });
      });
    const store = new SupabaseBlobStore({
      ...BASE,
      fetch,
      signal: caller.signal,
      requestTimeoutMs: 60_000,
    });

    const pending = store.get("export/p1/r1/caller-key-secret");
    caller.abort(new Error("caller-reason-secret"));

    await expect(pending).rejects.toMatchObject({
      name: "SupabaseStorageError",
      operation: "get",
      status: undefined,
    });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received).not.toBe(caller.signal);
    expect(received?.aborted).toBe(true);
    await expect(pending).rejects.not.toThrow(
      /caller-reason-secret|caller-key-secret|service-role-secret/,
    );
  });

  it("times out and cancels a decoded download body that hangs after response headers", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetch: typeof globalThis.fetch = async () =>
      new Response(body, { status: 200 });
    const store = new SupabaseBlobStore({
      ...BASE,
      fetch,
      requestTimeoutMs: 25,
    });

    const pending = store.get("export/p1/r1/hanging-body-key");
    const assertion = expect(pending).rejects.toMatchObject({
      name: "SupabaseStorageError",
      operation: "get",
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(cancelled).toBe(true);
  });

  it.each(["put", "get", "sign", "delete", "list"] as const)(
    "bounds and cancels an oversized non-success body for %s",
    async (operation) => {
      const oversized = oversizedResponse(503);
      const fetch: typeof globalThis.fetch = async () => oversized.response;
      const store = new SupabaseBlobStore({ ...BASE, fetch });

      const pending = runStorageOperation(store, operation);
      await expect(pending).rejects.toMatchObject({
        name: "SupabaseStorageError",
        operation,
        status: 503,
      });
      expect(oversized.wasCancelled()).toBe(true);
      await expect(pending).rejects.not.toThrow(
        /body-secret|timeout-key|service-role-secret/,
      );
    },
  );

  it.each([
    [408, "put"],
    [408, "get"],
    [408, "sign"],
    [408, "delete"],
    [429, "put"],
    [429, "get"],
    [429, "sign"],
    [429, "delete"],
    [503, "put"],
    [503, "get"],
    [503, "sign"],
    [503, "delete"],
    [408, "list"],
    [429, "list"],
    [503, "list"],
  ] as const)(
    "does not downgrade transient HTTP %i for %s from a contradictory body",
    async (status, operation) => {
      const fetch: typeof globalThis.fetch = async () =>
        jsonResponse(
          {
            error: "not_found",
            message: "Object not found; duplicate already exists",
          },
          status,
        );
      const store = new SupabaseBlobStore({ ...BASE, fetch });

      await expect(
        runStorageOperation(store, operation),
      ).rejects.toMatchObject({
        name: "SupabaseStorageError",
        operation,
        status,
      });
    },
  );

  it("bounds and cancels an oversized successful sign JSON body", async () => {
    const oversized = oversizedResponse(200);
    const fetch: typeof globalThis.fetch = async () => oversized.response;
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    const pending = store.signedUrl("export/p1/r1/sign-key-secret", 900);
    await expect(pending).rejects.toMatchObject({
      name: "SupabaseStorageError",
      operation: "sign",
    });
    expect(oversized.wasCancelled()).toBe(true);
    await expect(pending).rejects.not.toThrow(
      /body-secret|sign-key-secret|service-role-secret/,
    );
  });

  it("enforces the configured decoded download cap and cancels the body stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch: typeof globalThis.fetch = async () =>
      new Response(body, { status: 200 });
    const store = new SupabaseBlobStore({
      ...BASE,
      fetch,
      maxDownloadBytes: 4,
    });

    const pending = store.get("export/p1/r1/download-key-secret");
    await expect(pending).rejects.toMatchObject({
      name: "SupabaseStorageError",
      operation: "get",
    });
    expect(cancelled).toBe(true);
    await expect(pending).rejects.not.toThrow(
      /12345|download-key-secret|service-role-secret/,
    );
  });

  it(
    "does not wait forever when an oversized body's cancellation never settles",
    async () => {
      let cancelCalled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12345"));
        },
        cancel() {
          cancelCalled = true;
          return new Promise<void>(() => undefined);
        },
      });
      const fetch: typeof globalThis.fetch = async () =>
        new Response(body, { status: 200 });
      const store = new SupabaseBlobStore({
        ...BASE,
        fetch,
        maxDownloadBytes: 4,
      });

      await expect(
        store.get("export/p1/r1/stalled-cancel"),
      ).rejects.toBeInstanceOf(SupabaseStorageError);
      expect(cancelCalled).toBe(true);
    },
    500,
  );

  it("fails fast on unsafe bucket configuration", () => {
    expect(
      () => new SupabaseBlobStore({ ...BASE, exportBucket: "exports/../public" }),
    ).toThrow(BlobStoreConfigurationError);
  });

  it("rejects attempts to disable the timeout or decoded download cap", () => {
    expect(
      () => new SupabaseBlobStore({ ...BASE, requestTimeoutMs: 0 }),
    ).toThrow(BlobStoreConfigurationError);
    expect(
      () => new SupabaseBlobStore({ ...BASE, maxDownloadBytes: 0 }),
    ).toThrow(BlobStoreConfigurationError);
  });

  it("uploads raw bytes append-only to the private raw bucket", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ Key: "raw-imports/raw-import/p1/r1/n1" });
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });
    const body = Buffer.from("keyword,volume\nfoo,10\n");

    const put = await store.put({
      key: "raw-import/p1/r1/n1",
      body,
      contentType: "text/csv",
    });

    expect(put).toEqual({
      key: "raw-import/p1/r1/n1",
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.length,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://proj.supabase.co/storage/v1/object/raw-imports/raw-import/p1/r1/n1",
    );
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer service-role-secret");
    expect(headers.get("apikey")).toBe("service-role-secret");
    expect(headers.get("x-upsert")).toBe("false");
    expect(headers.get("content-type")).toBe("text/csv");
    expect(Buffer.from(calls[0]!.init?.body as Uint8Array).equals(body)).toBe(true);
  });

  it("routes export keys to the private export bucket", async () => {
    let capturedUrl = "";
    const fetch: typeof globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ Key: "exports/export/p1/r1/n1" });
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await store.put({
      key: "export/p1/r1/n1",
      body: Buffer.from("zip"),
      contentType: "application/zip",
    });

    expect(capturedUrl).toContain("/storage/v1/object/exports/export/p1/r1/n1");
  });

  it("lists one fixed private prefix through list-v2 with opaque cursor pagination", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        hasNext: true,
        folders: [],
        nextCursor: "opaque-next-cursor",
        objects: [
          {
            id: "object-1",
            name: "export/p1/r1/a.zip",
            key: "exports/export/p1/r1/a.zip",
            created_at: "2026-07-17T12:00:00.000Z",
            updated_at: "2026-07-17T12:00:00.000Z",
            last_accessed_at: "2026-07-17T12:00:00.000Z",
            metadata: null,
          },
        ],
      });
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await expect(
      store.list({ kind: "export", cursor: "opaque-cursor", limit: 100 }),
    ).resolves.toEqual({
      objects: [
        {
          key: "export/p1/r1/a.zip",
          createdAt: "2026-07-17T12:00:00.000Z",
        },
      ],
      nextCursor: "opaque-next-cursor",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://proj.supabase.co/storage/v1/object/list-v2/exports",
    );
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      prefix: "export/",
      cursor: "opaque-cursor",
      limit: 100,
      with_delimiter: false,
      sortBy: { column: "name", order: "asc" },
    });
  });

  it("fails closed on malformed list metadata and bounds successful list responses", async () => {
    const malformed = jsonResponse({
      hasNext: false,
      folders: [],
      objects: [
        {
          name: "raw/p1/r1/wrong-bucket",
          created_at: "not-a-timestamp",
        },
      ],
    });
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({
              hasNext: false,
              folders: [],
              objects: [],
              padding: "x".repeat(SUPABASE_LIST_RESPONSE_MAX_BYTES),
            }),
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const responses = [malformed, new Response(oversizedBody, { status: 200 })];
    const fetch: typeof globalThis.fetch = async () => responses.shift()!;
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await expect(
      store.list({ kind: "export", cursor: null, limit: 100 }),
    ).rejects.toMatchObject({ operation: "list" });
    await expect(
      store.list({ kind: "export", cursor: null, limit: 100 }),
    ).rejects.toMatchObject({ operation: "list" });
    expect(cancelled).toBe(true);
  });

  it("maps a duplicate upload to the append-only error", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      jsonResponse({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, 409);
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await expect(
      store.put({
        key: "export/p1/r1/n1",
        body: Buffer.from("replacement"),
        contentType: "application/zip",
      }),
    ).rejects.toBeInstanceOf(BlobObjectAlreadyExistsError);
  });

  it("downloads authenticated private bytes and returns null only for a missing object", async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (url) => {
      calls.push(String(url));
      return calls.length === 1
        ? new Response(Uint8Array.from(Buffer.from("raw bytes")), { status: 200 })
        : jsonResponse({ message: "Object not found" }, 404);
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    expect((await store.get("snapshot-raw/p1/r1/n1"))?.toString()).toBe("raw bytes");
    expect(await store.get("export/p1/r1/missing")).toBeNull();
    expect(calls[0]).toBe(
      "https://proj.supabase.co/storage/v1/object/raw-imports/snapshot-raw/p1/r1/n1",
    );
    expect(calls[1]).toBe(
      "https://proj.supabase.co/storage/v1/object/exports/export/p1/r1/missing",
    );
  });

  it("does not disguise a dependency failure as a missing object", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      jsonResponse({ message: "backend unavailable" }, 503);
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await expect(store.get("export/p1/r1/n1")).rejects.toBeInstanceOf(
      SupabaseStorageError,
    );
  });

  it("signs an existing object in its routed bucket and preserves the requested TTL", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        signedURL: "/object/sign/exports/export/p1/r1/n1?token=tok",
      });
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    const url = await store.signedUrl("export/p1/r1/n1", 900);

    expect(capturedUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1",
    );
    expect(capturedBody).toEqual({ expiresIn: 900 });
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1?token=tok",
    );
  });

  it("maps a missing signed object separately from a signing dependency failure", async () => {
    const responses = [
      jsonResponse({ error: "not_found", message: "Object not found" }, 404),
      jsonResponse({ message: "signing unavailable" }, 503),
    ];
    const fetch: typeof globalThis.fetch = async () => responses.shift()!;
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await expect(store.signedUrl("export/p1/r1/missing", 900)).rejects.toBeInstanceOf(
      BlobObjectNotFoundError,
    );
    await expect(store.signedUrl("export/p1/r1/broken", 900)).rejects.toBeInstanceOf(
      SupabaseStorageError,
    );
  });

  it("deletes through the routed private bucket endpoint and stays idempotent on 404", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1 ? jsonResponse([]) : jsonResponse({ message: "not found" }, 404);
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await store.delete("snapshot-raw/p1/r1/n1");
    await expect(store.delete("export/p1/r1/missing")).resolves.toBeUndefined();
    expect(calls[0]!.url).toBe(
      "https://proj.supabase.co/storage/v1/object/raw-imports",
    );
    expect(calls[0]!.init?.method).toBe("DELETE");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      prefixes: ["snapshot-raw/p1/r1/n1"],
    });
    expect(calls[1]!.url).toBe(
      "https://proj.supabase.co/storage/v1/object/exports",
    );
  });

  it("rejects malformed or unsupported keys before any network request", async () => {
    let called = false;
    const fetch: typeof globalThis.fetch = async () => {
      called = true;
      return jsonResponse({});
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    await expect(store.get("../p1/r1/n1")).rejects.toBeInstanceOf(
      InvalidBlobObjectKeyError,
    );
    await expect(store.get("other/p1/r1/n1")).rejects.toBeInstanceOf(
      InvalidBlobObjectKeyError,
    );
    expect(called).toBe(false);
  });

  it("wraps fetch failures without leaking the service-role key", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new Error("socket closed");
    };
    const store = new SupabaseBlobStore({ ...BASE, fetch });

    const rejection = store.get("export/p1/r1/n1");
    await expect(rejection).rejects.toBeInstanceOf(SupabaseStorageError);
    await expect(rejection).rejects.not.toThrow(/service-role-secret/);
  });
});
