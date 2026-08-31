// @input  -- a server-resolved immutable website profile
// @output -- inherited product fields and their exact reference for the GEO editor
// @pos    -- shared view shape; product fields remain owned by Website Profile

import type { WebsiteProfileReferenceV1, WebsiteProfileFieldProvenance } from "../account-websites/contracts.ts";

/** The shipped question registry is English; locale labels must not imply otherwise. */
export function isSupportedGeoQuestionLanguage(language: string): boolean {
  if (!language || language !== language.trim()) return false;
  try {
    return new Intl.Locale(language).language === "en";
  } catch {
    return false;
  }
}

export interface GeoInheritedProfile {
  readonly reference: WebsiteProfileReferenceV1;
  readonly productName: string;
  readonly oneLinePositioning: string;
  readonly coreFeatures: readonly string[];
  readonly market: { readonly country: string; readonly language: string };
  /** Exact source flags; inferred product fields are not factual Draft authority. */
  readonly fieldProvenance?: readonly WebsiteProfileFieldProvenance[];
}
