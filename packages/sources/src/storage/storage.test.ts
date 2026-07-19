import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocalFsBlobStore } from "./local-fs.ts";
import { MemoryBlobStore } from "./memory.ts";
import {
  blobStoreDownloadSigner,
  mintExportObjectKey,
} from "../blob/supabase-signer.ts";
import {
  BlobObjectNotFoundError,
  BlobStoreConfigurationError,
  objectKey,
} from "./types.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("objectKey", () => {
  it("builds an unguessable kind/project/run/nonce key", () => {
    expect(objectKey({ kind: "raw", projectId: "p1", runId: "r1", nonce: "abc123" })).toBe(
      "raw/p1/r1/abc123",
    );
  });

  it("rejects traversal, separators, and empty segments", () => {
    expect(() => objectKey({ kind: "raw", projectId: "..", runId: "r", nonce: "n" })).toThrow();
    expect(() => objectKey({ kind: "raw", projectId: "a/b", runId: "r", nonce: "n" })).toThrow();
    expect(() => objectKey({ kind: "", projectId: "p", runId: "r", nonce: "n" })).toThrow();
  });
});

describe("MemoryBlobStore", () => {
  it("round-trips put/get with a correct sha256 and byte count", async () => {
    const store = new MemoryBlobStore();
    const body = Buffer.from("hello world", "utf8");
    const key = objectKey({ kind: "export", projectId: "p", runId: "r", nonce: "n1" });

    const result = await store.put({ key, body, contentType: "text/plain" });
    expect(result.key).toBe(key);
    expect(result.bytes).toBe(body.length);
    expect(result.sha256).toBe(createHash("sha256").update(body).digest("hex"));

    const got = await store.get(key);
    expect(got?.equals(body)).toBe(true);
  });

  it("returns null for a missing key and deletes idempotently", async () => {
    const store = new MemoryBlobStore();
    expect(await store.get("missing")).toBeNull();
    await expect(store.delete("missing")).resolves.toBeUndefined();
  });

  it("refuses to overwrite an existing key (append-only)", async () => {
    const store = new MemoryBlobStore();
    await store.put({ key: "k", body: Buffer.from("first"), contentType: "text/plain" });
    await expect(
      store.put({ key: "k", body: Buffer.from("second"), contentType: "text/plain" }),
    ).rejects.toThrow();
    expect((await store.get("k"))?.toString("utf8")).toBe("first");
  });

  it("returns a memory:// signed url", async () => {
    const store = new MemoryBlobStore();
    await store.put({ key: "k", body: Buffer.from("x"), contentType: "text/plain" });
    expect(await store.signedUrl("k", 60)).toBe("memory://k");
  });

  it("refuses to sign a missing object", async () => {
    const store = new MemoryBlobStore();
    await expect(store.signedUrl("missing", 60)).rejects.toBeInstanceOf(
      BlobObjectNotFoundError,
    );
  });

  it("lists only one private kind with stable cursor pagination and upload timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const store = new MemoryBlobStore();
    const first = objectKey({
      kind: "raw-import",
      projectId: "list-memory",
      runId: "run",
      nonce: "a.csv",
    });
    const second = objectKey({
      kind: "raw-import",
      projectId: "list-memory",
      runId: "run",
      nonce: "b.csv",
    });
    await store.put({ key: second, body: Buffer.from("b"), contentType: "text/csv" });
    await store.put({
      key: objectKey({ kind: "export", projectId: "list-memory", runId: "run", nonce: "x.zip" }),
      body: Buffer.from("zip"),
      contentType: "application/zip",
    });
    await store.put({ key: first, body: Buffer.from("a"), contentType: "text/csv" });

    const page1 = await store.list({ kind: "raw-import", cursor: null, limit: 1 });
    const page2 = await store.list({
      kind: "raw-import",
      cursor: page1.nextCursor,
      limit: 1,
    });

    expect(page1).toEqual({
      objects: [{ key: first, createdAt: "2026-07-17T12:00:00.000Z" }],
      nextCursor: first,
    });
    expect(page2).toEqual({
      objects: [{ key: second, createdAt: "2026-07-17T12:00:00.000Z" }],
      nextCursor: null,
    });
  });
});

