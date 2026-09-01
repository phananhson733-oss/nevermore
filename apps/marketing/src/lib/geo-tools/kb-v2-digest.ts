// @input -- versioned v2 JSON, with no unbounded/fractional number formatting
// @output -- SHA-256 for exact stored v2 content
// @pos -- server-only digest, separate from legacy payload hashing
import { createHash } from "node:crypto";
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
export function geoV2Digest(value: unknown): string {
  return createHash("sha256").update(canonicalGeoV2Text(value), "utf8").digest("hex");
}
