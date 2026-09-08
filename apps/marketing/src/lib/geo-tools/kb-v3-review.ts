// @input -- the owner's four gestures and the review a v3 draft already holds
// @output -- the next decision state, and the review record set that state materialises to
// @pos -- client-safe and pure: no digest, no clock, no store; every timestamp arrives as an argument

/**
 * The four gestures, and the one label none of them may write.
 *
 * `accepted` means a person read this exact item and said yes to it, one item
 * at a time. `accepted_in_bulk` means a person said yes to a group without
 * reading each member -- the module's "accept all", and the fallback that runs
 * when a draft is published with items still pending. The two are different
 * claims about how much human attention an item received, and the whole point
 * of keeping them apart is that pressing a different button must not let the
 * same model output claim the stronger one. So exactly one code path in this
 * file writes `accepted`, and it is the one that handles a single item key.
 *
 * Why this is a state machine over a map rather than edits to the record list:
 * the browser has no sha256, so it cannot build a decision record (each one
 * carries `baseContentHash`). It can, however, reason perfectly well about
 * "what is this item's decision now", which is all the card needs to render.
 * So the gestures move a hash-free state map, and materialising that map into
 * records -- the part that needs hashes, a clock and the draft version --
 * happens once, on the server, at the moment of the save.
 */
import { canonicalGeoV2Text } from "./kb-v2-json.ts";
import type {
  GeoDecision,
  GeoOverrideV3,
  GeoReviewV3,
} from "./kb-v3-contract.ts";

/** What is currently decided about one item. The absence of a record is this, with `pending`. */
export interface GeoV3DecisionState {
  readonly decision: GeoDecision;
  readonly override: GeoOverrideV3 | null;
}

export const GEO_V3_UNDECIDED: GeoV3DecisionState = {
  decision: "pending",
  override: null,
};

/**
 * `accept` and `exclude` are toggles: the row renders them with `aria-pressed`,
 * and a pressed control that cannot be unpressed is a trap. Pressing the
 * pressed one returns the item to `pending`, which is honest -- it publishes as
 * accepted in bulk, not as confirmed.
 */
export type GeoV3ReviewAction =
  | { readonly kind: "accept"; readonly itemKey: string }
  | {
      readonly kind: "correct";
      readonly itemKey: string;
      readonly override: GeoOverrideV3;
    }
  | { readonly kind: "exclude"; readonly itemKey: string }
  | { readonly kind: "revert"; readonly itemKey: string }
  /**
   * The module-level "accept all". It names the keys it applies to, so a
   * module's button can never reach an item in another module -- and so the
   * same function serves the publish-time fallback, which names every key.
   */
  | { readonly kind: "accept_all"; readonly itemKeys: readonly string[] };

export type GeoV3DecisionStates = ReadonlyMap<string, GeoV3DecisionState>;

/** The decision state of every item key, defaulting to undecided. */
export function geoV3DecisionStates(
  review: GeoReviewV3,
  itemKeys: readonly string[],
): GeoV3DecisionStates {
  const decisions = new Map(
    review.decisions.map((record) => [record.itemKey, record]),
  );
  const suppressed = new Set(
    review.suppressions.map((record) => record.itemKey),
  );
  const states = new Map<string, GeoV3DecisionState>();
  for (const itemKey of itemKeys) {
    const record = decisions.get(itemKey);
    // A suppression outlives its item, so a key that is suppressed but carries
    // no decision record is still excluded. Reading only the record list would
    // resurrect it as pending and then publish it.
    if (record === undefined)
      states.set(
        itemKey,
        suppressed.has(itemKey)
          ? { decision: "excluded", override: null }
          : GEO_V3_UNDECIDED,
      );
    else
      states.set(itemKey, {
        decision: record.decision,
        override: record.override,
      });
  }
  return states;
}

const undecided = (state: GeoV3DecisionState): boolean =>
  state.decision === "pending" && state.override === null;

/**
 * One gesture, applied. Returns a new map; the input is never mutated.
 *
 * A gesture aimed at an item the knowledge body does not contain is dropped
 * rather than recorded: the payload parser refuses a decision that refers to no
 * item, so accepting one here would only turn a stale click into a save that
 * fails for a reason nobody can read.
 */
export function applyGeoV3ReviewAction(
  states: GeoV3DecisionStates,
  action: GeoV3ReviewAction,
): GeoV3DecisionStates {
  const next = new Map(states);
  if (action.kind === "accept_all") {
    let swept = 0;
    for (const itemKey of action.itemKeys) {
      const current = next.get(itemKey);
      // Only an item nobody has decided anything about is swept up. An item
      // already accepted one by one keeps that label; an excluded or corrected
      // one is a decision this gesture has no business overwriting.
      if (current !== undefined && undecided(current)) {
        next.set(itemKey, { decision: "accepted_in_bulk", override: null });
        swept += 1;
      }
    }
    // Returning the input by reference is how a caller tells "this gesture did
    // nothing" from "this gesture happened to produce equal content".
    return swept === 0 ? states : next;
  }
  const current = next.get(action.itemKey);
  if (current === undefined) return states;
  switch (action.kind) {
    case "accept":
      // A corrected item shows only "undo"; accepting it again would be a
      // no-op with a misleading name, and toggling it off would drop the
      // correction without saying so.
      if (current.override !== null) return states;
      next.set(action.itemKey, {
        decision: current.decision === "accepted" ? "pending" : "accepted",
        override: null,
      });
      return next;
    case "correct":
      // A correction is an acceptance of the corrected text: the contract
      // refuses an override on any other decision.
      next.set(action.itemKey, {
        decision: "accepted",
        override: action.override,
      });
      return next;
    case "exclude":
      if (current.override !== null) return states;
      next.set(action.itemKey, {
        decision: current.decision === "excluded" ? "pending" : "excluded",
        override: null,
      });
      return next;
    case "revert":
      if (current.override === null) return states;
      // Undoing a correction does not accept what was generated. Nobody has
      // said yes to that text, so the item goes back to pending.
      next.set(action.itemKey, GEO_V3_UNDECIDED);
      return next;
  }
}

