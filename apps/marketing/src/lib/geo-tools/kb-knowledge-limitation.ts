// @input -- the clauses one knowledge module wants to say about what it could not do
// @output -- the joined English sentence a payload stores, plus the keys a reader localizes
// @pos -- browser-safe: pure text composition, no fetch, no clock, no store
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why a limitation is now two things at once.
 *
 * `module.limitation` is a plain string composed on the server and stored in
 * the payload, and the card rendered it verbatim -- which put English sentences
 * under a Chinese 「当前限制:」 label. The fix is not for the reader to throw the
 * sentence away: every clause below carries something specific the row knows,
 * and an earlier attempt in this area replaced a set of specific explanations
 * with one generic sentence and lost exactly that.
 *
 * So the producer now says the same thing twice. `limitation` stays the English
 * sentence, byte for byte the way it always was, because a payload published
 * before today has only that and must keep rendering; `limitationKeys` carries
 * the same clauses as keys with parameters, and a reader that recognises every
 * one of them renders the reader's own language instead.
 *
 * Two rules make that safe:
 *
 *  - The key is bounded TEXT in the contract, not an enum. A key added later
 *    must not make an already-loaded bundle reject the whole payload -- an
 *    unrecognised key simply falls back to the stored sentence.
 *  - Localisation is all-or-nothing per module. A module whose clauses are
 *    half-recognised renders the stored English, because half a limitation is
 *    a limitation that has quietly dropped a clause.
 */
/**
 * Every clause a knowledge module may say about itself.
 *
 * This list is append-only. A key that has been published is stored in payloads
 * that outlive this file, so renaming one silently turns those rows back into
 * English rather than breaking a build.
 */
export const GEO_LIMITATION_KEYS = [
  /** entity: the optional public links (pricing, docs, about, changelog, faq). */
  "entity_links_not_observed",
  /** facts: generated facts dropped because their evidence did not support them. */
  "facts_withheld_unsupported",
  /** facts: every model module failed, so only declarations and observed FAQs remain. */
  "facts_without_model",
  /** facts (v1 pack): an accepted fact with no verbatim excerpt behind it. */
  "facts_missing_exact_excerpt",
  /** qa: the section holds only question-and-answer markup observed on the site. */
  "qa_without_model",
  /** evidence: groups this run never looked for. */
  "evidence_groups_not_collected",
  /** evidence: items collected but refused by the citation rules. */
  "evidence_items_unshowable",
  /** evidence: off-site pages fetched whose body could not be read. */
  "offsite_pages_unread",
  /** evidence: an off-site stage that ran out before it finished. */
  "offsite_stage_stopped",
  /** evidence (v1 pack): own-site sources read only in part. */
  "own_evidence_partial",
  /** machine: at least one of the five signals is not `present`. */
  "machine_signals_absent",
  /** machine: robots.txt was reached but not read in full. */
  "robots_not_read_in_full",
  /** machine: the site publishes no robots.txt rules at all. */
  "robots_none_published",
  /** machine: robots.txt could not be read. */
  "robots_unreadable",
  /** machine: nothing in this deployment can observe snippet permission. */
  "snippets_not_checked",
  /** coverage: at least one section is not fully covered. */
  "coverage_incomplete",
  /** any module: this update observed nothing and the owner's declaration stands. */
  "carried_owner_declared_only",
] as const;

export type GeoLimitationKey = (typeof GEO_LIMITATION_KEYS)[number];

/** Values a clause substitutes into its sentence. Flat by design: a clause is one sentence. */
export type GeoLimitationParams = Readonly<Record<string, string | number>>;

/** One clause of a module's limitation, as stored. `key` is text, not an enum -- see the header. */
export interface GeoLimitationClause {
  readonly key: string;
  readonly params?: GeoLimitationParams;
}

/**
 * The composed limitation: the sentence that is stored and the clauses behind it.
 *
 * They are produced together and must stay in step. `limitation` is bounded and
 * stops joining once it is full, so `keys` lists only the clauses that made it
 * into the sentence -- a key for a clause the reader cannot see would put a
 * sentence on the page that the stored payload never claimed.
 */
export interface GeoComposedLimitation {
  readonly limitation: string;
  readonly keys: readonly GeoLimitationClause[];
}

/** As many clauses as the longest module can say, with room to spare. */
export const GEO_LIMITATION_CLAUSES = 8;
/** Matches the bound `geoText` puts on the stored sentence. */
const LIMITATION_CODE_POINTS = 800;

// ---------------------------------------------------------------------------
// the English a payload stores
// ---------------------------------------------------------------------------

/**
 * The names this file gives to things a clause names.
 *
 * These are the ENGLISH halves of tables the card also has in every locale it
 * ships. `kb-knowledge-limitation.test.ts` renders both and asserts they agree,
 * so a sentence stored in a payload and the sentence a reader is shown say the
 * same thing rather than drifting apart.
 *
 * They exist because the sentences used to carry the raw contract token --
 * "Off-site landing_page_reads stopped early (fetch_failed)" -- which is
 * unreadable in any language.
 */
export const GEO_LIMITATION_EVIDENCE_GROUP_LABELS = {
  proof: "Product proof",
  changelog: "Product changes",
  press: "Press coverage",
  thirdPartyProfiles: "Third-party profiles",
  firstPartyProof: "First-party proof",
} as const;

export const GEO_LIMITATION_STAGE_LABELS = {
  serp: "search-result collection",
  landing_pages: "landing page fetching",
  landing_page_reads: "landing page reading",
  first_party: "first-party evidence collection",
} as const;

