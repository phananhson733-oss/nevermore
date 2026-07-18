/**
 * Filesystem-backed `BlobStore` for LOCAL dev (spec §7.6, §13.3). Objects are
 * written under a base directory, one file per key. Supabase Storage replaces
 * this behind the same interface in production.
 *
 * Guarantees:
 * - Append-only: `put` uses the `wx` open flag, so it refuses to overwrite an
 *   existing final key (spec §13.3).
 * - Confinement: every key resolves to a path strictly under the base dir;
 *   traversal (`../`) or absolute keys are rejected.
 *
 * `signedUrl` returns a `file://` URL to the on-disk path with an advisory
 * `expires` query param. This is DEV-ONLY and is NOT cryptographically signed;
 * the production Supabase store returns real time-limited signed URLs.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { BlobPutInput, BlobPutResult, BlobStore } from "./types.ts";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class LocalFsBlobStore implements BlobStore {
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir);
  }

  #pathFor(key: string): string {
    const full = resolve(this.#baseDir, key);
    if (full === this.#baseDir || !full.startsWith(this.#baseDir + sep)) {
      throw new Error(`object key escapes the storage base directory: ${key}`);
    }
    return full;
  }

  async put(input: BlobPutInput): Promise<BlobPutResult> {
    const path = this.#pathFor(input.key);
    const body = Buffer.from(input.body);
    await mkdir(dirname(path), { recursive: true });
    try {
      // `wx`: create + fail if the path already exists (append-only final keys).
      await writeFile(path, body, { flag: "wx" });
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new Error(`object already exists (append-only): ${input.key}`);
      }
      throw error;
    }
    return {
      key: input.key,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.length,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const path = this.#pathFor(key);
    try {
      return await readFile(path);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const url = pathToFileURL(this.#pathFor(key));
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(0, Math.trunc(ttlSeconds));
    url.searchParams.set("expires", String(expiresAt));
    return url.href;
  }

  async delete(key: string): Promise<void> {
    await rm(this.#pathFor(key), { force: true });
  }
}
