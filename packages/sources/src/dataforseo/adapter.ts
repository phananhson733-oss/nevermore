/**
 * DataForSEO disabled adapter (spec §7.2, AC-020). The adapter CONTRACT is kept
 * in the first version, but the provider is switched off behind a feature flag
 * that must stay `false` in the MVP (spec §14 env matrix, `DATAFORSEO_ENABLED`).
 *
 * Every method throws a stable `SourceError("FEATURE_DISABLED", …)` — thrown
 * SYNCHRONOUSLY, before any await — so there is provably NO code path that opens
 * a socket. There are no imports of `fetch`, `http`, or any network client here:
 * DataForSEO makes no network request in the MVP (AC-020).
 *
 * DataForSEO would be a vendor_observation source for competitive keyword-gap
 * data (spec §7.6 evidence table), i.e. the API alternative to the CSV keyword
 * gap import — hence the disabled capability describes that keyword-gap slot.
 */

import type {
  Capability,
  CollectionContext,
  CollectionResult,
  NormalizeContext,
  NormalizedObservation,
  SourceAdapter,
} from "../adapter.ts";
import { SourceError } from "../adapter.ts";

/** Feature flag. MUST be `false` in the MVP (spec §14, AC-020). */
export const DATAFORSEO_ENABLED = false;

const DISABLED_MESSAGE = "DataForSEO is disabled in the MVP";

function disabled(): never {
  throw new SourceError("FEATURE_DISABLED", DISABLED_MESSAGE);
}

/**
 * The capability advertised to the UI: the DataForSEO-backed keyword-gap slot is
 * present but unavailable, so the Sources UI can render an explicit "not
 * enabled" card rather than hiding the provider (AC-020).
 */
export function disabledCapability(): Capability {
  return {
    datasetKey: "csv.keyword_gap.v1",
    operation: "keyword_gap_import",
    available: false,
    limitation: DISABLED_MESSAGE,
  };
}

/**
 * The disabled adapter. `C`/`P`/`R` are `never`: there is no valid config, no
 * collectable payload, and no raw shape — every method rejects.
 */
export const dataforseoAdapter: SourceAdapter<never, never, never> = {
  provider: "dataforseo",
  validateConfig(_config: unknown): Promise<never> {
    return disabled();
  },
  capabilities(_config: never): Promise<Capability[]> {
    return disabled();
  },
  collect(_params: never, _ctx: CollectionContext): Promise<CollectionResult<never>> {
    return disabled();
  },
  normalize(_raw: never, _ctx: NormalizeContext): AsyncIterable<NormalizedObservation> {
    return disabled();
  },
};