export function applyGeoV3ReviewActions(
  states: GeoV3DecisionStates,
  actions: readonly GeoV3ReviewAction[],
): GeoV3DecisionStates {
  return actions.reduce<GeoV3DecisionStates>(applyGeoV3ReviewAction, states);
}

/** Item keys that would publish as `accepted_in_bulk` if the draft were published now. */
export function geoV3PendingKeys(
  states: GeoV3DecisionStates,
): readonly string[] {
  return [...states]
    .filter(([, state]) => undecided(state))
    .map(([itemKey]) => itemKey);
}

export interface GeoV3ReviewCounts {
  readonly total: number;
  readonly accepted: number;
  readonly acceptedInBulk: number;
  readonly excluded: number;
  readonly pending: number;
  readonly corrected: number;
}

export function geoV3ReviewCounts(
  states: GeoV3DecisionStates,
): GeoV3ReviewCounts {
  let accepted = 0,
    acceptedInBulk = 0,
    excluded = 0,
    pending = 0,
    corrected = 0;
  for (const state of states.values()) {
    if (state.override !== null) corrected += 1;
    if (state.decision === "accepted") accepted += 1;
    else if (state.decision === "accepted_in_bulk") acceptedInBulk += 1;
    else if (state.decision === "excluded") excluded += 1;
    else pending += 1;
  }
  return {
    total: states.size,
    accepted,
    acceptedInBulk,
    excluded,
    pending,
    corrected,
  };
}

/** How many items this save changed, for the publish box's "n changes" line. */
export function geoV3ChangedKeys(
  before: GeoV3DecisionStates,
  after: GeoV3DecisionStates,
): readonly string[] {
  const changed: string[] = [];
  for (const [itemKey, state] of after) {
    const previous = before.get(itemKey) ?? GEO_V3_UNDECIDED;
    if (
      previous.decision !== state.decision ||
      canonicalGeoV2Text(previous.override) !==
        canonicalGeoV2Text(state.override)
    )
      changed.push(itemKey);
  }
  return changed;
}

export interface GeoV3ReviewStamp {
  /** The item content each decision is being recorded against, keyed by item key. */
  readonly contentHash: ReadonlyMap<string, string>;
  readonly decidedAt: string;
  /** The draft version the owner was looking at, as the contract's decimal string. */
  readonly baseDraftVersion: string;
}

/**
 * Turn a decision state map back into the review a draft stores.
 *
 * Two rules make repeated saves stable. A state that did not change keeps its
 * existing record verbatim -- re-stamping `decidedAt` on every autosave would
 * make the payload, and therefore the draft's content hash, change every 900 ms
 * even when nobody decided anything. And an item that is back to undecided has
 * no record at all, because that is exactly what "nobody decided" is stored as.
 *
 * Suppressions are kept for keys the knowledge no longer contains: an exclusion
 * has to survive the item so the next update does not hand the owner the same
 * rejected claim again. Decisions cannot do the same -- the payload parser
 * refuses a decision naming an item that is not there -- which is why the two
 * lists are separate in the first place.
 */
export function materializeGeoV3Review(
  previous: GeoReviewV3,
  states: GeoV3DecisionStates,
  stamp: GeoV3ReviewStamp,
): GeoReviewV3 {
  const before = new Map(
    previous.decisions.map((record) => [record.itemKey, record]),
  );
  const decisions: GeoReviewV3["decisions"] = [];
  for (const [itemKey, state] of states) {
    if (undecided(state)) continue;
    const existing = before.get(itemKey);
    if (
      existing !== undefined &&
      existing.decision === state.decision &&
      canonicalGeoV2Text(existing.override) ===
        canonicalGeoV2Text(state.override)
    ) {
      decisions.push(existing);
      continue;
    }
    const contentHash = stamp.contentHash.get(itemKey);
    if (contentHash === undefined)
      throw new Error("No content hash for a decided item");
    decisions.push({
      itemKey,
      decision: state.decision,
      override: state.override,
      baseContentHash: contentHash,
      decidedAt: stamp.decidedAt,
      baseDraftVersion: stamp.baseDraftVersion,
    });
  }
  const excluded = new Set(
    [...states]
      .filter(([, state]) => state.decision === "excluded")
      .map(([itemKey]) => itemKey),
  );
  const kept = previous.suppressions.filter(
    (record) => !states.has(record.itemKey) || excluded.has(record.itemKey),
  );
  const held = new Set(kept.map((record) => record.itemKey));
  const added = [...excluded]
    .filter((itemKey) => !held.has(itemKey))
    .map((itemKey) => ({ itemKey, suppressedAt: stamp.decidedAt }));
  return { decisions, suppressions: [...kept, ...added] };
}
