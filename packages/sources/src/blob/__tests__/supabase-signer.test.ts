import { describe, expect, it } from "vitest";
import {
  assertKeyInProjectScope,
  blobStoreDownloadSigner,
  buildSignRequest,
  createSupabaseDownloadSigner,
  mintExportObjectKey,
  ObjectOutOfProjectScopeError,
  resolveSignedUrl,
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

describe("createSupabaseDownloadSigner", () => {
  it("(a) signs with an exactly 900s TTL and returns the absolute signed URL", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    let capturedAuth: string | undefined;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      capturedAuth =
        new Headers(init?.headers).get("authorization") ?? undefined;
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
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/sign/exports/export/p1/r1/n1?token=tok",
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
});
