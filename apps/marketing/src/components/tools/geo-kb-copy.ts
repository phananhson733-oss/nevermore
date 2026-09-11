// @input  -- the `tools.geoKnowledgeBase.card` catalog, through next-intl
// @output -- one typed copy object for every GEO knowledge base card component
// @pos    -- copy only: no fetch, no state, no server module; values imported only from the client-safe wire
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * Why the copy lives here rather than inside the components.
 *
 * The card this replaces held its customer sentences as two inline object
 * literals chosen by `locale.startsWith("zh")`, which put shipped copy outside
 * the catalog: it could not be reviewed, could not be reused by a second
 * component, and left three catalog keys orphaned behind it. Everything the
 * redesign adds -- origins, decisions, module states, publish wording -- goes
 * through next-intl instead, and this module is the one place that knows which
 * key answers which contract value.
 *
 * Mapping the contract enums here, once, is deliberate: a component that
 * reached for `t("decisions." + decision)` would silently render the key path
 * for a value nobody added a key for, because next-intl does not throw on a
 * missing key. `accepted_in_bulk` is the reason the map is not the identity --
 * it is a retired label that only pre-2026-09-09 drafts carry, and it reads as
 * `accepted` because that is what the Owner ruled it means.
 */
import { useTranslations } from "next-intl";

import type { GeoDecision } from "../../lib/geo-tools/kb-v3-contract.ts";
import {
  GEO_LIMITATION_EVIDENCE_GROUP_LABELS,
  GEO_LIMITATION_KEYS,
  GEO_LIMITATION_REASON_LABELS,
  GEO_LIMITATION_STAGE_LABELS,
  type GeoLimitationClause,
  type GeoLimitationKey,
  type GeoLimitationParams,
} from "../../lib/geo-tools/kb-knowledge-limitation.ts";
import { GEO_ENTITY_FIELD_PATHS } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import {
  GEO_KB_V3_COMPETITOR_IDENTITY_METHODS,
  GEO_KB_V3_COMPETITOR_IDENTITY_REASONS,
  type GeoKbV3CompetitorIdentityMethod,
  type GeoKbV3CompetitorIdentityReason,
} from "./geo-kb-v3-wire.ts";
import type {
  GeoEntityFieldPath,
  GeoItemOrigin,
  GeoUnavailableReason,
} from "../../lib/geo-tools/kb-knowledge-shape.ts";

/** How independent a piece of evidence is of the brand that it describes. */
export type GeoKbIndependence =
  | "first_party"
  | "independent"
  | "self_submitted"
  | "syndicated"
  | "undetermined";

export type GeoKbCrawlerAccess = "allowed" | "disallowed" | "unspecified";
export type GeoKbSnippetStatus = "allowed" | "blocked" | "not_checked";

/**
 * The knowledge-base-level states the status line can be in. `state` carries
 * the sentences the shipped card already used; `status` carries the ones the
 * published/draft model adds.
 */
export type GeoKbStateKey =
  | "failed"
  | "failedEmpty"
  | "pending"
  | "running"
  | "current"
  | "empty"
  | "stale"
  | "check"
  | "oldCheck"
  | "unknown"
  | "retry"
  | "retryHelp"
  | "newInput"
  | "newInputHelp"
  | "sourceChanged"
  | "invalid"
  | "error";

const STATE_KEYS: readonly GeoKbStateKey[] = [
  "failed", "failedEmpty", "pending", "running", "current", "empty", "stale",
  "check", "oldCheck", "unknown", "retry", "retryHelp", "newInput",
  "newInputHelp", "sourceChanged", "invalid", "error",
];

/**
 * Contract value to catalog key. `accepted_in_bulk` maps to its own label and
 * never to `accepted` -- a batch gesture must not let the same model output
 * claim the stronger word.
 */
const DECISION_KEYS: Readonly<Record<GeoDecision, string>> = {
  pending: "pending",
  accepted: "accepted",
  accepted_in_bulk: "accepted",
  excluded: "excluded",
};

const ORIGINS: readonly GeoItemOrigin[] = [
  "observed_own", "observed_competitor", "observed_third_party", "observed_gsc",
  "declared_profile", "declared_owner", "synthesized",
];

