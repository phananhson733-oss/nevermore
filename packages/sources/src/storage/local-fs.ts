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
  type BlobGetOptions,
  type BlobPutInput,
  type BlobPutResult,
  type BlobStore,
} from "./types.ts";

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

interface LocalFsMaintenanceOptions {
  readonly signal?: AbortSignal;
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

  async get(
    key: string,
    options: BlobGetOptions = {},
  ): Promise<Buffer | null> {
    options.signal?.throwIfAborted();
    const path = this.#pathFor(key);
    try {
      const body = options.signal
        ? await readFile(path, { signal: options.signal })
        : await readFile(path);
      options.signal?.throwIfAborted();
      return body;
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

  async delete(
    key: string,
    options: LocalFsMaintenanceOptions = {},
  ): Promise<void> {
    options.signal?.throwIfAborted();
    await rm(this.#pathFor(key), { force: true });
    options.signal?.throwIfAborted();
  }

  async list(
    input: BlobListInput & LocalFsMaintenanceOptions,
  ): Promise<BlobListPage> {
    assertBlobListInput(input);
    input.signal?.throwIfAborted();
    const objects: Array<{ key: string; createdAt: string }> = [];
    let hasNext = false;
    for await (const path of this.#walkFiles(
      this.#pathFor(input.kind),
      input.signal,
    )) {
      input.signal?.throwIfAborted();
      const key = relative(this.#baseDir, path).split(sep).join("/");
      if (input.cursor !== null && key <= input.cursor) continue;
      try {
        if (parseObjectKey(key).kind !== input.kind) continue;
        const metadata = await stat(path);
        objects.push({ key, createdAt: metadata.mtime.toISOString() });
        if (objects.length > input.limit) {
          hasNext = true;
          break;
        }
      } catch (error) {
        // A concurrent idempotent delete may remove an object between readdir
        // and stat. Treat that object as absent while preserving real failures.
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
    input.signal?.throwIfAborted();
    const page = hasNext ? objects.slice(0, input.limit) : objects;
    return {
      objects: page,
      nextCursor: hasNext ? page.at(-1)!.key : null,
    };
  }

  async *#walkFiles(
    directory: string,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<string> {
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    signal?.throwIfAborted();
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      signal?.throwIfAborted();
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        yield* this.#walkFiles(path, signal);
      } else if (entry.isFile()) {
        yield path;
      }
      // Symlinks and other special files are intentionally ignored: orphan
      // maintenance must never follow a path outside the configured base dir.
    }
  }
}
