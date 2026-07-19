import { afterEach, describe, expect, it, vi } from "vitest";
import { BlobObjectNotFoundError } from "../../storage/types.ts";
import {
  assertKeyInProjectScope,
  blobStoreDownloadSigner,
  buildSignRequest,
  createSupabaseDownloadSigner,
  DEFAULT_SUPABASE_SIGN_TIMEOUT_MS,
  EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  InvalidDownloadUrlTtlError,
  mintExportObjectKey,
  ObjectOutOfProjectScopeError,
  resolveSignedUrl,
  SUPABASE_SIGN_RESPONSE_MAX_BYTES,
  SupabaseSignError,
  type SupabaseSignerConfig,
} from "../supabase-signer.ts";

/**
 * AC-039 unit tests. No live Supabase: `fetch` is injected as a fake that captures
 * the request or asserts it is never called, so nothing here does a network
 * round-trip. Covers (a) TTL is exactly 900s in the sign call, (b) an out-of-scope
 * key is rejected before signing, (c) regenerate mints a fresh distinct key.
 */

const BASE_CONFIG: Omit<SupabaseSignerConfig, "fetch"> = {
  supabaseUrl: "https://proj.supabase.co",
  serviceRoleKey: "svc-role-key",
  bucket: "exports",
  projectId: "p1",
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
          `sign-body-secret-${"x".repeat(SUPABASE_SIGN_RESPONSE_MAX_BYTES)}`,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("createSupabaseDownloadSigner", () => {
  it("uses a finite default request timeout", () => {
    expect(DEFAULT_SUPABASE_SIGN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_SUPABASE_SIGN_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("rejects attempts to disable the signer timeout", () => {
    expect(() =>
      createSupabaseDownloadSigner({
        ...BASE_CONFIG,
        requestTimeoutMs: 0,
      }),
    ).toThrow(SupabaseSignError);
  });

  it("(a) signs with an exactly 900s TTL and returns the absolute signed URL", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    let capturedAuth: string | undefined;
    let capturedSignal: AbortSignal | undefined;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      capturedAuth =
        new Headers(init?.headers).get("authorization") ?? undefined;
      capturedSignal = init?.signal ?? undefined;
      return jsonResponse({
        signedURL: "/object/sign/exports/export/p1/r1/n1?token=tok",
      });
    };
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    const url = await signer.signDownloadUrl("export/p1/r1/n1", {
      expiresInSeconds: 900,
    });

    expect(capturedBody).toEqual({ expiresIn: 900 });
    expect(capturedUrl).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1",
    );
    expect(capturedAuth).toBe("Bearer svc-role-key");
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1?token=tok",
    );
  });

  it("maps a hanging sign request to a stable timeout without leaking secrets", async () => {
    vi.useFakeTimers();
    const fetch: typeof globalThis.fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("missing sign signal");
        const rejectAbort = () => reject(signal.reason);
        if (signal.aborted) rejectAbort();
        else signal.addEventListener("abort", rejectAbort, { once: true });
      });
    const signer = createSupabaseDownloadSigner({
      ...BASE_CONFIG,
      fetch,
      requestTimeoutMs: 25,
    });

    const pending = signer.signDownloadUrl("export/p1/r1/sign-key-secret", {
      expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "SupabaseSignError",
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    await expect(pending).rejects.not.toThrow(
      /sign-key-secret|svc-role-key/,
    );
  });

  it("composes a caller signal with the signer timeout and sanitizes its reason", async () => {
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
    const signer = createSupabaseDownloadSigner({
      ...BASE_CONFIG,
      fetch,
      signal: caller.signal,
      requestTimeoutMs: 60_000,
    });

    const pending = signer.signDownloadUrl("export/p1/r1/caller-key-secret", {
      expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    });
    caller.abort(new Error("caller-reason-secret"));

    await expect(pending).rejects.toMatchObject({
      name: "SupabaseSignError",
      status: undefined,
    });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received).not.toBe(caller.signal);
    expect(received?.aborted).toBe(true);
    await expect(pending).rejects.not.toThrow(
      /caller-reason-secret|caller-key-secret|svc-role-key/,
    );
  });

  it("times out and cancels a sign JSON body that hangs after response headers", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetch: typeof globalThis.fetch = async () =>
      new Response(body, { status: 200 });
    const signer = createSupabaseDownloadSigner({
      ...BASE_CONFIG,
      fetch,
      requestTimeoutMs: 25,
    });

    const pending = signer.signDownloadUrl("export/p1/r1/hanging-body", {
      expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "SupabaseSignError",
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(cancelled).toBe(true);
  });

  it("bounds and cancels an oversized non-success response body", async () => {
    const oversized = oversizedResponse(503);
    const fetch: typeof globalThis.fetch = async () => oversized.response;
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    const pending = signer.signDownloadUrl("export/p1/r1/error-key-secret", {
      expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    });
    await expect(pending).rejects.toMatchObject({
      name: "SupabaseSignError",
      status: 503,
    });
    expect(oversized.wasCancelled()).toBe(true);
    await expect(pending).rejects.not.toThrow(
      /sign-body-secret|error-key-secret|svc-role-key/,
    );
  });

  it.each([408, 429, 503])(
    "does not downgrade transient HTTP %i from a contradictory missing-object body",
    async (status) => {
      const fetch: typeof globalThis.fetch = async () =>
        jsonResponse(
          { error: "not_found", message: "Object not found" },
          status,
        );
      const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

      const pending = signer.signDownloadUrl("export/p1/r1/transient", {
        expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
      });
      await expect(pending).rejects.toMatchObject({
        name: "SupabaseSignError",
        status,
      });
      await expect(pending).rejects.not.toBeInstanceOf(
        BlobObjectNotFoundError,
      );
    },
  );

  it("bounds and cancels oversized successful sign JSON", async () => {
    const oversized = oversizedResponse(200);
    const fetch: typeof globalThis.fetch = async () => oversized.response;
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    const pending = signer.signDownloadUrl("export/p1/r1/json-key-secret", {
      expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    });
    await expect(pending).rejects.toBeInstanceOf(SupabaseSignError);
    expect(oversized.wasCancelled()).toBe(true);
    await expect(pending).rejects.not.toThrow(
      /sign-body-secret|json-key-secret|svc-role-key/,
    );
  });

  it("does not copy a fetch failure message containing secrets into SupabaseSignError", async () => {
    const fetch: typeof globalThis.fetch = async () => {
      throw new Error(
        "network exposed svc-role-key export/p1/r1/key-secret body-secret",
      );
    };
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    const pending = signer.signDownloadUrl("export/p1/r1/key-secret", {
      expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
    });
    await expect(pending).rejects.toBeInstanceOf(SupabaseSignError);
    await expect(pending).rejects.not.toThrow(
      /svc-role-key|key-secret|body-secret/,
    );
  });

  it("(b) rejects an out-of-project key BEFORE any network call", async () => {
    let called = false;
    const fetch: typeof globalThis.fetch = async () => {
      called = true;
      return jsonResponse({ signedURL: "/x" });
    };
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    await expect(
      signer.signDownloadUrl("export/OTHER/r1/n1", { expiresInSeconds: 900 }),
    ).rejects.toBeInstanceOf(ObjectOutOfProjectScopeError);
    expect(called).toBe(false);
  });

  it("rejects a non-export key before it can be signed from the export bucket", async () => {
    let called = false;
    const fetch: typeof globalThis.fetch = async () => {
      called = true;
      return jsonResponse({ signedURL: "/x" });
    };
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    await expect(
      signer.signDownloadUrl("snapshot-raw/p1/r1/n1", {
        expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
      }),
    ).rejects.toBeInstanceOf(ObjectOutOfProjectScopeError);
    expect(called).toBe(false);
  });

  it("only signs into its configured bucket (bucket scope)", async () => {
    let capturedUrl: string | undefined;
    const fetch: typeof globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return jsonResponse({
        signedURL: "/object/sign/exports/export/p1/r1/n1?token=t",
      });
    };
    const signer = createSupabaseDownloadSigner({
      ...BASE_CONFIG,
      bucket: "exports",
      fetch,
    });
    await signer.signDownloadUrl("export/p1/r1/n1", { expiresInSeconds: 900 });
    expect(capturedUrl).toContain("/object/sign/exports/");
  });

  it("maps a non-2xx Supabase response to SupabaseSignError", async () => {
    const fetch: typeof globalThis.fetch = async () => jsonResponse({}, 403);
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });
    await expect(
      signer.signDownloadUrl("export/p1/r1/n1", { expiresInSeconds: 900 }),
    ).rejects.toBeInstanceOf(SupabaseSignError);
  });

  it("throws SupabaseSignError when the body has no signedURL", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      jsonResponse({ nope: true });
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });
    await expect(
      signer.signDownloadUrl("export/p1/r1/n1", { expiresInSeconds: 900 }),
    ).rejects.toBeInstanceOf(SupabaseSignError);
  });

  it("maps an absent object to BlobObjectNotFoundError, not a generic sign failure", async () => {
    const fetch: typeof globalThis.fetch = async () =>
      jsonResponse({ error: "not_found", message: "Object not found" }, 404);
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    await expect(
      signer.signDownloadUrl("export/p1/r1/missing", {
        expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS,
      }),
    ).rejects.toBeInstanceOf(BlobObjectNotFoundError);
  });

  it("fails closed when a caller requests anything other than the fixed 900s TTL", async () => {
    let called = false;
    const fetch: typeof globalThis.fetch = async () => {
      called = true;
      return jsonResponse({ signedURL: "/x" });
    };
    const signer = createSupabaseDownloadSigner({ ...BASE_CONFIG, fetch });

    await expect(
      signer.signDownloadUrl("export/p1/r1/n1", { expiresInSeconds: 60 }),
    ).rejects.toBeInstanceOf(InvalidDownloadUrlTtlError);
    expect(called).toBe(false);
  });
});

