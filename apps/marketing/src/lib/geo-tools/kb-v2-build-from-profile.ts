// @input  -- the confirmed Profile copy a V2 draft already carries, and that draft
// @output -- one derived draft plus a named account of what it did and did not write
// @pos    -- pure derivation from data already held; it issues no request and bills nothing
import type { MarketingWebsiteProfileV1 } from "../account-websites/contracts.ts";
import { GEO_KB_LIMITS } from "./kb-contract.ts";
import type { GeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { proposeGeoKbAliases } from "./kb-aliases.ts";
import { competitorIdentity } from "./kb-profile-suggestions.ts";
import {
  applyGeoV2Measurement,
  geoV2MeasurementGapFrom,
  geoV2MeasurementProposal,
  type GeoV2MeasurementField,
} from "./kb-v2-measurement.ts";

/**
 * Why a part of the draft was left alone. "unchanged" means the Profile agrees
 * with what is already there; "manual" means adopting would have destroyed
 * something the Profile cannot reproduce, or the choice exceeds what this
 * derivation may decide alone. Both keep the explicit review panel as the way
 * through, so nothing is silently dropped.
 */
export type GeoV2BuildOutcome = "adopted" | "unchanged" | "manual";

export interface GeoV2ProfileBuild {
  readonly payload: GeoKbPayloadV2;
  /** Measurement fields actually written, in contract order. */
  readonly fields: readonly GeoV2MeasurementField[];
  readonly aliases: GeoV2BuildOutcome;
  readonly competitors: GeoV2BuildOutcome;
  /** True when the returned payload differs from the one given. */
  readonly changed: boolean;
}

/**
 * Roles are deliberately absent, for the reason `GEO_V2_MEASUREMENT_FIELDS`
 * gives: a role carries a review state and the evidence it was generated from.
 * The Profile can supply neither a question label nor evidence refs, so a role
 * derived here would land unusable and would still have to be replaced by the
 * generated one. Facts are absent for the same kind of reason -- an accepted
 * fact needs a source URL and an observation time that only a capture has.
 */
export function buildGeoV2FromProfile(
  profile: MarketingWebsiteProfileV1,
  payload: GeoKbPayloadV2,
): GeoV2ProfileBuild {
  const proposal = geoV2MeasurementProposal(profile, payload);
  const gap = geoV2MeasurementGapFrom(proposal, payload);

  // Adopting every competitor the Profile can map is safe only when no row
  // currently held would disappear. A row the visitor added by hand is not in
  // the Profile, so replacing the set would delete it while looking like a
  // field update; that decision stays with the review panel.
  const adoptable = proposal.competitors.flatMap((row, index) =>
    row.value === null
      ? []
      : [{ index, identity: competitorIdentity(row.value) }],
  );
  const held = payload.competitors.map(competitorIdentity);
  const lossless = held.every((identity) =>
    adoptable.some((row) => row.identity === identity),
  );
  const competitors: GeoV2BuildOutcome = !gap.competitorsDiffer
    ? "unchanged"
    : lossless && adoptable.length <= GEO_KB_LIMITS.competitors
      ? "adopted"
      : "manual";

  let next = applyGeoV2Measurement(payload, proposal, {
    fields: gap.fields,
    competitorIndices:
      competitors === "adopted" ? adoptable.map((row) => row.index) : null,
  });

  // The alias list is the match table for every later mention judgement, so an
  // empty one makes the whole knowledge base unable to recognise its own name.
  // It is derived rather than copied, and only written when nothing is there:
  // an existing list is a curated one, and this derivation cannot tell which
  // entries were removed on purpose.
  const derived = proposeGeoKbAliases(next.targetUrl, next.officialName);
  const aliases: GeoV2BuildOutcome =
    next.aliases.length > 0
      ? "unchanged"
      : derived.length === 0
        ? "manual"
        : "adopted";
  if (aliases === "adopted") next = { ...next, aliases: [...derived] };

  // `applyGeoV2Measurement` always returns a fresh object, so identity says
  // nothing. What was actually written is what the outcomes above record.
  const changed =
    gap.fields.length > 0 || aliases === "adopted" || competitors === "adopted";
  return {
    payload: changed ? next : payload,
    fields: gap.fields,
    aliases,
    competitors,
    changed,
  };
}