const INDEPENDENCE: readonly GeoKbIndependence[] = [
  "first_party", "independent", "self_submitted", "syndicated", "undetermined",
];

/**
 * A `partial` module's limitation, said in the reader's language.
 *
 * The producer stores both halves: `limitation`, the English sentence, and
 * `limitationKeys`, the same clauses as keys. This turns the keys into
 * sentences -- and returns `null` the moment one clause cannot be turned into
 * one, so the caller falls back to the stored sentence.
 *
 * All-or-nothing is the whole point. Rendering the clauses this build happens
 * to know and silently dropping the rest would publish a limitation shorter
 * than the one the payload actually claims: the reader would be told about two
 * problems out of three and have no way to know a third existed.
 */
const LIMITATION_KEY_SET: Readonly<Record<string, true>> = Object.fromEntries(
  GEO_LIMITATION_KEYS.map((key) => [key, true]),
);

/** Contract keys a clause parameter may name, with the table that localizes each. */
const EVIDENCE_GROUP_KEYS = Object.keys(GEO_LIMITATION_EVIDENCE_GROUP_LABELS) as readonly string[];
const STAGE_KEYS = Object.keys(GEO_LIMITATION_STAGE_LABELS) as readonly string[];
const REASON_KEYS = Object.keys(GEO_LIMITATION_REASON_LABELS) as readonly string[];

/** Sentences are joined the way the stored English joins them. */
const LIMITATION_JOIN = " ";

const COMPETITOR_REASONS = new Set<string>(GEO_KB_V3_COMPETITOR_IDENTITY_REASONS);
/** The refusal codes the competitor route sends that have a sentence of their own. */
const COMPETITOR_FAILURES = new Set<string>(["conflict", "input_changed", "generation_running", "rate_limited", "auth_required"]);

interface LimitationTables {
  readonly groups: Readonly<Record<string, string>>;
  readonly stages: Readonly<Record<string, string>>;
  readonly reasons: Readonly<Record<string, string>>;
  readonly separator: string;
}

type LimitationValues = Record<string, string | number>;

/**
 * Exactly the parameters each clause substitutes.
 *
 * Checked as a SET, both ways: a clause carrying a name this build does not
 * substitute is a clause written by a build that says more than this one can
 * render. `snippets_not_checked` with a `reason` parameter is the case that
 * matters -- the stored sentence would carry the reason and a recovery action,
 * and rendering the parameterless Chinese would drop both while still claiming
 * to be the whole limitation.
 */
const LIMITATION_PARAM_NAMES: Readonly<Record<GeoLimitationKey, readonly string[]>> = {
  entity_links_not_observed: [],
  facts_without_model: [],
  facts_missing_exact_excerpt: [],
  qa_without_model: [],
  own_evidence_partial: [],
  machine_signals_absent: [],
  robots_not_read_in_full: [],
  robots_none_published: [],
  robots_unreadable: [],
  snippets_not_checked: [],
  coverage_incomplete: [],
  carried_owner_declared_only: [],
  facts_withheld_unsupported: ["count"],
  evidence_items_unshowable: ["count"],
  evidence_groups_not_collected: ["groups"],
  offsite_pages_unread: ["count", "reason"],
  offsite_stage_stopped: ["count", "reason", "stage"],
};

/** Own names only: `params` is stored data, and inherited names are not its own. */
function paramsMatch(key: GeoLimitationKey, params: GeoLimitationParams): boolean {
  const expected = LIMITATION_PARAM_NAMES[key];
  const present = Object.getOwnPropertyNames(params);
  return present.length === expected.length && expected.every((name) => Object.hasOwn(params, name));
}