describe("mintExportObjectKey (regenerate)", () => {
  it("(c) mints a fresh, distinct, in-scope key on each regenerate", () => {
    const a = mintExportObjectKey({ projectId: "p1", runId: "r1" });
    const b = mintExportObjectKey({ projectId: "p1", runId: "r1" });

    expect(a).not.toBe(b);
    expect(a.startsWith("export/p1/r1/")).toBe(true);
    expect(b.startsWith("export/p1/r1/")).toBe(true);
    // Both are in-scope for their own project, neither for another.
    expect(() => assertKeyInProjectScope(a, "p1")).not.toThrow();
    expect(() => assertKeyInProjectScope(b, "p1")).not.toThrow();
    expect(() => assertKeyInProjectScope(a, "p2")).toThrow(
      ObjectOutOfProjectScopeError,
    );
  });
});

describe("assertKeyInProjectScope", () => {
  it("accepts a matching-project key and rejects wrong-project / malformed keys", () => {
    expect(() =>
      assertKeyInProjectScope("export/p1/r1/n1", "p1"),
    ).not.toThrow();
    expect(() => assertKeyInProjectScope("export/p2/r1/n1", "p1")).toThrow(
      ObjectOutOfProjectScopeError,
    );
    // Malformed (wrong segment count) is treated as out-of-scope, never signable.
    expect(() => assertKeyInProjectScope("export/p1/n1", "p1")).toThrow(
      ObjectOutOfProjectScopeError,
    );
    expect(() => assertKeyInProjectScope("", "p1")).toThrow(
      ObjectOutOfProjectScopeError,
    );
  });

  it("rejects dot-segment keys that would normalize out of the bucket at fetch time", () => {
    // `../p1/r1/n1` has 4 segments and a matching projectId at index 1, but the
    // URL parser normalizes `sign/exports/../p1/...` down to `sign/p1/...`,
    // signing a different bucket. The dot-segment guard must reject it up front.
    expect(() => assertKeyInProjectScope("../p1/r1/n1", "p1")).toThrow(
      ObjectOutOfProjectScopeError,
    );
    expect(() => assertKeyInProjectScope("export/p1/../n1", "p1")).toThrow(
      ObjectOutOfProjectScopeError,
    );
    expect(() => assertKeyInProjectScope("export//r1/n1", "")).toThrow(
      ObjectOutOfProjectScopeError,
    );
  });
});

