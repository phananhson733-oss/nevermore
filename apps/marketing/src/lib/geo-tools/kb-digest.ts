// @input  -- a knowledge-base payload or question set
// @output -- the sha256 of its canonical form, in the spelling Postgres recomputes
// @pos    -- server only; kept out of kb-contract.ts so the editor can import the limits

import { createHash } from "node:crypto";

import { canonicalGeoKbText, type GeoKbValue } from "./kb-contract.ts";

/**
 * The digest both sides of the write agree on.
 *
 * `marketing_geo_save_kb_draft` recomputes this from its own canonical text and
 * refuses a mismatch, so neither the client nor the database defines identity
 * alone.
 */
export function geoKbDigest(value: GeoKbValue): string {
  return createHash("sha256")
    .update(canonicalGeoKbText(value), "utf8")
    .digest("hex");
}
