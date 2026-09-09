// @input  -- the `tools.geoKnowledgeBase.card` catalog, through next-intl
// @output -- one typed copy object for every GEO knowledge base card component
// @pos    -- copy only: no fetch, no state, no server module, type imports only
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
import { GEO_ENTITY_FIELD_PATHS } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import type {
  GeoEntityFieldPath,
  GeoEvidenceCheck,
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
  readonly cost: string;
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
  /** `not_applicable` deliberately has no label: there is nothing to say. */
  readonly evidenceChecks: (check: GeoEvidenceCheck) => string | null;
  readonly item: {
    readonly accept: string;
    readonly correct: string;
    readonly exclude: string;
    readonly revert: string;
    readonly correctedAt: (date: string) => string;
    readonly priorBasis: string;
    readonly review: (date: string) => string;
    readonly newObservation: string;
    readonly conflict: string;
  };
  readonly module: {
    readonly partial: string;
    readonly unavailable: (reason: GeoUnavailableReason) => string;
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
  readonly machine: {
    readonly aiCrawlers: string;
    readonly snippets: string;
    readonly crawlerSearch: string;
    readonly crawlerTraining: string;
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
 */
export function geoKbEntityFieldLabel(field: string, copy: GeoKbCopy): string {
  return copy.entityFields[field as GeoEntityFieldPath] ?? field;
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
    evidenceChecks: (check) => (check === "not_applicable" ? null : t(`evidenceChecks.${check}`)),
    item: {
      accept: t("item.accept"),
      correct: t("item.correct"),
      exclude: t("item.exclude"),
      revert: t("item.revert"),
      correctedAt: (date) => t("item.correctedAt", { date }),
      priorBasis: t("item.priorBasis"),
      review: (date) => t("item.review", { date }),
      newObservation: t("item.newObservation"),
      conflict: t("item.conflict"),
    },
    module: {
      partial: t("module.partial"),
      unavailable: (reason) => t(`module.unavailable.${reason}`),
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
    machine: {
      aiCrawlers: t("machine.aiCrawlers"),
      snippets: t("machine.snippets"),
      crawlerSearch: t("machine.crawlerSearch"),
      crawlerTraining: t("machine.crawlerTraining"),
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