describe("buildSignRequest (pure)", () => {
  it("targets the sign endpoint with the service-role bearer and expiresIn body", () => {
    const req = buildSignRequest(BASE_CONFIG, "export/p1/r1/n1", 900);
    expect(req.url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1",
    );
    expect(req.init.method).toBe("POST");
    expect(JSON.parse(String(req.init.body))).toEqual({ expiresIn: 900 });
  });

  it("tolerates a trailing slash on supabaseUrl", () => {
    const req = buildSignRequest(
      { ...BASE_CONFIG, supabaseUrl: "https://proj.supabase.co/" },
      "export/p1/r1/n1",
      900,
    );
    expect(req.url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1",
    );
  });

  it("encodes a malformed bucket value instead of allowing path escape", () => {
    const req = buildSignRequest(
      { ...BASE_CONFIG, bucket: "exports/../other" },
      "export/p1/r1/n1",
      900,
    );
    expect(req.url).toContain("/object/sign/exports%2F..%2Fother/export/");
  });
});

describe("resolveSignedUrl (pure)", () => {
  it("prefixes the relative signedURL with the storage base", () => {
    expect(
      resolveSignedUrl("https://proj.supabase.co", {
        signedURL: "/object/sign/exports/export/p1/r1/n1?token=t",
      }),
    ).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1?token=t",
    );
  });

  it("throws when signedURL is absent", () => {
    expect(() => resolveSignedUrl("https://proj.supabase.co", {})).toThrow(
      SupabaseSignError,
    );
  });
});

