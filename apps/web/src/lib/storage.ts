import path from "node:path";
import { LocalFsBlobStore, type BlobStore } from "@sf/sources";

/**
 * Blob storage accessor (spec §7.6, §13.3). LOCAL dev uses a filesystem-backed
 * store under `.data/blob`; the hosted deployment swaps in a Supabase Storage
 * implementation of the same `BlobStore` interface (the swap point is here). Raw
 * imports and export bundles are the only blobs; the DB keeps only the object key
 * + sha256 (never the payload).
 */

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  if (!store) {
    const baseDir =
      process.env["SF_BLOB_DIR"] ?? path.join(process.cwd(), ".data", "blob");
    store = new LocalFsBlobStore(baseDir);
  }
  return store;
}