describe("LocalFsBlobStore", () => {
  let dir: string;
  let store: LocalFsBlobStore;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sf-blob-"));
    store = new LocalFsBlobStore(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects a relative base path instead of resolving it against process cwd", () => {
    expect(() => new LocalFsBlobStore(".data/blob")).toThrow(
      BlobStoreConfigurationError,
    );
  });

  it("round-trips put/get and computes sha256/bytes", async () => {
    const body = Buffer.from("keyword,volume\nfoo,10\n", "utf8");
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "n1" });

    const result = await store.put({ key, body, contentType: "text/csv" });
    expect(result.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(result.bytes).toBe(body.length);
    expect((await store.get(key))?.equals(body)).toBe(true);
  });

  it("refuses to overwrite an existing final key and preserves the original", async () => {
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "dup" });
    await store.put({ key, body: Buffer.from("first"), contentType: "text/plain" });
    await expect(
      store.put({ key, body: Buffer.from("second"), contentType: "text/plain" }),
    ).rejects.toThrow();
    expect((await store.get(key))?.toString("utf8")).toBe("first");
  });

  it("returns null for a missing key", async () => {
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "absent" });
    expect(await store.get(key)).toBeNull();
  });

  it("rejects keys that escape the base directory", async () => {
    await expect(store.get("../escape")).rejects.toThrow();
    await expect(store.put({ key: "../escape", body: Buffer.from("x"), contentType: "text/plain" })).rejects.toThrow();
  });

  it("issues a file:// signed url carrying an expiry", async () => {
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "url" });
    await store.put({ key, body: Buffer.from("x"), contentType: "text/plain" });
    const url = await store.signedUrl(key, 60);
    expect(url.startsWith("file://")).toBe(true);
    expect(url).toContain("expires=");
  });

  it("keeps retained export bytes re-signable and downloadable on days 30 and 31", async () => {
    const generatedAt = new Date("2026-07-18T12:00:00.000Z");
    const key = objectKey({
      kind: "export",
      projectId: "retention-project",
      runId: "retention-run",
      nonce: "retention.zip",
    });
    const zip = Buffer.from("retained export bytes");
    vi.useFakeTimers();
    vi.setSystemTime(generatedAt);
    await store.put({ key, body: zip, contentType: "application/zip" });

    for (const ageDays of [30, 31]) {
      const now = new Date(
        generatedAt.getTime() + ageDays * 24 * 60 * 60 * 1000,
      );
      vi.setSystemTime(now);

      const signedUrl = await store.signedUrl(key, 15 * 60);
      const url = new URL(signedUrl);
      expect(url.searchParams.get("expires")).toBe(
        String(Math.floor(now.getTime() / 1000) + 15 * 60),
      );
      expect((await readFile(fileURLToPath(url))).equals(zip)).toBe(true);
      expect((await store.get(key))?.equals(zip)).toBe(true);
    }

    // A production bucket lifecycle may remove the old object after its
    // 30-day retention window. Regeneration must use a fresh append-only key,
    // and that replacement must immediately support the same 900s download.
    await store.delete(key);
    await expect(store.signedUrl(key, 15 * 60)).rejects.toBeInstanceOf(
      BlobObjectNotFoundError,
    );
    const regeneratedKey = mintExportObjectKey({
      projectId: "retention-project",
      runId: "regenerated-run",
    });
    const regeneratedZip = Buffer.from("regenerated export bytes");
    await store.put({
      key: regeneratedKey,
      body: regeneratedZip,
      contentType: "application/zip",
    });
    const signer = blobStoreDownloadSigner(store, "retention-project");
    const regeneratedUrl = await signer.signDownloadUrl(regeneratedKey, {
      expiresInSeconds: 15 * 60,
    });
    expect(
      (await readFile(fileURLToPath(new URL(regeneratedUrl)))).equals(
        regeneratedZip,
      ),
    ).toBe(true);
  });

  it("refuses to sign a missing object", async () => {
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "missing-url" });
    await expect(store.signedUrl(key, 60)).rejects.toBeInstanceOf(
      BlobObjectNotFoundError,
    );
  });

  it("deletes an existing key idempotently", async () => {
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "del" });
    await store.put({ key, body: Buffer.from("bye"), contentType: "text/plain" });
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it("recursively lists canonical files for one private kind with a deletion-safe cursor", async () => {
    const first = objectKey({
      kind: "raw-import",
      projectId: "list-local",
      runId: "run-a",
      nonce: "a.csv",
    });
    const second = objectKey({
      kind: "raw-import",
      projectId: "list-local",
      runId: "run-b",
      nonce: "b.csv",
    });
    await store.put({ key: second, body: Buffer.from("b"), contentType: "text/csv" });
    await store.put({ key: first, body: Buffer.from("a"), contentType: "text/csv" });

    const page1 = await store.list({ kind: "raw-import", cursor: null, limit: 1 });
    expect(page1.objects).toHaveLength(1);
    expect(page1.objects[0]).toMatchObject({ key: first });
    expect(Number.isFinite(Date.parse(page1.objects[0]!.createdAt))).toBe(true);

    await store.delete(first);
    const page2 = await store.list({
      kind: "raw-import",
      cursor: page1.nextCursor,
      limit: 1,
    });
    expect(page2.objects).toHaveLength(1);
    expect(page2.objects[0]).toMatchObject({ key: second });
    expect(page2.nextCursor).toBeNull();
  });
});
