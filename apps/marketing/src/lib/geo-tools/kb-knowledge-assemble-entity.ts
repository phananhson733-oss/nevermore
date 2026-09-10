// @input -- locked identity, the model's entity narrative and the joined catalogue
// @output -- the entity module, with one provenance row per addressable field
// @pos -- pure projection: no fetch, no clock, no store

/**
 * The entity module is the only place where three provenances meet in one
 * object: the name and categories are declarations carried in the locked
 * generation input, the definitions are model text, and the links and `sameAs`
 * entries are observations. Section 3 forbids any of them from borrowing
 * another's label, so each addressable field gets its own row saying where its
 * value came from and what was checked about it.
 *
 * A declared field is `not_applicable` rather than `cited_and_literals_match`
 * unless an observed page happens to carry it word for word. Citing the home
 * page beside a Profile declaration and calling it a checked citation would be
 * the model-grants-itself-verified failure in another costume.
 */
import { geoItemKey } from "./kb-item-key.ts";
import type { GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { geoPartialLimitation } from "./kb-knowledge-limitation.ts";
import type { GeoKnowledgeNarrativeV2 } from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  GEO_ENTITY_FIELD_PATHS,
  GEO_KNOWLEDGE_LIMITS,
  geoEntityFieldClaim,
  geoLiteralsSupported,
  type GeoEntityFieldPath,
  type GeoItemOrigin,
} from "./kb-knowledge-shape.ts";
import type { GeoOffsiteCollection } from "./kb-offsite-collect.ts";
import type { GeoKnowledgeBodyV3 } from "./kb-v3-contract.ts";
import {
  geoEvidenceCheckFor,
  geoSupportingRefs,
  type GeoSourceIndex,
} from "./kb-knowledge-assemble-sources.ts";

type EntityModule = GeoKnowledgeBodyV3["entity"];
type EntityValue = Extract<EntityModule, { status: "available" }>["value"];
type EntityField = EntityValue["fields"][number];
type EntityLinks = EntityValue["links"];

type LinkIntent = "pricing" | "docs" | "about" | "changelog" | "faq";

/**
 * Where each addressable field's value comes from. Kept as one table so a new
 * field cannot be added without someone deciding what its provenance is.
 */
const FIELD_ORIGIN: Readonly<Record<GeoEntityFieldPath, Exclude<GeoItemOrigin, "declared_owner">>> = {
  name: "declared_profile",
  aliases: "declared_profile",
  "categories.primary": "declared_profile",
  "categories.secondary": "declared_profile",
  "definitions.w25": "synthesized",
  "definitions.w55": "synthesized",
  "definitions.w120": "synthesized",
  "audience.who": "synthesized",
  "audience.notFor": "synthesized",
  "founded.year": "synthesized",
  "founded.team": "synthesized",
  "founded.location": "synthesized",
  disambiguation: "synthesized",
  "links.home": "observed_own",
  "links.pricing": "observed_own",
  "links.docs": "observed_own",
  "links.about": "observed_own",
  "links.changelog": "observed_own",
  "links.faq": "observed_own",
  sameAs: "observed_third_party",
};

interface LinkPlan {
  readonly links: EntityLinks;
  /** The own-site row that evidences each link that was found. */
  readonly refs: ReadonlyMap<LinkIntent | "home", string>;
}

function planLinks(
  evidence: GeoKnowledgeEvidenceV1,
  index: GeoSourceIndex,
): LinkPlan {
  const home = evidence.targetUrl;
  const host = new URL(home).host;
  const readable = index.catalogue.filter(
    (source) =>
      source.kind === "own_page" &&
      source.availability !== "unavailable" &&
      source.url !== null,
  );
  const refByUrl = new Map(
    readable.map((source) => [source.url as string, source.id]),
  );
  const pages = evidence.pages.filter(
    (page) => new URL(page.url).host === host,
  );
  const refs = new Map<LinkIntent | "home", string>();
  const homeRef = refByUrl.get(home);
  if (homeRef !== undefined) refs.set("home", homeRef);
  const forIntent = (intent: LinkIntent): string | null => {
    const found =
      pages
        .flatMap((page) =>
          page.links
            .filter((link) => link.intent === intent && refByUrl.has(link.url))
            .map((link) => link.url),
        )
        .sort()[0] ?? null;
    if (found !== null) refs.set(intent, refByUrl.get(found) as string);
    return found;
  };
  const links: EntityLinks = {
    home,
    pricing: forIntent("pricing"),
    docs: forIntent("docs"),
    about: forIntent("about"),
    changelog: forIntent("changelog"),
    faq: forIntent("faq"),
  };
  return { links, refs };
}

function fieldRefs(
  path: GeoEntityFieldPath,
  base: readonly string[],
  plan: LinkPlan,
  sameAsRefs: readonly string[],
): readonly string[] {
  if (path === "sameAs") return sameAsRefs;
  if (path === "links.home")
    return plan.refs.has("home") ? [plan.refs.get("home") as string] : [];
  if (path.startsWith("links.")) {
    const intent = path.slice("links.".length) as LinkIntent;
    return plan.refs.has(intent) ? [plan.refs.get(intent) as string] : [];
  }
  return base;
}

