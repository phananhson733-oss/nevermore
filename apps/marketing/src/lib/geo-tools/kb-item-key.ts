// @input -- content-only item key parts from the client-safe identity module
// @output -- the stable sha256 item key stored on every v3 knowledge item
// @pos -- server-only digest; the browser reasons about identity via the basis
import { createHash } from "node:crypto";
import { GEO_ITEM_KEY_SEPARATOR, geoItemKeyBasis, type GeoItemKeyParts } from "./kb-item-identity.ts";

/**
 * The key an owner decision is filed under. It is derived from content alone,
 * so re-crawling the same claim from a different page keeps the decision, and
 * two plans' prices never share a key because their qualifiers differ.
 */
export function geoItemKey(parts: GeoItemKeyParts): string {
  return createHash("sha256")
    .update(geoItemKeyBasis(parts).join(GEO_ITEM_KEY_SEPARATOR), "utf8")
    .digest("hex");
}

/**
 * Prove that every item's stored key really is the digest of that item's own
 * content. The contract parser cannot do this -- it is browser-safe and has no
 * sha256 -- so a payload that merely parses is not yet trustworthy: swapping a
 * fact's qualifiers while keeping its old key silently redirects that item's
 * exclusions and corrections onto different content.
 *
 * Call it at every boundary that accepts a payload from outside this process:
 * draft save, publish, and any import.
 */
export function assertGeoItemKeyIntegrity(
  items: readonly { readonly itemKey: string; readonly identity: GeoItemKeyParts }[],
): void {
  for (const item of items) {
    if (geoItemKey(item.identity) !== item.itemKey) {
      throw new Error(`Item key does not match its content (${item.identity.module})`);
    }
  }
}
