import { createHash } from "node:crypto";

/**
 * SHA-256 of the exact provider content bytes. A string is hashed as UTF-8.
 * This is deliberately not the Artifact JCS identity (`contentHash({ text })`).
 */
export function computeContentChecksum(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
