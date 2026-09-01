// @input  -- whatever the four knowledge-base endpoints put in `data`
// @output -- the same value narrowed to a shape the editor can render, or null
// @pos    -- the editor's only door for wire data; nothing above it casts a response

import {
  GEO_KB_SCHEMA_VERSION,
  type GeoKbBlocker,
  type GeoKbCompetitor,
  type GeoKbFact,
  type GeoKbPayload,
  type GeoKbRole,
} from "../../lib/geo-tools/kb-contract.ts";
import { parseWebsiteProfileReference, parseMarketingWebsiteProfile } from "../../lib/account-websites/contracts.ts";
import { parseGeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import type { GeoInheritedProfile } from "../../lib/geo-tools/asset-context.ts";

export interface GeoKbFrozenSummary {
  readonly payload?: GeoKbPayload;
  readonly snapshotId: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly contentHash: string;
  readonly questionCount: number;
  readonly retrievalCount: number;
  readonly questionSetHash?: string;
  readonly registryVersion?: string;
  readonly questions?: readonly GeoKbQuestionPreview[];
  readonly skippedLayers?: readonly ("problem" | "evaluation")[];
}

export interface GeoKbSourcePreview {
  readonly skippedLayers: readonly ("problem" | "evaluation")[];
  readonly questionSetHash: string;
  readonly contentHash: string;
}

export interface GeoKbQuestionPreview {
  readonly id: string;
  readonly text: string;
  readonly layer: string;
  readonly mode: "retrieval" | "demand";
  readonly calibrated: boolean;
  readonly roleId?: string | null;
  readonly requiredEntities?: readonly string[];
  readonly templateId?: string | null;
}

export interface GeoKbView {
  readonly kbId: string;
  /** The origin the record is keyed on, which is not always the one typed in. */
  readonly origin: string;
  readonly host: string;
  readonly draftVersion: number;
  readonly payload: GeoKbPayload;
  readonly frozen: GeoKbFrozenSummary | null;
  readonly importAvailable: boolean;
  readonly profile?: GeoInheritedProfile | null;
  readonly context?: GeoKbSourcePreview;
}

export interface GeoKbSaveResponse {
  readonly draftVersion: number;
  readonly updatedAt: string;
  readonly blockers: readonly GeoKbBlocker[];
  readonly context?: GeoKbSourcePreview;
}

export interface GeoKbFreezeResponse extends GeoKbFrozenSummary {
  readonly reusedExisting: boolean;
  readonly questions: readonly GeoKbQuestionPreview[];
  readonly context?: GeoKbSourcePreview;
}

/**
 * Every blocker code the editor has a sentence for.
 *
 * A code from outside this set is not a smaller problem than a missing field:
 * `t()` renders an unknown key as its own path, so an unrecognised blocker
 * would print `freeze.blockers.something` on the page as if it were advice.
 */
const BLOCKER_CODES: ReadonlySet<string> = new Set<GeoKbBlocker>([
  "official_name_missing",
  "aliases_missing",
  "alias_too_short",
  "category_terms_missing",
  "no_confirmed_competitor",
  "role_missing",
  "unsupported_language",
]);

/** Same reason: the preview prints `questions.layers.<layer>`. */
const QUESTION_LAYERS: ReadonlySet<string> = new Set([
  "problem",
  "discovery",
  "comparison",
  "evaluation",
  "branded",
]);

const FACT_REASONS: ReadonlySet<string> = new Set([
  "",
  "notPublished",
  "fetchFailed",
  "lowConfidence",
  "conflicting",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isRole(value: unknown): value is GeoKbRole {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["label"] === "string" &&
    typeof value["segment"] === "string" &&
    isStringArray(value["painPoints"]) &&
    isStringArray(value["decisionCriteria"]) &&
    isStringArray(value["vocabulary"])
  );
}

function isCompetitor(value: unknown): value is GeoKbCompetitor {
  if (!isRecord(value)) return false;
  return (
    typeof value["domain"] === "string" &&
    typeof value["brandName"] === "string" &&
    typeof value["confirmed"] === "boolean" &&
    (value["aliases"] === undefined || isStringArray(value["aliases"]))
  );
}

function isFact(value: unknown): value is GeoKbFact {
  if (!isRecord(value)) return false;
  return (
    typeof value["key"] === "string" &&
    typeof value["value"] === "string" &&
    typeof value["reason"] === "string" &&
    FACT_REASONS.has(value["reason"]) &&
    typeof value["sourceUrl"] === "string" &&
    typeof value["observedAt"] === "string"
  );
}

/**
 * The payload as the editor binds it to inputs.
 *
 * Not `parseGeoKbPayload`: that one is the write contract, it runs on Node's
 * `Buffer`, and it rejects a legitimately unfinished draft. What the editor
 * needs is narrower and different - every field it is about to `.map()` over or
 * put in a `value=` exists and has the type it says.
 */
export function isGeoKbPayload(value: unknown): value is GeoKbPayload {
  if (!isRecord(value)) return false;
  if (value["profileCopy"] !== undefined) {
    try { parseGeoProfileCopy(value["profileCopy"]); } catch { return false; }
  }
  const market = value["market"];
  return (
    value["schemaVersion"] === GEO_KB_SCHEMA_VERSION &&
    typeof value["targetUrl"] === "string" &&
    typeof value["officialName"] === "string" &&
    isStringArray(value["aliases"]) &&
    isStringArray(value["categoryTerms"]) &&
    isRecord(market) &&
    typeof market["country"] === "string" &&
    typeof market["language"] === "string" &&
    Array.isArray(value["roles"]) &&
    value["roles"].every(isRole) &&
    Array.isArray(value["competitors"]) &&
    value["competitors"].every(isCompetitor) &&
    Array.isArray(value["facts"]) &&
    value["facts"].every(isFact) &&
    (value["importedFrom"] === null || isRecord(value["importedFrom"]))
  );
}

export function isFrozen(value: unknown): value is GeoKbFrozenSummary {
  if (!isRecord(value)) return false;
  return (
    (value["payload"] === undefined || isGeoKbPayload(value["payload"])) &&
    typeof value["snapshotId"] === "string" &&
    typeof value["revision"] === "number" &&
    typeof value["frozenAt"] === "string" &&
    typeof value["contentHash"] === "string" &&
    typeof value["questionCount"] === "number" &&
    typeof value["retrievalCount"] === "number" &&
    (value["questionSetHash"] === undefined || isHash(value["questionSetHash"])) &&
    (value["registryVersion"] === undefined || typeof value["registryVersion"] === "string") &&
    (value["questions"] === undefined || (Array.isArray(value["questions"]) && value["questions"].every(isQuestion))) &&
    (value["skippedLayers"] === undefined || isSkippedLayers(value["skippedLayers"]))
  );
}

export function isGeoKbView(value: unknown): value is GeoKbView {
  if (!isRecord(value)) return false;
  const frozen = value["frozen"];
  return (
    typeof value["kbId"] === "string" &&
    typeof value["origin"] === "string" &&
    typeof value["host"] === "string" &&
    typeof value["draftVersion"] === "number" &&
    Number.isSafeInteger(value["draftVersion"]) &&
    typeof value["importAvailable"] === "boolean" &&
    isGeoKbPayload(value["payload"]) &&
    (frozen === null || isFrozen(frozen)) &&
    (value["profile"] === undefined || value["profile"] === null || isInheritedProfile(value["profile"])) &&
    (value["context"] === undefined || isSourcePreview(value["context"]))
  );
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function isSkippedLayers(value: unknown): value is readonly ("problem" | "evaluation")[] {
  return Array.isArray(value) && value.length <= 2 && new Set(value).size === value.length &&
    value.every((layer) => layer === "problem" || layer === "evaluation");
}
function isSourcePreview(value: unknown): value is GeoKbSourcePreview {
  return isRecord(value) && isSkippedLayers(value["skippedLayers"]) && isHash(value["questionSetHash"]) && isHash(value["contentHash"]);
}

export function isInheritedProfile(value: unknown): value is GeoInheritedProfile {
  if (!isRecord(value) || typeof value["productName"] !== "string" ||
      typeof value["oneLinePositioning"] !== "string" ||
      !isStringArray(value["coreFeatures"]) || !isRecord(value["market"]) ||
      typeof value["market"]["country"] !== "string" ||
      typeof value["market"]["language"] !== "string") return false;
  try {
    parseWebsiteProfileReference(value["reference"]);
    if (value["fullProfile"] !== undefined) parseMarketingWebsiteProfile(value["fullProfile"]);
    return true;
  } catch {
    return false;
  }
}

export function isGeoKbBlockers(
  value: unknown,
): value is readonly GeoKbBlocker[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && BLOCKER_CODES.has(entry))
  );
}

export function isGeoKbSaveResponse(
  value: unknown,
): value is GeoKbSaveResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value["draftVersion"] === "number" &&
    Number.isSafeInteger(value["draftVersion"]) &&
    typeof value["updatedAt"] === "string" &&
    isGeoKbBlockers(value["blockers"]) &&
    (value["context"] === undefined || isSourcePreview(value["context"]))
  );
}

function isQuestion(value: unknown): value is GeoKbQuestionPreview {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["layer"] === "string" &&
    QUESTION_LAYERS.has(value["layer"]) &&
    (value["mode"] === "retrieval" || value["mode"] === "demand") &&
    typeof value["calibrated"] === "boolean" &&
    (value["roleId"] === undefined || value["roleId"] === null || typeof value["roleId"] === "string") &&
    (value["requiredEntities"] === undefined || isStringArray(value["requiredEntities"])) &&
    (value["templateId"] === undefined || value["templateId"] === null || typeof value["templateId"] === "string")
  );
}

export function isGeoKbFreezeResponse(
  value: unknown,
): value is GeoKbFreezeResponse {
  if (!isFrozen(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    typeof record["reusedExisting"] === "boolean" &&
    Array.isArray(record["questions"]) &&
    record["questions"].every(isQuestion) &&
    (record["context"] === undefined || isSourcePreview(record["context"]))
  );
}

export function isGeoKbImportResponse(
  value: unknown,
): value is { readonly payload: GeoKbPayload } {
  return isRecord(value) && isGeoKbPayload(value["payload"]);
}