export const GEO_LIMITATION_REASON_LABELS = {
  not_collected: "not checked in this run",
  not_published: "nothing published there",
  not_found: "not found",
  timeout: "the read timed out",
  fetch_failed: "the read failed",
  blocked: "blocked or not allowed",
  rate_limited: "rate limited",
  invalid_response: "the response could not be validated",
  partial_body: "only part of it could be read",
  unsupported_language: "the language is not supported",
  generation_unavailable: "nothing was generated",
  outcome_unknown: "the outcome is unknown",
  insufficient_evidence: "not enough was read to tell",
  not_applicable: "it does not apply here",
  context_stale: "the saved source changed first",
  owner_excluded_all: "you excluded every item",
  owner_excluded_required: "you excluded a required field",
} as const;

function text(params: GeoLimitationParams, name: string): string {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  return typeof value === "string" ? value : "";
}

function count(params: GeoLimitationParams, name: string): number {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  return typeof value === "number" ? value : 0;
}

function label(table: Readonly<Record<string, string>>, key: string): string {
  return Object.hasOwn(table, key) ? table[key]! : key;
}

/** Comma-joined English labels for a comma-joined list of contract keys. */
function labelList(table: Readonly<Record<string, string>>, keys: string): string {
  return keys.split(",").filter((key) => key !== "").map((key) => label(table, key)).join(", ");
}

/**
 * These are the group HEADINGS the card draws below the sentence, not new
 * names for them. A sentence that said "press coverage" beside a heading that
 * said "Press coverage" would read as two different things.
 */

/**
 * The English sentence for one clause. Exhaustive over the key list, so a key
 * added without a sentence is a type error rather than an empty limitation.
 */
const ENGLISH: Readonly<Record<GeoLimitationKey, (params: GeoLimitationParams) => string>> = {
  entity_links_not_observed: () => "Some optional public links were not observed.",
  facts_withheld_unsupported: (params) =>
    `${count(params, "count")} generated fact(s) were withheld because their evidence did not support them.`,
  facts_without_model: () =>
    "Model-synthesized facts are missing: this section contains only profile declarations and observed FAQ answers.",
  facts_missing_exact_excerpt: () => "Some accepted facts lacked an exact cited evidence excerpt.",
  qa_without_model: () =>
    "Model-synthesized questions are missing: this section contains only question-and-answer markup observed on the site.",
  evidence_groups_not_collected: (params) =>
    `Not collected in this run: ${labelList(GEO_LIMITATION_EVIDENCE_GROUP_LABELS, text(params, "groups"))}.`,
  evidence_items_unshowable: (params) =>
    `${count(params, "count")} collected item(s) could not be shown with their evidence.`,
  offsite_pages_unread: (params) =>
    `${count(params, "count")} off-site page(s) were fetched but could not be read (${label(GEO_LIMITATION_REASON_LABELS, text(params, "reason"))}).`,
  offsite_stage_stopped: (params) =>
    `Off-site ${label(GEO_LIMITATION_STAGE_LABELS, text(params, "stage"))} stopped early (${label(GEO_LIMITATION_REASON_LABELS, text(params, "reason"))}), ${count(params, "count")} item(s) not reached.`,
  own_evidence_partial: () => "Some collected own-site evidence is partial.",
  machine_signals_absent: () => "Some machine-readable visibility signals were absent or unavailable.",
  robots_not_read_in_full: () =>
    "AI crawler permissions were not determined: robots.txt was not read in full.",
  robots_none_published: () =>
    "AI crawler permissions were not determined: this site publishes no robots.txt rules.",
  robots_unreadable: () =>
    "AI crawler permissions were not determined: robots.txt could not be read.",
  snippets_not_checked: () => "Snippet permission was not checked.",
  coverage_incomplete: () => "Some customer knowledge sections are incomplete.",
  carried_owner_declared_only: () =>
    "This update observed nothing for this section. What remains is what the owner declared.",
};

/** The English sentence one clause stores, for callers that need it on its own. */
export function geoLimitationEnglish(key: GeoLimitationKey, params: GeoLimitationParams = {}): string {
  return ENGLISH[key](params);
}

/**
 * Sentences, joined while they fit, with the keys that made it in.
 *
 * A truncated sentence would misstate the limit, so a clause that does not fit
 * whole ends the join -- and every clause after it is dropped from both halves.
 */
export function geoComposeLimitation(
  clauses: readonly { readonly key: GeoLimitationKey; readonly params?: GeoLimitationParams }[],
): GeoComposedLimitation {
  let joined = "";
  const keys: GeoLimitationClause[] = [];
  for (const clause of clauses.slice(0, GEO_LIMITATION_CLAUSES)) {
    const sentence = geoLimitationEnglish(clause.key, clause.params ?? {});
    const candidate = joined === "" ? sentence : `${joined} ${sentence}`;
    if (Array.from(candidate).length > LIMITATION_CODE_POINTS) break;
    joined = candidate;
    keys.push(clause.params === undefined ? { key: clause.key } : { key: clause.key, params: clause.params });
  }
  return { limitation: joined, keys };
}

/**
 * The two fields a `partial` module carries, from one list of clauses.
 *
 * Producers spread this so the sentence and its keys can never be written apart.
 */
export function geoPartialLimitation(
  clauses: readonly { readonly key: GeoLimitationKey; readonly params?: GeoLimitationParams }[],
): { readonly limitation: string; readonly limitationKeys: GeoLimitationClause[] } {
  const composed = geoComposeLimitation(clauses);
  return { limitation: composed.limitation, limitationKeys: [...composed.keys] };
}
