import type { DiagnosticContext, UrlObservationProjection } from "./context.ts";
import { canonicalize, type CanonicalValue } from "./util/hash.ts";

export type FindingTargetRelation =
  | "direct_url"
  | "affected_by_template"
  | "affected_by_site"
  | "affected_by_page_set"
  | "affected_by_http_status"
  | "affected_by_canonical_issue"
  | "affected_by_keyword_cluster"
  | "affected_by_user_agent";

export type FindingTargetKind =
  | "url"
  | "template"
  | "site"
  | "page_set"
  | "http_status"
  | "canonical_issue"
  | "keyword_cluster"
  | "user_agent";

export type FindingTargetDefinition =
  | { readonly relation: "direct_url"; readonly targetKind: "url" }
  | {
      readonly relation: "affected_by_template";
      readonly targetKind: "template";
    }
  | { readonly relation: "affected_by_site"; readonly targetKind: "site" }
  | {
      readonly relation: "affected_by_page_set";
      readonly targetKind: "page_set";
    }
  | {
      readonly relation: "affected_by_http_status";
      readonly targetKind: "http_status";
    }
  | {
      readonly relation: "affected_by_canonical_issue";
      readonly targetKind: "canonical_issue";
    }
  | {
      readonly relation: "affected_by_keyword_cluster";
      readonly targetKind: "keyword_cluster";
    }
  | {
      readonly relation: "affected_by_user_agent";
      readonly targetKind: "user_agent";
    };

export interface ResolvedFindingTargetMember {
  readonly resolutionState: "resolved";
  readonly basisKind: "crawl_exact_fetch" | "observation_site_page";
  readonly observationId: string;
  readonly snapshotId: string;
  readonly sitePageId: string;
  readonly sitePageUrl: string;
  readonly pageSnapshotId: string | null;
  readonly memberRef: string;
}

export interface UnresolvedFindingTargetMember {
  readonly resolutionState: "unresolved";
  readonly basisKind: "unresolved_observation";
  readonly observationId: string;
  readonly snapshotId: string;
  readonly memberRef: string;
  readonly limitation: string;
}

export type FindingTargetMember =
  | ResolvedFindingTargetMember
  | UnresolvedFindingTargetMember;

export type FindingTargetDraftV1 = FindingTargetDefinition & {
  readonly version: 1;
  readonly targetRef: string;
  readonly members: readonly FindingTargetMember[];
};

export type FindingTargetDraft = FindingTargetDraftV1;

/**
 * Construction intent is deliberately not serialized. It exists at the
 * runtime boundary so an empty definition cannot be mistaken for an exact
 * observation-backed aggregate (notably the overloaded page_set relation).
 */
export type FindingTargetConstructionMode =
  | "observation_members"
  | "target_definition";

