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
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BlobObjectAlreadyExistsError,
  BlobObjectNotFoundError,
  BlobStoreConfigurationError,
  assertBlobListInput,
  parseObjectKey,
  type BlobListInput,
  type BlobListPage,
  type BlobPutInput,
  type BlobPutResult,
  type BlobStore,
} from "./types.ts";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class LocalFsBlobStore implements BlobStore {
  readonly #baseDir: string;

  constructor(baseDir: string) {
    if (!isAbsolute(baseDir)) {
      throw new BlobStoreConfigurationError(
        "LocalFsBlobStore requires an explicit absolute base directory",
      );
    }
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
        throw new BlobObjectAlreadyExistsError(input.key, { cause: error });
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
    const path = this.#pathFor(key);
    try {
      await access(path);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new BlobObjectNotFoundError(key, { cause: error });
      }
      throw error;
    }
    const url = pathToFileURL(path);
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(0, Math.trunc(ttlSeconds));
    url.searchParams.set("expires", String(expiresAt));
    return url.href;
  }

  async delete(key: string): Promise<void> {
    await rm(this.#pathFor(key), { force: true });
  }

  async list(input: BlobListInput): Promise<BlobListPage> {
    assertBlobListInput(input);
    const paths = await this.#walkFiles(this.#pathFor(input.kind));
    const objects: Array<{ key: string; createdAt: string }> = [];
    for (const path of paths) {
      const key = relative(this.#baseDir, path).split(sep).join("/");
      try {
        if (parseObjectKey(key).kind !== input.kind) continue;
        const metadata = await stat(path);
        objects.push({ key, createdAt: metadata.mtime.toISOString() });
      } catch (error) {
        // A concurrent idempotent delete may remove an object between readdir
        // and stat. Treat that object as absent while preserving real failures.
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
    objects.sort((left, right) =>
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

  async #walkFiles(directory: string): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const files: string[] = [];
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.#walkFiles(path)));
      } else if (entry.isFile()) {
        files.push(path);
      }
      // Symlinks and other special files are intentionally ignored: orphan
      // maintenance must never follow a path outside the configured base dir.
    }
    return files;
  }
}
