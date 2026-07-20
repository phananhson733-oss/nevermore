/**
 * In-memory `BlobStore` (spec §7.6). A `Map`-backed test double that mirrors the
 * real store's semantics — sha256 receipts, append-only `put`, null-on-missing
 * `get` — so unit tests can exercise storage without touching the filesystem.
 */

import { createHash } from "node:crypto";
import {
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  assertBlobListInput,
  parseObjectKey,
  type BlobListInput,
  type BlobListPage,
  type BlobGetOptions,
  type BlobPutInput,
  type BlobPutResult,
  type BlobStore,
} from "./types.ts";

interface MemoryBlobObject {
  readonly body: Buffer;
  readonly createdAt: string;
}

export class MemoryBlobStore implements BlobStore {
  readonly #objects = new Map<string, MemoryBlobObject>();

  async put(input: BlobPutInput): Promise<BlobPutResult> {
    if (this.#objects.has(input.key)) {
      throw new BlobObjectAlreadyExistsError(input.key);
    }
    // Copy so later mutation of the caller's buffer cannot alter stored bytes.
    const stored = Buffer.from(input.body);
    this.#objects.set(input.key, {
      body: stored,
      createdAt: new Date().toISOString(),
    });
    return {
      key: input.key,
      sha256: createHash("sha256").update(stored).digest("hex"),
      bytes: stored.length,
    };
  }

  async get(
    key: string,
    options: BlobGetOptions = {},
  ): Promise<Buffer | null> {
    options.signal?.throwIfAborted();
    const found = this.#objects.get(key);
    const body = found ? Buffer.from(found.body) : null;
    options.signal?.throwIfAborted();
    return body;
  }

  async signedUrl(key: string, _ttlSeconds: number): Promise<string> {
    if (!this.#objects.has(key)) {
      throw new BlobObjectNotFoundError(key);
    }
    return `memory://${key}`;
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  async list(input: BlobListInput): Promise<BlobListPage> {
    assertBlobListInput(input);
    const objects = [...this.#objects.entries()]
      .filter(([key]) => {
        try {
          return parseObjectKey(key).kind === input.kind;
        } catch {
          return false;
        }
      })
      .map(([key, object]) => ({ key, createdAt: object.createdAt }))
      .sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      );
    const cursor = input.cursor;
    const start =
      cursor === null
        ? 0
        : objects.findIndex((object) => object.key > cursor);
    if (start < 0) return { objects: [], nextCursor: null };
    const page = objects.slice(start, start + input.limit);
    const hasNext = start + page.length < objects.length;
    return {
      objects: page,
      nextCursor: hasNext ? page.at(-1)!.key : null,
    };
  }
}
