import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BlobStoreConfigurationError,
  createRuntimeBlobStore,
  LocalFsBlobStore,
  SupabaseBlobStore,
} from "../index.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REMOTE = {
  supabaseUrl: "https://proj.supabase.co",
  serviceRoleKey: "service-role",
  rawBucket: "raw-imports",
  exportBucket: "exports",
};

describe("createRuntimeBlobStore", () => {
  it("uses Supabase in production and refuses a local override", () => {
    expect(
      createRuntimeBlobStore({ environment: "production", supabase: REMOTE }),
    ).toBeInstanceOf(SupabaseBlobStore);
    expect(() =>
      createRuntimeBlobStore({
        environment: "production",
        backend: "local",
        localDirectory: "/tmp/should-not-be-used",
        supabase: REMOTE,
      }),
    ).toThrow(BlobStoreConfigurationError);
  });

  it("requires an explicit absolute shared directory in local/test mode", () => {
    expect(() => createRuntimeBlobStore({ environment: "test" })).toThrow(
      BlobStoreConfigurationError,
    );
    expect(() =>
      createRuntimeBlobStore({ environment: "development", localDirectory: ".data/blob" }),
    ).toThrow(BlobStoreConfigurationError);
  });

  it("lets independently constructed local web/worker stores share one explicit path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-shared-blob-"));
    directories.push(dir);
    const web = createRuntimeBlobStore({ environment: "test", localDirectory: dir });
    const worker = createRuntimeBlobStore({ environment: "test", localDirectory: dir });
    expect(web).toBeInstanceOf(LocalFsBlobStore);
    expect(worker).toBeInstanceOf(LocalFsBlobStore);

    await web.put({
      key: "raw-import/p1/r1/n1",
      body: Buffer.from("shared"),
      contentType: "text/plain",
    });
    expect((await worker.get("raw-import/p1/r1/n1"))?.toString()).toBe("shared");
  });

  it("allows an explicit Supabase backend outside production", () => {
    expect(
      createRuntimeBlobStore({
        environment: "development",
        backend: "supabase",
        supabase: REMOTE,
      }),
    ).toBeInstanceOf(SupabaseBlobStore);
  });
});
