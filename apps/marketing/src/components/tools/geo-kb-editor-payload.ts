// @input  -- the payload as the editor holds it, half-typed rows and all
// @output -- what may be sent, plus the rows the write contract would refuse
// @pos    -- between the editor and the draft endpoint; it narrows, it never relaxes

import type {
  GeoKbCompetitor,
  GeoKbFact,
  GeoKbPayload,
  GeoKbRole,
} from "../../lib/geo-tools/kb-contract.ts";

/**
 * What is wrong with one row, in the words the contract refuses it for.
 *
 * One code per row rather than a list: the row shows one sentence, and a row
 * with two problems still only needs the visitor to start somewhere.
 */
export type GeoKbRowIssue =
  | "duplicate"
  | "confirmNeedsName"
  | "keyMissing"
  | "reasonMissing"
  | "sourceMissing";

export interface GeoKbRowIssues {
  readonly competitors: ReadonlyMap<number, GeoKbRowIssue>;
  readonly facts: ReadonlyMap<number, GeoKbRowIssue>;
}

/**
 * A row the visitor added and has not typed into yet.
 *
 * `parseGeoKbPayload` refuses one - correctly, it is not a competitor - and it
 * refuses the whole payload with it, so an untouched row added two minutes ago
 * takes every other edit in the same save down with it. Dropping it on the way
 * out loses nothing: there is nothing in it.
 */
export function isBlankCompetitor(row: GeoKbCompetitor): boolean {
  return row.domain.trim().length === 0 && row.brandName.trim().length === 0;
}

export function isBlankFact(row: GeoKbFact): boolean {
  return (
    row.key.trim().length === 0 &&
    row.value.trim().length === 0 &&
    row.reason.length === 0 &&
    row.sourceUrl.trim().length === 0 &&
    row.observedAt.trim().length === 0
  );
}

/** `cleanList`'s rule, on this side of the wire: trimmed, no blanks, no repeats. */
function cleanList(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function submitRole(role: GeoKbRole): GeoKbRole {
  return {
    id: role.id.trim(),
    label: role.label.trim(),
    segment: role.segment.trim(),
    painPoints: cleanList(role.painPoints),
    decisionCriteria: cleanList(role.decisionCriteria),
    vocabulary: cleanList(role.vocabulary),
  };
}

/**
 * The payload as it goes on the wire.
 *
 * Trimmed the way the contract trims, blank rows dropped. It deliberately does
 * NOT fill anything in: a row with a competitor's domain but no name still
 * goes, is still refused, and is reported next to that row - inventing a name
 * to get past the check is the one thing this must never do.
 */
export function geoKbSubmission(payload: GeoKbPayload): GeoKbPayload {
  return {
    ...payload,
    targetUrl: payload.targetUrl.trim(),
    officialName: payload.officialName.trim(),
    aliases: cleanList(payload.aliases),
    categoryTerms: cleanList(payload.categoryTerms),
    roles: payload.roles.map(submitRole),
    competitors: payload.competitors
      .filter((row) => !isBlankCompetitor(row))
      .map((row) => ({
        domain: row.domain.trim().toLowerCase(),
        brandName: row.brandName.trim(),
        confirmed: row.confirmed,
        ...(row.aliases === undefined ? {} : { aliases: cleanList(row.aliases) }),
      })),
    facts: payload.facts
      .filter((row) => !isBlankFact(row))
      .map((row) => ({
        key: row.key.trim(),
        value: row.value.trim(),
        reason: row.reason,
        sourceUrl: row.sourceUrl.trim(),
        observedAt: row.observedAt.trim(),
      })),
  };
}

/**
 * The rows `parseGeoKbPayload` would refuse, by their index in the editor.
 *
 * Indexed against the payload the editor is rendering, not against the
 * submission: the submission has already dropped the blank rows, and an index
 * that points at a different row than the visitor is looking at is worse than
 * no index at all.
 *
 * The rules here are the write contract's own, restated where the row can be
 * pointed at. If the contract changes, this disagrees with it and the save is
 * refused with the field name - which is the failure mode worth having.
 */
export function geoKbRowIssues(payload: GeoKbPayload): GeoKbRowIssues {
  const competitors = new Map<number, GeoKbRowIssue>();
  const seenCompetitors = new Set<string>();
  payload.competitors.forEach((row, index) => {
    if (isBlankCompetitor(row)) return;
    const domain = row.domain.trim().toLowerCase();
    const brandName = row.brandName.trim();
    if (row.confirmed && brandName.length === 0) {
      competitors.set(index, "confirmNeedsName");
      return;
    }
    const key =
      domain.length > 0 ? `d:${domain}` : `n:${brandName.toLowerCase()}`;
    if (seenCompetitors.has(key)) {
      competitors.set(index, "duplicate");
      return;
    }
    seenCompetitors.add(key);
  });

  const facts = new Map<number, GeoKbRowIssue>();
  const seenFacts = new Set<string>();
  payload.facts.forEach((row, index) => {
    if (isBlankFact(row)) return;
    const key = row.key.trim();
    if (key.length === 0) {
      facts.set(index, "keyMissing");
      return;
    }
    if (seenFacts.has(key)) {
      facts.set(index, "duplicate");
      return;
    }
    seenFacts.add(key);
    // The two halves of the honesty rule, said where the row is: a value has
    // to name a source, and an empty value has to say why it is empty.
    if (row.value.trim().length > 0 && row.sourceUrl.trim().length === 0) {
      facts.set(index, "sourceMissing");
      return;
    }
    if (row.value.trim().length === 0 && row.reason.length === 0) {
      facts.set(index, "reasonMissing");
    }
  });

  return { competitors, facts };
}

export function hasGeoKbRowIssues(issues: GeoKbRowIssues): boolean {
  return issues.competitors.size > 0 || issues.facts.size > 0;
}
