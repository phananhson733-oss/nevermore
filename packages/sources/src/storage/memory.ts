/**
 * In-memory `BlobStore` (spec §7.6). A `Map`-backed test double that mirrors the
 * real store's semantics — sha256 receipts, append-only `put`, null-on-missing
 * `get` — so unit tests can exercise storage without touching the filesystem.
 */

import { createHash } from "node:crypto";
import type { BlobPutInput, BlobPutResult, BlobStore } from "./types.ts";

export class MemoryBlobStore implements BlobStore {
  readonly #objects = new Map<string, Buffer>();

  async put(input: BlobPutInput): Promise<BlobPutResult> {
    if (this.#objects.has(input.key)) {
      throw new Error(`object already exists (append-only): ${input.key}`);
    }
    // Copy so later mutation of the caller's buffer cannot alter stored bytes.
    const stored = Buffer.from(input.body);
    this.#objects.set(input.key, stored);
    return {
      key: input.key,
      sha256: createHash("sha256").update(stored).digest("hex"),
      bytes: stored.length,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const found = this.#objects.get(key);
    return found ? Buffer.from(found) : null;
  }

  async signedUrl(key: string, _ttlSeconds: number): Promise<string> {
    return `memory://${key}`;
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }
}