export interface GeoEntityInput {
  readonly identity: {
    readonly officialName: string;
    readonly aliases: readonly string[];
    readonly categoryTerms: readonly string[];
  };
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly narrative: GeoKnowledgeNarrativeV2;
  readonly offsite: GeoOffsiteCollection | null;
  readonly index: GeoSourceIndex;
}

export interface GeoEntityAssembly {
  readonly module: EntityModule;
  readonly dropped: readonly {
    readonly field: string;
    readonly reason: string;
  }[];
}

/**
 * Declared list entries whose numbers no cited page carries are left out.
 *
 * The published pack checks the entity module's whole text against the sources
 * the module cites, all at once, so one unsupported alias makes the version
 * unpublishable rather than making one chip disappear. A name or primary
 * category cannot be dropped that way -- there is nothing to fall back on -- so
 * those are reported instead.
 */
function supportedValues(
  values: readonly string[],
  refs: readonly string[],
  index: GeoSourceIndex,
): readonly string[] {
  const excerpts = refs.flatMap((ref) => index.byId.get(ref)?.excerpts ?? []);
  return values.filter((value) => geoLiteralsSupported(value, excerpts));
}

export function geoEntityModule(input: GeoEntityInput): GeoEntityAssembly {
  const dropped: { field: string; reason: string }[] = [];
  const primary = input.identity.categoryTerms[0];
  if (primary === undefined) {
    return {
      module: { status: "unavailable", reason: "insufficient_evidence" },
      dropped: [{ field: "categories.primary", reason: "no_category_term" }],
    };
  }
  const plan = planLinks(input.evidence, input.index);
  const declared = [
    input.identity.officialName,
    primary,
    ...input.identity.aliases,
    ...input.identity.categoryTerms.slice(1),
  ];
  const base = [
    ...new Set([
      ...input.narrative.entity.sourceRefs,
      ...declared.flatMap((value) =>
        geoSupportingRefs(
          value,
          input.index,
          input.narrative.entity.sourceRefs,
        ),
      ),
    ]),
  ].slice(0, GEO_KNOWLEDGE_LIMITS.sourceRefs);
  const aliases = supportedValues(input.identity.aliases, base, input.index);
  const secondary = supportedValues(
    input.identity.categoryTerms.slice(1),
    base,
    input.index,
  );
  for (const alias of input.identity.aliases) {
    if (!aliases.includes(alias))
      dropped.push({ field: "aliases", reason: "literals_unsupported" });
  }
  for (const term of input.identity.categoryTerms.slice(1)) {
    if (!secondary.includes(term))
      dropped.push({
        field: "categories.secondary",
        reason: "literals_unsupported",
      });
  }
  for (const [label, declaredValue] of [
    ["name", input.identity.officialName],
    ["categories.primary", primary],
  ] as const) {
    if (supportedValues([declaredValue], base, input.index).length === 0)
      dropped.push({ field: label, reason: "literals_unsupported" });
  }
  // Only cross-referenced identities reach `sameAs`, and only when the page
  // that proved the cross-reference is still in the catalogue: a claim whose
  // evidence was cut by the ceiling is a claim with nothing behind it.
  const candidates = (input.offsite?.sameAsCandidates ?? [])
    .filter((candidate) => input.index.byId.has(candidate.sourceRef))
    .filter(
      (candidate, position, all) =>
        all.findIndex((other) => other.url === candidate.url) === position,
    )
    .slice(0, GEO_KNOWLEDGE_LIMITS.sameAs);
  const sameAs = candidates.map((candidate) => candidate.url);
  const sameAsRefs = [
    ...new Set(candidates.map((candidate) => candidate.sourceRef)),
  ].slice(0, GEO_KNOWLEDGE_LIMITS.sourceRefs);

  const value: EntityValue = {
    name: input.identity.officialName,
    aliases: [...aliases],
    categories: { primary, secondary: [...secondary] },
    definitions: input.narrative.entity.definitions,
    audience: input.narrative.entity.audience,
    founded: input.narrative.entity.founded,
    disambiguation: input.narrative.entity.disambiguation,
    links: plan.links,
    sameAs,
    sourceRefs: base,
    fields: [],
  };
  const fields: EntityField[] = [];
  for (const path of GEO_ENTITY_FIELD_PATHS) {
    const claim = geoEntityFieldClaim(value, path);
    if (claim.trim() === "") continue;
    const refs = fieldRefs(path, base, plan, sameAsRefs);
    // Every item needs a source. A field nothing evidences gets no row, and so
    // no key -- it cannot be excluded, but neither is it presented as sourced.
    if (refs.length === 0) {
      dropped.push({ field: path, reason: "no_source" });
      continue;
    }
    fields.push({
      field: path,
      itemKey: geoItemKey({ module: "entity", field: path }),
      origin: FIELD_ORIGIN[path],
      sourceRefs: [...refs],
      evidenceChecks: geoEvidenceCheckFor(
        refs,
        [{ text: claim, sourceRefs: refs }],
        input.index,
      ),
      alternateObservations: [],
    });
  }
  const complete = Object.values(plan.links).every((link) => link !== null);
  const module: EntityModule = complete
    ? { status: "available", value: { ...value, fields } }
    : {
        status: "partial",
        ...geoPartialLimitation([{ key: "entity_links_not_observed" }]),
        value: { ...value, fields },
      };
  return { module, dropped };
}
