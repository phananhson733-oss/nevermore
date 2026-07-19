import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BlobStoreConfigurationError,
  LocalFsBlobStore,
  ObjectOutOfProjectScopeError,
  SupabaseBlobStore,
} from "@sf/sources";
import {
  createWebBlobStore,
  createWebExportDownloadSigner,
} from "./storage.ts";

const ENV = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  RAW_IMPORT_BUCKET: "shared-raw",
  EXPORT_BUCKET: "shared-exports",
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("web blob storage wiring", () => {
  it("constructs the hosted Supabase store from the shared raw/export bucket env", async () => {
    let captured = "";
    const fetch: typeof globalThis.fetch = async (url) => {
      captured = String(url);
      return jsonResponse({ Key: "shared-raw/raw-import/p1/r1/n1" });
    };
    const store = createWebBlobStore(ENV, {
      environment: "production",
      fetch,
    });
    expect(store).toBeInstanceOf(SupabaseBlobStore);

    await store.put({
      key: "raw-import/p1/r1/n1",
      body: Buffer.from("raw"),
      contentType: "text/csv",
    });
    expect(captured).toContain(
      "/storage/v1/object/shared-raw/raw-import/p1/r1/n1",
    );
  });

  it("uses the hosted export bucket for a project-scoped 900s signed URL", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        signedURL: "/object/sign/shared-exports/export/p1/r1/n1?token=t",
      });
    };
    const signer = createWebExportDownloadSigner(ENV, "p1", {
      environment: "production",
      fetch,
    });

    await signer.signDownloadUrl("export/p1/r1/n1", {
      expiresInSeconds: 900,
    });
    expect(calls[0]!.url).toContain(
      "/storage/v1/object/sign/shared-exports/export/p1/r1/n1",
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ expiresIn: 900 });

    await expect(
      signer.signDownloadUrl("export/p2/r1/n1", { expiresInSeconds: 900 }),
    ).rejects.toBeInstanceOf(ObjectOutOfProjectScopeError);
    expect(calls).toHaveLength(1);
  });

  it("requires an explicit local path instead of deriving one from web cwd", async () => {
    expect(() =>
      createWebBlobStore(ENV, { environment: "test" }),
    ).toThrow(BlobStoreConfigurationError);

    const dir = await mkdtemp(join(tmpdir(), "sf-web-blob-"));
    directories.push(dir);
    expect(
      createWebBlobStore({ ...ENV, SF_BLOB_DIR: dir }, { environment: "test" }),
    ).toBeInstanceOf(LocalFsBlobStore);
  });

  it("uses the same explicit local path for the web store and its export signer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-web-signer-"));
    directories.push(dir);
    const localEnv = { ...ENV, SF_BLOB_DIR: dir };
    const store = createWebBlobStore(localEnv, { environment: "test" });
    await store.put({
      key: "export/p1/r1/n1",
      body: Buffer.from("zip"),
      contentType: "application/zip",
    });

    const signer = createWebExportDownloadSigner(localEnv, "p1", {
      environment: "test",
    });
    const url = await signer.signDownloadUrl("export/p1/r1/n1", {
      expiresInSeconds: 900,
    });
    expect(url).toMatch(/^file:/);
    expect(url).toContain("expires=");
  });
});