export type AnalyticsTargetResolution =
  | {
      readonly status: "available";
      readonly targetRef: string;
      readonly member: FindingTargetMember;
    }
  | { readonly status: "missing_lineage" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTTP_STATUS_PATTERN = /^[1-5][0-9]{2}$/;
const MAX_URL_LENGTH = 2_048;
const MAX_LABEL_LENGTH = 500;
const MAX_LIMITATION_LENGTH = 2_000;
const UNRESOLVED_ANALYTICS_LIMITATION =
  "The frozen URL observation has no unambiguous persisted SitePage lineage; URL membership remains unresolved.";

/**
 * Construct the versioned target vocabulary used by every rule. This is a
 * runtime boundary as well as a TypeScript type: an invalid relation/kind pair,
 * unbounded ref, duplicate member, or malformed immutable ID fails closed.
 */
export function findingTarget(
  definition: FindingTargetDefinition,
  targetRef: string,
  members: readonly FindingTargetMember[],
  mode: FindingTargetConstructionMode,
): FindingTargetDraft {
  validateTargetRef(definition, targetRef);
  const orderedMembers = [...members].sort(compareMembers);
  const memberKeys = orderedMembers.map((member) =>
    canonicalize(member as unknown as CanonicalValue),
  );
  if (new Set(memberKeys).size !== memberKeys.length) {
    throw new Error("Duplicate finding target member");
  }
  for (const member of orderedMembers) validateMember(member);
  validateConstructionShape(definition, targetRef, orderedMembers, mode);
  return {
    version: 1,
    ...definition,
    targetRef,
    members: Object.freeze(orderedMembers),
  } as FindingTargetDraft;
}

function validateConstructionShape(
  definition: FindingTargetDefinition,
  targetRef: string,
  members: readonly FindingTargetMember[],
  mode: FindingTargetConstructionMode,
): void {
  if (definition.relation === "direct_url") {
    if (mode !== "observation_members") {
      throw new Error("A direct URL finding target requires observation membership");
    }
    if (members.length !== 1) {
      throw new Error("A direct URL finding target requires exactly one member");
    }
    const member = members[0];
    const authoritativeRef =
      member?.resolutionState === "resolved"
        ? member.sitePageUrl
        : member?.memberRef;
    if (authoritativeRef !== targetRef) {
      throw new Error(
        "A direct URL finding targetRef must match its explicit member",
      );
    }
    return;
  }

  if (mode === "target_definition") {
    if (members.length !== 0) {
      throw new Error("A target definition cannot contain observation members");
    }
    if (
      definition.relation === "affected_by_keyword_cluster" ||
      definition.relation === "affected_by_user_agent"
    ) {
      return;
    }
    if (definition.relation === "affected_by_page_set") {
      if (!/^(?:offer|use_case):[a-z0-9][a-z0-9-]*$/.test(targetRef)) {
        throw new Error(
          "An empty page-set target must be a content coverage definition",
        );
      }
      return;
    }
    throw new Error(
      "This finding relation requires non-empty exact Crawl membership",
    );
  }

  if (mode !== "observation_members") {
    throw new Error("Unknown finding target construction mode");
  }
  if (members.length === 0) {
    throw new Error(
      "This finding relation requires non-empty exact Crawl membership",
    );
  }
  if (
    definition.relation === "affected_by_keyword_cluster" ||
    definition.relation === "affected_by_user_agent"
  ) {
    throw new Error("This finding relation is a definition-only target");
  }
  for (const member of members) {
    if (member.resolutionState === "unresolved") {
      throw new Error("Only direct URL finding targets may remain unresolved");
    }
    if (member.basisKind !== "crawl_exact_fetch") {
      throw new Error(
        "An exact aggregate finding target requires exact Crawl members",
      );
    }
  }
}

/** Exact crawl transport identities must resolve to exact persisted SitePages. */
export function crawlTargetMembers(
  ctx: DiagnosticContext,
  fetchUrls: readonly string[],
): readonly ResolvedFindingTargetMember[] | null {
  const members: ResolvedFindingTargetMember[] = [];
  for (const fetchUrl of [...new Set(fetchUrls)].sort(compareAscii)) {
    const observation = ctx.crawlObservationForFetchUrl(fetchUrl);
    if (
      observation === null ||
      observation.sitePageId === null ||
      observation.sitePageUrl === null ||
      observation.pageSnapshotId === null ||
      observation.sitePageUrl !== fetchUrl
    ) {
      return null;
    }
    members.push({
      resolutionState: "resolved",
      basisKind: "crawl_exact_fetch",
      observationId: observation.observationId,
      snapshotId: observation.snapshotId,
      sitePageId: observation.sitePageId,
      sitePageUrl: observation.sitePageUrl,
      pageSnapshotId: observation.pageSnapshotId,
      memberRef: fetchUrl,
    });
  }
  return members;
}

/**
 * Analytics URL observations bind only through their persisted SitePage FK.
 * A deliberate null/null is explicit unresolved lineage; a half-populated pair
 * is corrupt/missing lineage and must make the rule inconclusive.
 */
export function analyticsTargetResolution<T>(
  observation: UrlObservationProjection<T> | null,
): AnalyticsTargetResolution {
  if (observation === null) return { status: "missing_lineage" };
  if (observation.sitePageId === null && observation.sitePageUrl === null) {
    return {
      status: "available",
      targetRef: observation.subjectRef,
      member: {
        resolutionState: "unresolved",
        basisKind: "unresolved_observation",
        observationId: observation.observationId,
        snapshotId: observation.snapshotId,
        memberRef: observation.subjectRef,
        limitation: UNRESOLVED_ANALYTICS_LIMITATION,
      },
    };
  }
  if (observation.sitePageId === null || observation.sitePageUrl === null) {
    return { status: "missing_lineage" };
  }
  return {
    status: "available",
    targetRef: observation.sitePageUrl,
    member: {
      resolutionState: "resolved",
      basisKind: "observation_site_page",
      observationId: observation.observationId,
      snapshotId: observation.snapshotId,
      sitePageId: observation.sitePageId,
      sitePageUrl: observation.sitePageUrl,
      pageSnapshotId: observation.pageSnapshotId,
      // Immutable observation identity stays canonical even when its resolved
      // SitePage preserves an exact slash variant. The parent targetRef is the
      // exact SitePage URL used by the user-facing direct relation.
      memberRef: observation.subjectRef,
    },
  };
}

export function findingTargetsEqual(
  left: FindingTargetDraft,
  right: FindingTargetDraft,
): boolean {
  return (
    canonicalize(left as unknown as CanonicalValue) ===
    canonicalize(right as unknown as CanonicalValue)
  );
}

function validateTargetRef(
  definition: FindingTargetDefinition,
  targetRef: string,
): void {
  if (targetRef.trim() !== targetRef || targetRef.length === 0) {
    throw new Error("Finding targetRef must be non-empty and trimmed");
  }
  if (definition.relation === "direct_url") {
    validateUrl(targetRef, "Finding direct targetRef");
    return;
  }
  if (definition.relation === "affected_by_http_status") {
    if (!HTTP_STATUS_PATTERN.test(targetRef)) {
      throw new Error("Finding HTTP targetRef must be a three-digit status");
    }
    return;
  }
  if (targetRef.length > MAX_LABEL_LENGTH) {
    throw new Error("Finding targetRef exceeds 500 characters");
  }
}

function validateMember(member: FindingTargetMember): void {
  validateUuid(member.observationId, "observationId");
  validateUuid(member.snapshotId, "snapshotId");
  if (
    member.memberRef.trim() !== member.memberRef ||
    member.memberRef.length === 0
  ) {
    throw new Error("Finding target memberRef must be non-empty and trimmed");
  }
  if (member.memberRef.length > MAX_URL_LENGTH) {
    throw new Error("Finding target memberRef exceeds 2048 characters");
  }
  if (member.resolutionState === "unresolved") {
    if (
      member.limitation.trim() !== member.limitation ||
      member.limitation.length === 0 ||
      member.limitation.length > MAX_LIMITATION_LENGTH
    ) {
      throw new Error(
        "Unresolved finding target member requires a bounded limitation",
      );
    }
    return;
  }
  validateUuid(member.sitePageId, "sitePageId");
  validateUrl(member.sitePageUrl, "sitePageUrl");
  if (member.pageSnapshotId !== null) {
    validateUuid(member.pageSnapshotId, "pageSnapshotId");
  }
  if (
    member.basisKind === "crawl_exact_fetch" &&
    (member.memberRef !== member.sitePageUrl ||
      member.pageSnapshotId === null)
  ) {
    throw new Error(
      "Exact crawl target member must match its SitePage URL and frozen PageSnapshot",
    );
  }
}

function validateUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Finding target ${field} must be a UUID`);
  }
}

function validateUrl(value: string, field: string): void {
  if (value.length > MAX_URL_LENGTH) {
    throw new Error(`${field} exceeds 2048 characters`);
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${field} must be an HTTP(S) URL`);
  }
}

function compareMembers(
  left: FindingTargetMember,
  right: FindingTargetMember,
): number {
  return (
    compareAscii(left.memberRef, right.memberRef) ||
    compareAscii(left.observationId, right.observationId) ||
    compareAscii(left.snapshotId, right.snapshotId)
  );
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
