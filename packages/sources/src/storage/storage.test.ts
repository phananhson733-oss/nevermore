import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFsBlobStore } from "./local-fs.ts";
import { MemoryBlobStore } from "./memory.ts";
import { objectKey } from "./types.ts";

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
    expect(await store.signedUrl("k", 60)).toBe("memory://k");
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

  it("deletes an existing key idempotently", async () => {
    const key = objectKey({ kind: "raw", projectId: "p", runId: "r", nonce: "del" });
    await store.put({ key, body: Buffer.from("bye"), contentType: "text/plain" });
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.delete(key)).resolves.toBeUndefined();
  });
});