// `Object.hasOwn`, not a plain index: `params` is stored data and the contract
// bounds the NAME but a reader must still never reach `Object.prototype`.
function readCount(params: GeoLimitationParams, name: string): number | null {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readLabel(
  params: GeoLimitationParams,
  name: string,
  known: readonly string[],
  table: Readonly<Record<string, string>>,
): string | null {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  if (typeof value !== "string" || !known.includes(value) || !Object.hasOwn(table, value)) return null;
  return table[value]!;
}

function readLabelList(
  params: GeoLimitationParams,
  name: string,
  tables: LimitationTables,
): string | null {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  if (typeof value !== "string") return null;
  const keys = value.split(",");
  if (keys.length === 0 || keys.some((key) => !EVIDENCE_GROUP_KEYS.includes(key) || !Object.hasOwn(tables.groups, key))) return null;
  return keys.map((key) => tables.groups[key]!).join(tables.separator);
}

/**
 * The values each clause substitutes, or `null` when its parameters are not
 * what the clause needs. Exhaustive over the key list: a key added without an
 * entry is a type error, not a sentence that renders its own key path.
 */
const LIMITATION_VALUES: Readonly<Record<GeoLimitationKey, (params: GeoLimitationParams, tables: LimitationTables) => LimitationValues | null>> = {
  entity_links_not_observed: () => ({}),
  facts_without_model: () => ({}),
  facts_missing_exact_excerpt: () => ({}),
  qa_without_model: () => ({}),
  own_evidence_partial: () => ({}),
  machine_signals_absent: () => ({}),
  robots_not_read_in_full: () => ({}),
  robots_none_published: () => ({}),
  robots_unreadable: () => ({}),
  snippets_not_checked: () => ({}),
  coverage_incomplete: () => ({}),
  carried_owner_declared_only: () => ({}),
  facts_withheld_unsupported: (params) => {
    const count = readCount(params, "count");
    return count === null ? null : { count };
  },
  evidence_items_unshowable: (params) => {
    const count = readCount(params, "count");
    return count === null ? null : { count };
  },
  evidence_groups_not_collected: (params, tables) => {
    const groups = readLabelList(params, "groups", tables);
    return groups === null ? null : { groups };
  },
  offsite_pages_unread: (params, tables) => {
    const count = readCount(params, "count");
    const reason = readLabel(params, "reason", REASON_KEYS, tables.reasons);
    return count === null || reason === null ? null : { count, reason };
  },
  offsite_stage_stopped: (params, tables) => {
    const count = readCount(params, "count");
    const reason = readLabel(params, "reason", REASON_KEYS, tables.reasons);
    const stage = readLabel(params, "stage", STAGE_KEYS, tables.stages);
    return count === null || reason === null || stage === null ? null : { count, reason, stage };
  },
};

export interface GeoKbSectionCopy {
  readonly title: string;
  readonly items: string;
}

export interface GeoKbCopy {
  readonly state: Readonly<Record<GeoKbStateKey, string>>;
  readonly status: {
    readonly none: string;
    readonly collecting: string;
    readonly assembling: string;
    readonly synthesizing: string;
    readonly draft: string;
    readonly published: (version: string, date: string) => string;
    readonly publishedUpdatable: (version: string, date: string) => string;
  };
  readonly actions: {
    readonly update: string;
    readonly publish: (version: string) => string;
    readonly view: string;
    readonly edit: string;
  };
  /**
   * The full account of what one update reads and bills. Folded behind
   * `costSummary` on the card since 2026-09-11 -- the Owner read the paragraph
   * as noise -- but still the sentence `kb-v2-runtime.test.ts` holds against
   * the real collector, because a fold hides a claim without changing it.
   */
  readonly cost: string;
  /** The one line that stays visible beside the billed button. */
  readonly costSummary: string;
  readonly costMore: string;
  readonly costLess: string;
  readonly publishFree: string;
  readonly sections: {
    readonly identity: GeoKbSectionCopy;
    readonly facts: GeoKbSectionCopy;
    readonly trust: GeoKbSectionCopy;
    readonly reachability: GeoKbSectionCopy;
    readonly measurement: {
      readonly title: string;
      readonly items: (count: number) => string;
      readonly show: string;
      readonly hide: string;
    };
  };
  readonly publish: {
    readonly title: string;
    readonly changes: (count: number, version: string) => string;
    /** The previous version records no per-item decisions, so there is no count. */
    readonly changesUncountable: (count: number, version: string) => string;
    readonly firstVersion: (count: number) => string;
    /** Absent when nothing is pending: a warning with nothing to warn about is noise. */
    readonly pending: (count: number) => string;
  };
  readonly published: {
    readonly headline: (version: string) => string;
    /**
     * One clause per module, not one sentence for all of them.
     *
     * A module the run never measured reads back as an empty list, and a
     * single template would render its numbers as `0` -- "we looked and found
     * none" said about a section nobody looked at. Clause-shaped, the caller
     * drops the clause instead of inventing a zero, and the summary simply
     * does not mention that section. There is deliberately no `thirdParty`
     * clause: nothing in this deployment collects off-site evidence, so the
     * only number it could carry is that same lie.
     */
    readonly counts: {
      readonly facts: (values: { readonly facts: number; readonly accepted: number }) => string;
      readonly qa: (values: { readonly qa: number }) => string;
      readonly comparisons: (values: { readonly available: number; readonly comparisons: number }) => string;
    };
  };
  readonly decisions: Readonly<Record<GeoDecision, string>>;
  /**
   * What to call one entity field. The contract names them by dotted path
   * (`definitions.w25`, `links.pricing`) because that is what an item key and
   * an owner correction address; a reader must never be shown the path. The
   * map is a full `Record` over the enum, so a path added without a key is a
   * type error rather than a page that prints the path.
   */
  readonly entityFields: Readonly<Record<GeoEntityFieldPath, string>>;
  readonly origins: Readonly<Record<GeoItemOrigin, string>>;
  readonly originDetail: {
    readonly thirdParty: (domain: string) => string;
    readonly profile: (revision: string) => string;
    readonly synthesized: (count: number) => string;
  };
  readonly independence: Readonly<Record<GeoKbIndependence, string>>;
  readonly item: {
    readonly accept: string;
    readonly correct: string;
    readonly exclude: string;
    readonly revert: string;
    readonly priorBasis: string;
    readonly newObservation: string;
    readonly conflict: string;
  };
  readonly module: {
    readonly partial: string;
    readonly unavailable: (reason: GeoUnavailableReason) => string;
    /**
     * The clauses of one `partial` module, localized -- or `null` when any of
     * them is a key this build does not know, so the caller renders the stored
     * English sentence whole rather than a shortened version of it.
     */
    readonly limitation: (clauses: readonly GeoLimitationClause[]) => string | null;
  };
  readonly groups: {
    readonly notCollected: string;
    readonly collectedEmpty: string;
    readonly proof: string;
    readonly changelog: string;
    readonly press: string;
    readonly thirdPartyProfiles: string;
    readonly firstPartyProof: string;
  };
  /**
   * The competitor rows: the one part of the locked input the card lets the
   * owner touch. Enum-valued fields go through full `Record`s for the reason
   * every other map here does -- a method or a reason the catalog has no key
   * for must not render as its own code -- and a reason this build has never
   * heard of is looked up through `reason(...)`, which answers the generic
   * sentence rather than the path of a missing key.
   */
  readonly competitors: {
    readonly title: string;
    readonly items: (confirmed: number, total: number) => string;
    readonly empty: string;
    readonly typeLabel: string;
    readonly unnamed: string;
    /** About the host: the Profile named it. Never about a name, which the Profile does not hold. */
    readonly fromProfile: string;
    /** A confirmed row's name is the owner's, whatever a lookup once proposed. */
    readonly ownerConfirmed: string;
    readonly readFrom: (url: string) => string;
    readonly method: Readonly<Record<GeoKbV3CompetitorIdentityMethod, string>>;
    readonly lookupFailed: (reason: string) => string;
    readonly reason: (reason: string) => string;
    readonly noDomain: string;
    readonly aliases: (aliases: string) => string;
    readonly confirmed: string;
    readonly unconfirmed: string;
    readonly lookup: string;
    readonly lookupBusy: string;
    readonly confirm: string;
    readonly unconfirm: string;
    readonly rename: string;
    readonly nameLabel: string;
    readonly save: string;
    readonly cancel: string;
    readonly saving: string;
    readonly nameRequired: string;
    /** The route's refusal codes, in the owner's words; anything else is `unknown`. */
    readonly failed: (code: string) => string;
  };
  readonly machine: {
    readonly aiCrawlers: string;
    readonly snippets: string;
    readonly crawlerSearch: string;
    readonly crawlerTraining: string;
    /** Where the two verdicts above were decided, because robots rules are per-path. */
    readonly crawlerScope: string;
    readonly crawlerNone: string;
    readonly access: Readonly<Record<GeoKbCrawlerAccess, string>>;
    readonly snippetStatuses: Readonly<Record<GeoKbSnippetStatus, string>>;
  };
}

/**
 * The label for one entity field path, for callers whose `field` is a plain
 * string. The published pack contract types the field as short text rather than
 * as the path enum, so an unrecognised value has to render as *something*, and
 * rendering the value itself is the honest fallback rather than a blank.
 *
 * `Object.hasOwn` rather than a plain index with `??`: the pack contract accepts
 * `field: "__proto__"` -- it is bounded short text with no key rule -- and a
 * plain index returns `Object.prototype`, which is not nullish, so `??` never
 * fires and React is handed an object it refuses to render. That takes down the
 * whole page, not the one row.
 */
export function geoKbEntityFieldLabel(field: string, copy: GeoKbCopy): string {
  return Object.hasOwn(copy.entityFields, field) ? copy.entityFields[field as GeoEntityFieldPath] : field;
}

function record<K extends string>(keys: readonly K[], read: (key: K) => string): Readonly<Record<K, string>> {
  return Object.fromEntries(keys.map((key) => [key, read(key)])) as Record<K, string>;
}

/** The complete card catalog, resolved once per render of its host. */
export function useGeoKbCopy(): GeoKbCopy {
  const t = useTranslations("tools.geoKnowledgeBase.card");
  return {
    state: record(STATE_KEYS, (key) => t(`state.${key}`)),
    status: {
      none: t("status.none"),
      collecting: t("status.collecting"),
      assembling: t("status.assembling"),
      synthesizing: t("status.synthesizing"),
      draft: t("status.draft"),
      published: (version, date) => t("status.published", { version, date }),
      publishedUpdatable: (version, date) => t("status.publishedUpdatable", { version, date }),
    },
    actions: {
      update: t("actions.update"),
      publish: (version) => t("actions.publish", { version }),
      view: t("actions.view"),
      edit: t("actions.edit"),
    },
    cost: t("cost"),
    costSummary: t("costSummary"),
    costMore: t("costMore"),
    costLess: t("costLess"),
    publishFree: t("publishFree"),
    sections: {
      identity: { title: t("sections.identity.title"), items: t("sections.identity.items") },
      facts: { title: t("sections.facts.title"), items: t("sections.facts.items") },
      trust: { title: t("sections.trust.title"), items: t("sections.trust.items") },
      reachability: { title: t("sections.reachability.title"), items: t("sections.reachability.items") },
      measurement: {
        title: t("sections.measurement.title"),
        items: (count) => t("sections.measurement.items", { count }),
        show: t("sections.measurement.show"),
        hide: t("sections.measurement.hide"),
      },
    },
    publish: {
      title: t("publish.title"),
      changes: (count, version) => t("publish.changes", { count, version }),
      changesUncountable: (count, version) => t("publish.changesUncountable", { count, version }),
      firstVersion: (count) => t("publish.firstVersion", { count }),
      pending: (count) => t("publish.pending", { count }),
    },
    published: {
      headline: (version) => t("published.headline", { version }),
      counts: {
        facts: (values) => t("published.counts.facts", { ...values }),
        qa: (values) => t("published.counts.qa", { ...values }),
        comparisons: (values) => t("published.counts.comparisons", { ...values }),
      },
    },
    decisions: record(
      Object.keys(DECISION_KEYS) as readonly GeoDecision[],
      (decision) => t(`decisions.${DECISION_KEYS[decision]}`),
    ),
    entityFields: record(GEO_ENTITY_FIELD_PATHS, (path) => t(`entityFields.${path}`)),
    origins: record(ORIGINS, (origin) => t(`origins.${origin}`)),
    originDetail: {
      thirdParty: (domain) => t("originDetail.thirdParty", { domain }),
      profile: (revision) => t("originDetail.profile", { revision }),
      synthesized: (count) => t("originDetail.synthesized", { count }),
    },
    independence: record(INDEPENDENCE, (value) => t(`independence.${value}`)),
    item: {
      accept: t("item.accept"),
      correct: t("item.correct"),
      exclude: t("item.exclude"),
      revert: t("item.revert"),
      priorBasis: t("item.priorBasis"),
      newObservation: t("item.newObservation"),
      conflict: t("item.conflict"),
    },
    module: {
      partial: t("module.partial"),
      unavailable: (reason) => t(`module.unavailable.${reason}`),
      limitation: (clauses) => {
        if (clauses.length === 0) return null;
        const tables: LimitationTables = {
          groups: record(EVIDENCE_GROUP_KEYS, (key) => t(`groups.${key}`)),
          stages: record(STAGE_KEYS, (key) => t(`limitations.stages.${key}`)),
          reasons: record(REASON_KEYS, (key) => t(`limitations.reasons.${key}`)),
          separator: t("limitations.separator"),
        };
        const sentences: string[] = [];
        for (const clause of clauses) {
          if (!Object.hasOwn(LIMITATION_KEY_SET, clause.key)) return null;
          const key = clause.key as GeoLimitationKey;
          const params = clause.params ?? {};
          if (!paramsMatch(key, params)) return null;
          const values = LIMITATION_VALUES[key](params, tables);
          if (values === null) return null;
          sentences.push(t(`limitations.clause.${key}`, values));
        }
        return sentences.join(LIMITATION_JOIN);
      },
    },
    groups: {
      notCollected: t("groups.notCollected"),
      collectedEmpty: t("groups.collectedEmpty"),
      proof: t("groups.proof"),
      changelog: t("groups.changelog"),
      press: t("groups.press"),
      thirdPartyProfiles: t("groups.thirdPartyProfiles"),
      firstPartyProof: t("groups.firstPartyProof"),
    },
    competitors: {
      title: t("competitors.title"),
      items: (confirmed, total) => t("competitors.items", { confirmed, total }),
      empty: t("competitors.empty"),
      typeLabel: t("competitors.typeLabel"),
      unnamed: t("competitors.unnamed"),
      fromProfile: t("competitors.fromProfile"),
      ownerConfirmed: t("competitors.ownerConfirmed"),
      readFrom: (url) => t("competitors.readFrom", { url }),
      method: record(GEO_KB_V3_COMPETITOR_IDENTITY_METHODS, (key) => t(`competitors.method.${key}`)),
      lookupFailed: (reason) => t("competitors.lookupFailed", { reason }),
      reason: (reason) => t(`competitors.reasons.${COMPETITOR_REASONS.has(reason) ? (reason as GeoKbV3CompetitorIdentityReason) : "unknown"}`),
      noDomain: t("competitors.noDomain"),
      aliases: (aliases) => t("competitors.aliases", { aliases }),
      confirmed: t("competitors.confirmed"),
      unconfirmed: t("competitors.unconfirmed"),
      lookup: t("competitors.lookup"),
      lookupBusy: t("competitors.lookupBusy"),
      confirm: t("competitors.confirm"),
      unconfirm: t("competitors.unconfirm"),
      rename: t("competitors.rename"),
      nameLabel: t("competitors.nameLabel"),
      save: t("competitors.save"),
      cancel: t("competitors.cancel"),
      saving: t("competitors.saving"),
      nameRequired: t("competitors.nameRequired"),
      failed: (code) => t(`competitors.failed.${COMPETITOR_FAILURES.has(code) ? code : "unknown"}`),
    },
    machine: {
      aiCrawlers: t("machine.aiCrawlers"),
      snippets: t("machine.snippets"),
      crawlerSearch: t("machine.crawlerSearch"),
      crawlerTraining: t("machine.crawlerTraining"),
      crawlerScope: t("machine.crawlerScope"),
      crawlerNone: t("machine.crawlerNone"),
      access: record(["allowed", "disallowed", "unspecified"] as const, (key) => t(`machine.access.${key}`)),
      snippetStatuses: record(["allowed", "blocked", "not_checked"] as const, (key) => t(`machine.snippetStatuses.${key}`)),
    },
  };
}

/**
 * One date format for the whole card. `timeZoneName` is deliberately absent:
 * pairing it with `dateStyle` throws in `Intl.DateTimeFormat`, and that page
 * shipped broken once already.
 */
export function geoKbFormatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}