describe("blobStoreDownloadSigner (dev seam)", () => {
  it("delegates to store.signedUrl with the explicit TTL and enforces scope", async () => {
    const calls: Array<{ key: string; ttl: number }> = [];
    const store = {
      async signedUrl(key: string, ttlSeconds: number): Promise<string> {
        calls.push({ key, ttl: ttlSeconds });
        return `memory://${key}?ttl=${ttlSeconds}`;
      },
    };
    const signer = blobStoreDownloadSigner(store, "p1");

    const url = await signer.signDownloadUrl("export/p1/r1/n1", {
      expiresInSeconds: 900,
    });
    expect(url).toBe("memory://export/p1/r1/n1?ttl=900");
    expect(calls).toEqual([{ key: "export/p1/r1/n1", ttl: 900 }]);

    await expect(
      signer.signDownloadUrl("export/p2/r1/n1", { expiresInSeconds: 900 }),
    ).rejects.toBeInstanceOf(ObjectOutOfProjectScopeError);
    expect(calls).toHaveLength(1); // out-of-scope key never reached the store
  });

  it("enforces the same fixed 900s TTL before reaching the local store", async () => {
    let called = false;
    const signer = blobStoreDownloadSigner(
      {
        async signedUrl(): Promise<string> {
          called = true;
          return "memory://unexpected";
        },
      },
      "p1",
    );

    await expect(
      signer.signDownloadUrl("export/p1/r1/n1", { expiresInSeconds: 901 }),
    ).rejects.toBeInstanceOf(InvalidDownloadUrlTtlError);
    expect(called).toBe(false);
  });
});
