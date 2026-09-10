"use client";
// @input  -- one published v2 knowledge pack, where every item carries origin and decision
// @output -- the eight modules, each item labelled with where it came from and what was decided
// @pos    -- read-only rendering; type-only contract imports keep the digest out of the browser
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * What v2 adds to the rendered page, and why each addition exists.
 *
 * - Every reviewable item shows its `origin` and its `decision` as two separate
 *   chips. A model summary accepted by a batch gesture reads "accepted in bulk,
 *   not confirmed one by one" and never "confirmed".
 * - Evidence groups are always drawn. `collected` tells "looked for and found
 *   nothing" apart from "never looked", which v1 could not express and
 *   therefore rendered identically -- as nothing at all.
 * - Search-use and training-use crawler permissions are reported separately,
 *   because blocking one says nothing about the other.
 *
 * `modules` exists so the card can group these eight into its five lettered
 * sections without a second renderer drifting away from this one.
 */
import { type ReactNode } from "react";

import { normalizeAccountWebsiteUrl } from "../../lib/account-websites/contracts.ts";
import type { GeoEvidenceCheck, GeoItemOrigin } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import type {
  GeoKnowledgeEvidenceItemV2,
  GeoKnowledgePackV2,
  GeoKnowledgeSourceV2,
  GeoPackDecision,
} from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";
import { geoKnowledgePackCopy, type GeoKnowledgePackCopy } from "./geo-knowledge-pack-copy.ts";
import { geoKbEntityFieldLabel, geoKbFormatDate, useGeoKbCopy, type GeoKbCopy } from "./geo-kb-copy.ts";
import { GeoKbItemRow, geoKbSourceParts, type GeoKbItemSource } from "./geo-kb-item-row.tsx";
import {
  GeoKbEvidenceGroup,
  GeoKbModuleSection,
  geoKbModuleState,
  geoKbModuleValue,
  type GeoKbHeading,
  type GeoKbModuleLike,
} from "./geo-kb-module-section.tsx";

export const GEO_KNOWLEDGE_MODULES = [
  "entity", "facts", "qa", "comparisons", "scope", "evidence", "machine", "coverage",
] as const;
export type GeoKnowledgeModuleName = (typeof GEO_KNOWLEDGE_MODULES)[number];

const EVIDENCE_GROUPS = ["proof", "changelog", "press", "thirdPartyProfiles", "firstPartyProof"] as const;
const SCOPE_GROUPS = ["does", "doesNot", "needsHuman", "misconceptions"] as const;
const MACHINE_FIELDS = ["jsonLd", "llms", "robots", "sitemap", "hreflang"] as const;

type SourceIndex = ReadonlyMap<string, GeoKnowledgeSourceV2>;

/** The provenance every reviewable item in a published pack carries. */
interface PackProvenance {
  readonly origin: GeoItemOrigin;
  readonly decision: GeoPackDecision;
  readonly sourceRefs: readonly string[];
  readonly priorSourceRefs: readonly string[];
  readonly ownerDeclaredAt: string | null;
  readonly evidenceChecks: GeoEvidenceCheck;
  readonly observedAt?: string | null;
  readonly nextReviewAt?: string | null;
}

interface ModuleProps {
  readonly pack: GeoKnowledgePackV2;
  readonly sources: SourceIndex;
  readonly heading: GeoKbHeading;
  readonly locale: string;
  readonly copy: GeoKnowledgePackCopy;
  readonly card: GeoKbCopy;
}

export interface GeoKnowledgePackV2Props {
  readonly pack: GeoKnowledgePackV2;
  readonly locale: string;
  readonly heading?: GeoKbHeading;
  /** Which modules to draw, in this order. Defaults to all eight. */
  readonly modules?: readonly GeoKnowledgeModuleName[];
}

function safeUrl(url: string): boolean {
  return /^https?:\/\//iu.test(url) && normalizeAccountWebsiteUrl(url) !== null;
}

function Link({ url, children }: { readonly url: string; readonly children: ReactNode }) {
  return safeUrl(url)
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-words text-brand-accent-text underline underline-offset-2 [overflow-wrap:anywhere]">{children}</a>
    : <span>{children}</span>;
}

function Compact({ children, className = "" }: { readonly children: ReactNode; readonly className?: string }) {
  return <div data-knowledge-copy="compact" className={`min-w-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere] ${className}`}>{children}</div>;
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <div className="min-w-0">
    <span className="block text-[12px] text-text-dark-secondary">{label}</span>
    <Compact className="mt-1 text-text-dark-primary">{children}</Compact>
  </div>;
}

/** The public pages an entry cites, as links a reader can open. */
function Basis({ refs, sources, copy, locale }: {
  readonly refs: readonly string[];
  readonly sources: SourceIndex;
  readonly copy: GeoKnowledgePackCopy;
  readonly locale: string;
}) {
  const seen = new Set<string>();
  const visible = refs.flatMap((ref) => {
    const source = sources.get(ref);
    if (source === undefined || source.availability === "unavailable" || seen.has(source.id)) return [];
    seen.add(source.id);
    return [source];
  });
  if (visible.length === 0) return null;
  return <div data-public-sources className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-relaxed text-text-dark-secondary">
    <span>{copy.evidenceBasis}:</span>
    {visible.map((source, index) => <span key={source.id} className="min-w-0">
      {index === 0 ? "" : "· "}
      {source.url === null ? source.label : <Link url={source.url}>{source.label}</Link>}
      {source.observedAt === null ? null : <> <span>({geoKbFormatDate(source.observedAt, locale)})</span></>}
    </span>)}
  </div>;
}

function hostOf(url: string | null | undefined): string | null {
  if (url === null || url === undefined || !safeUrl(url)) return null;
  try { return new URL(url).hostname; } catch { return null; }
}

function pathOf(url: string | null | undefined): string | null {
  if (url === null || url === undefined || !safeUrl(url)) return null;
  try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return null; }
}

/**
 * The origin a cited page implies, used only for a superseded reference, which
 * carries no declared origin of its own. `accepted_fact` resolves to an owner
 * declaration because such a source is a claim the owner already adopted, not
 * a page anyone can open.
 */
function originOfKind(kind: GeoKnowledgeSourceV2["kind"]): GeoItemOrigin {
  if (kind === "competitor_page") return "observed_competitor";
  if (kind === "third_party_page") return "observed_third_party";
  if (kind === "gsc") return "observed_gsc";
  if (kind === "accepted_fact") return "declared_owner";
  return "observed_own";
}

function describe(origin: GeoItemOrigin, cited: readonly GeoKnowledgeSourceV2[], refCount: number): GeoKbItemSource {
  const first = (kind: GeoKnowledgeSourceV2["kind"]) => cited.find((source) => source.kind === kind);
  switch (origin) {
    case "observed_own": return { origin: "observed_own", path: pathOf(first("own_page")?.url) };
    case "observed_competitor": return { origin: "observed_competitor", path: pathOf(first("competitor_page")?.url) };
    case "observed_third_party": {
      const source = first("third_party_page");
      return { origin: "observed_third_party", domain: hostOf(source?.url), independence: source?.independence ?? "undetermined" };
    }
    case "observed_gsc": return { origin: "observed_gsc" };
    case "declared_profile": return { origin: "declared_profile", revision: null };
    case "declared_owner": return { origin: "declared_owner" };
    case "synthesized": return { origin: "synthesized", evidenceCount: refCount };
  }
}

/**
 * The customer-readable source of one item. The item's own `origin` decides
 * what it is called; the catalogue only supplies the page detail, so a lookup
 * miss can never promote an item to a stronger kind of source than it declared.
 */
export function geoKbItemSourceOf(item: Pick<PackProvenance, "origin" | "sourceRefs">, sources: SourceIndex): GeoKbItemSource {
  const cited = item.sourceRefs.flatMap((ref) => { const source = sources.get(ref); return source === undefined ? [] : [source]; });
  return describe(item.origin, cited, item.sourceRefs.length);
}

/** What a correction replaced. Displayed, never counted as support. */
function priorSourceOf(refs: readonly string[], sources: SourceIndex): GeoKbItemSource | null {
  const cited = refs.flatMap((ref) => { const source = sources.get(ref); return source === undefined ? [] : [source]; });
  if (cited.length === 0) return null;
  return describe(originOfKind(cited[0].kind), cited, refs.length);
}

function Row({ item, sources, locale, typeLabel, children }: {
  readonly item: PackProvenance;
  readonly sources: SourceIndex;
  readonly locale: string;
  readonly typeLabel: string;
  readonly children: ReactNode;
}) {
  return <GeoKbItemRow
    typeLabel={typeLabel}
    source={geoKbItemSourceOf(item, sources)}
    decision={item.decision}
    evidenceChecks={item.evidenceChecks}
    locale={locale}
    observedAt={item.observedAt ?? null}
    nextReviewAt={item.nextReviewAt ?? null}
    ownerDeclaredAt={item.ownerDeclaredAt}
    priorSource={priorSourceOf(item.priorSourceRefs, sources)}
  >{children}</GeoKbItemRow>;
}

function EntityModule({ pack, sources, heading, locale, copy, card }: ModuleProps) {
  const entity = geoKbModuleValue(pack.entity);
  return <GeoKbModuleSection title={copy.sections.entity} heading={heading} state={geoKbModuleState(pack.entity)}>
    {entity === null ? null : <div className="min-w-0 space-y-5">
      <Compact className="text-[15px] font-semibold text-text-dark-primary">{entity.name}</Compact>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <Field label={copy.fields.shortDefinition}>{entity.definitions.w25}</Field>
        <Field label={copy.fields.standardDefinition}>{entity.definitions.w55}</Field>
        <Field label={copy.fields.detailedDefinition}>{entity.definitions.w120}</Field>
      </div>
      <div className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
        <Field label={copy.fields.aliases}>{entity.aliases.length === 0 ? copy.none : entity.aliases.join(" · ")}</Field>
        <Field label={copy.fields.categories}>{[entity.categories.primary, ...entity.categories.secondary].join(" · ")}</Field>
        <Field label={copy.fields.audience}>{entity.audience.who}</Field>
        <Field label={copy.fields.notFor}>{entity.audience.notFor ?? copy.notRecorded}</Field>
        {entity.disambiguation === null ? null : <Field label={copy.fields.disambiguation}>{entity.disambiguation}</Field>}
        <Field label={copy.fields.officialLinks}>
          <span className="flex flex-wrap gap-x-4 gap-y-2">
            {Object.entries(entity.links).flatMap(([label, url]) => url === null ? [] : [<Link key={label} url={url}>{label}</Link>])}
            {entity.sameAs.map((url) => <Link key={url} url={url}>{hostOf(url) ?? url}</Link>)}
          </span>
        </Field>
      </div>
      {/* Field-level provenance sits beside the values rather than wrapping
          each one, so the block still reads as a definition while every field
          still says where it came from and what was decided about it. */}
      <div data-entity-fields className="min-w-0 space-y-2">
        {entity.fields.map((field) => <div key={field.field} data-entity-field={field.field} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-relaxed text-text-dark-secondary">
          <span className="font-medium text-text-dark-primary">{geoKbEntityFieldLabel(field.field, card)}</span>
          <span>{geoKbSourceParts(geoKbItemSourceOf(field, sources), card).join(" · ")}</span>
          <span data-decision-chip="" data-decision={field.decision} className="inline-flex rounded-full border border-brand-border-card px-2.5 py-1">{card.decisions[field.decision]}</span>
        </div>)}
      </div>
      <Basis refs={entity.sourceRefs} sources={sources} copy={copy} locale={locale} />
    </div>}
  </GeoKbModuleSection>;
}

function FactsModule({ pack, sources, heading, locale, copy }: ModuleProps) {
  const facts = geoKbModuleValue(pack.facts);
  return <GeoKbModuleSection title={copy.sections.facts} heading={heading} state={geoKbModuleState(pack.facts)}>
    <div className="space-y-4">{(facts ?? []).map((fact) => <Row key={fact.id} item={fact} sources={sources} locale={locale} typeLabel={copy.factTypes[fact.type] ?? fact.type}>
      {fact.statement}
    </Row>)}</div>
  </GeoKbModuleSection>;
}

function QaModule({ pack, sources, heading, locale, copy }: ModuleProps) {
  const qa = geoKbModuleValue(pack.qa);
  return <GeoKbModuleSection title={copy.sections.qa} heading={heading} state={geoKbModuleState(pack.qa)}>
    <div className="space-y-4">{(qa ?? []).map((item) => <Row key={item.id} item={item} sources={sources} locale={locale} typeLabel={copy.intents[item.intent] ?? item.intent}>
      <span className="block font-semibold text-text-dark-primary">{item.question}</span>
      <span className="mt-2 block">{copy.fields.directAnswer}: {item.directAnswer}</span>
      {item.expansion === null ? null : <span className="mt-2 block text-text-dark-secondary">{item.expansion}</span>}
      {item.variants.length === 0 ? null : <span className="mt-2 block text-text-dark-secondary">{copy.fields.variants}: {item.variants.join(" · ")}</span>}
    </Row>)}</div>
  </GeoKbModuleSection>;
}

function ComparisonsModule({ pack, sources, heading, locale, copy }: ModuleProps) {
  const comparisons = geoKbModuleValue(pack.comparisons);
  return <GeoKbModuleSection title={copy.sections.comparisons} heading={heading} state={geoKbModuleState(pack.comparisons)}>
    <div className="space-y-6">{(comparisons ?? []).map((comparison) => <div key={comparison.id} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold text-text-dark-primary">{comparison.competitor.name}</span>
        <span className="text-[12px] text-text-dark-secondary">{copy.fields.checkedAt}: {geoKbFormatDate(comparison.checkedAt, locale)}</span>
      </div>
      <div className="space-y-3">{comparison.rows.map((row) => <Row key={row.id} item={row} sources={sources} locale={locale} typeLabel={row.dimension}>
        <span className="block">{copy.fields.product}: {row.product ?? copy.comparisonStatuses[row.availability]}</span>
        <span className="mt-1 block">{comparison.competitor.name}: {row.competitor ?? copy.comparisonStatuses[row.availability]}</span>
        <span data-comparison-row-status className="mt-1 block text-text-dark-secondary">{copy.comparisonStatuses[row.availability]}</span>
      </Row>)}</div>
      <div className="border-t border-brand-border-card pt-3">
        <span className="block text-[12px] text-text-dark-secondary">{copy.fields.verdict}</span>
        <Compact className="mt-1">{comparison.verdict}</Compact>
        <Basis refs={comparison.sourceRefs} sources={sources} copy={copy} locale={locale} />
      </div>
    </div>)}</div>
  </GeoKbModuleSection>;
}

function ScopeModule({ pack, sources, heading, locale, copy }: ModuleProps) {
  const scope = geoKbModuleValue(pack.scope);
  return <GeoKbModuleSection title={copy.sections.scope} heading={heading} state={geoKbModuleState(pack.scope)}>
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">{SCOPE_GROUPS.map((kind) => <GeoKbEvidenceGroup
      key={kind}
      title={copy.scopeGroups[kind] ?? kind}
      heading={heading}
      collected
      count={scope === null ? 0 : scope[kind].length}
    >
      <div className="space-y-3">{(scope === null ? [] : scope[kind]).map((item) => <Row key={item.id} item={item} sources={sources} locale={locale} typeLabel={copy.scopeGroups[kind] ?? kind}>
        {item.text}
      </Row>)}</div>
    </GeoKbEvidenceGroup>)}</div>
  </GeoKbModuleSection>;
}

function EvidenceItem({ item, sources, copy, card, locale }: {
  readonly item: GeoKnowledgeEvidenceItemV2;
  readonly sources: SourceIndex;
  readonly copy: GeoKnowledgePackCopy;
  readonly card: GeoKbCopy;
  readonly locale: string;
}) {
  return <div className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
    <Compact className="font-medium">{item.url === null ? item.label : <Link url={item.url}>{item.label}</Link>}</Compact>
    <Compact className="mt-1 text-text-dark-secondary">{item.summary}</Compact>
    <span data-evidence-independence={item.independence} className="mt-2 inline-flex rounded-full border border-brand-border-card px-2.5 py-1 text-[12px] text-text-dark-secondary">
      {card.independence[item.independence]}
    </span>
    <Basis refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} />
  </div>;
}

/**
 * The three modules nobody reviews.
 *
 * Evidence, machine-readable status and coverage are read-only by design
 * decision D3: they report observations, so there is no decision to record
 * against them. They are exported taking the module rather than a whole pack
 * because the v3 review card holds the same three modules in a draft body and
 * has to draw them from there -- and the draft carries the identical shapes
 * (`geoEvidenceItemShape`, `geoMachineValueShape`, `geoCoverageItemShape` are
 * shared by both contracts). Rendering them a second time from a second
 * renderer is how "an empty group is said out loud" gets lost on one surface
 * and kept on the other.
 */
/** The value a module carries, named without the unavailable arm that has none. */
type GeoModuleValueOf<M extends GeoKbModuleLike<unknown>> = Extract<M, { readonly status: "available" }>["value"];

export interface GeoReadOnlyModuleProps<T> {
  readonly module: GeoKbModuleLike<T>;
  readonly sources: SourceIndex;
  readonly heading: GeoKbHeading;
  readonly locale: string;
  readonly copy: GeoKnowledgePackCopy;
  readonly card: GeoKbCopy;
}

export function GeoEvidenceModuleView({ module, sources, heading, locale, copy, card }: GeoReadOnlyModuleProps<GeoModuleValueOf<GeoKnowledgePackV2["evidence"]>>) {
  const evidence = geoKbModuleValue(module);
  return <GeoKbModuleSection title={copy.sections.evidence} heading={heading} state={geoKbModuleState(module)}>
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">{EVIDENCE_GROUPS.map((group) => <GeoKbEvidenceGroup
      key={group}
      title={card.groups[group]}
      heading={heading}
      collected={evidence !== null && evidence.collected.includes(group)}
      count={evidence === null ? 0 : evidence[group].length}
    >
      <div className="space-y-3">{(evidence === null ? [] : evidence[group]).map((item) =>
        <EvidenceItem key={item.id} item={item} sources={sources} copy={copy} card={card} locale={locale} />)}</div>
    </GeoKbEvidenceGroup>)}</div>
  </GeoKbModuleSection>;
}

/**
 * The one clause a card needs when its signal is not `present`.
 *
 * Two different sentences, because the states are two different things:
 *
 * A RESOURCE signal (llms.txt, robots.txt, sitemap) names one address, and the
 * reason its source records is why that address did not answer with the file.
 * The card's own label cannot carry it -- `unreachable` is a timeout, a
 * refusal, a rate limit and a 200 that returned the wrong document, and
 * astrologywiki.com is the last of those: it serves its SPA shell at
 * /llms.txt. `Basis` below drops unavailable sources, so until this existed
 * the reason was in the data and on no screen.
 *
 * A PAGE signal (JSON-LD, hreflang) is a union over the pages this run read,
 * and `absent` is only ever true OF THOSE PAGES. Two pages read against a
 * 558-URL sitemap is a sample, and astrologywiki.com does declare hreflang --
 * on /zh/, which this run never read. So the negative is published with the
 * number it is true of rather than as a verdict about the site.
 */
function MachineNote({ kind, status, refs, sources, copy }: {
  readonly kind: string;
  readonly status: string;
  readonly refs: readonly string[];
  readonly sources: SourceIndex;
  readonly copy: GeoKnowledgePackCopy;
}) {
  if (status === "present") return null;
  const cited = refs.flatMap((ref) => { const source = sources.get(ref); return source === undefined ? [] : [source]; });
  if (kind === "jsonLd" || kind === "hreflang") {
    // Own pages that were actually read. An unavailable source is an address
    // nobody read, and counting it would inflate the claim this line makes.
    const read = cited.filter((source) => source.availability !== "unavailable").length;
    return <Compact className="mt-2 text-text-dark-secondary">{copy.machineSampled.replace("{count}", String(read))}</Compact>;
  }
  const reason = cited.find((source) => source.availability === "unavailable" && source.reason !== null)?.reason ?? null;
  if (reason === null || copy.machineReasons[reason] === undefined) return null;
  return <Compact className="mt-2 text-text-dark-secondary">{copy.machineReasons[reason]}</Compact>;
}

export function GeoMachineModuleView({ module, sources, heading, locale, copy, card }: GeoReadOnlyModuleProps<GeoModuleValueOf<GeoKnowledgePackV2["machine"]>>) {
  const machine = geoKbModuleValue(module);
  return <GeoKbModuleSection title={copy.sections.machine} heading={heading} state={geoKbModuleState(module)}>
    {machine === null ? null : <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {MACHINE_FIELDS.map((kind) => <div key={kind} data-machine-field={kind} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
        <span className="block text-[12px] text-text-dark-secondary">{copy.machineFields[kind]}</span>
        <Compact className="mt-1 font-medium">{copy.machineStatuses[machine[kind].status]}</Compact>
        {kind === "jsonLd" && machine.jsonLd.types.length > 0 ? <Compact className="mt-2 text-text-dark-secondary">{copy.fields.types}: {machine.jsonLd.types.join(" · ")}</Compact> : null}
        {kind === "hreflang" && machine.hreflang.locales.length > 0 ? <Compact className="mt-2 text-text-dark-secondary">{copy.fields.locales}: {machine.hreflang.locales.join(" · ")}</Compact> : null}
        <MachineNote kind={kind} status={machine[kind].status} refs={machine[kind].sourceRefs} sources={sources} copy={copy} />
        {kind === "sitemap" && machine.sitemap.status === "present" ? <Compact className="mt-2 text-text-dark-secondary">{copy.fields.sitemapUrls}: {machine.sitemap.urlCount}</Compact> : null}
        <Basis refs={machine[kind].sourceRefs} sources={sources} copy={copy} locale={locale} />
      </div>)}
      {/* Search use and training use are independent permissions: blocking
          GPTBot does not remove a page from AI Overviews, and Google-Extended
          governs training only. One combined verdict would misstate both. */}
      <div data-machine-field="aiCrawlers" className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
        <span className="block text-[12px] text-text-dark-secondary">{card.machine.aiCrawlers}</span>
        {([["search", card.machine.crawlerSearch], ["training", card.machine.crawlerTraining]] as const).map(([use, label]) => <div
          key={use}
          data-crawler-use={use}
          data-knowledge-copy="compact"
          className="mt-1 min-w-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]"
        >
          <span className="font-medium">{label}:</span>{" "}
          {machine.aiCrawlers[use].length === 0
            ? card.machine.crawlerNone
            : machine.aiCrawlers[use].map((row) => `${row.agent} ${card.machine.access[row.access]}`).join(" · ")}
        </div>)}
        <Basis refs={machine.aiCrawlers.sourceRefs} sources={sources} copy={copy} locale={locale} />
      </div>
      <div data-machine-field="snippets" className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
        <span className="block text-[12px] text-text-dark-secondary">{card.machine.snippets}</span>
        <Compact className="mt-1 font-medium">{card.machine.snippetStatuses[machine.snippets.status]}</Compact>
        <Basis refs={machine.snippets.sourceRefs} sources={sources} copy={copy} locale={locale} />
      </div>
    </div>}
  </GeoKbModuleSection>;
}

/**
 * A coverage row's section name, in the reader's language.
 *
 * The row's `label` is English prose the server wrote into the stored pack, and
 * rendering it verbatim put "Comparisons" in the middle of a Chinese page. The
 * id carries the key (`coverage:comparisons`), so the name is looked up; a row
 * whose key this copy does not know keeps whatever it was stored with.
 */
function coverageLabel(id: string, stored: string, copy: GeoKnowledgePackCopy): string {
  return copy.coverageLabels[id.slice(id.indexOf(":") + 1)] ?? stored;
}

export function GeoCoverageModuleView({ module, sources, heading, locale, copy }: GeoReadOnlyModuleProps<GeoModuleValueOf<GeoKnowledgePackV2["coverage"]>>) {
  const coverage = geoKbModuleValue(module);
  return <GeoKbModuleSection title={copy.sections.coverage} heading={heading} state={geoKbModuleState(module)}>
    <div className="space-y-4">{(coverage ?? []).map((item) => <div key={item.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-semibold text-text-dark-primary">{coverageLabel(item.id, item.label, copy)}</span>
        <span className="inline-flex rounded-full border border-brand-border-card px-2.5 py-1 text-[12px] text-text-dark-secondary">{copy.coverageStatuses[item.status]}</span>
      </div>
      {/* The stored summary is the server's English, written when the pack was
          assembled and the same sentence for every reason a section produced
          nothing. A `missing` row is rendered in the reader's language instead;
          `partial` keeps its stored limitation, which is specific. */}
      <Compact className="mt-3">{item.status === "missing" ? copy.coverageMissing : item.summary}</Compact>
      {item.nextAction === null ? null : <Compact className="mt-3 text-text-dark-secondary">{copy.fields.nextAction}: {copy.coverageNextAction}</Compact>}
      <Basis refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} />
    </div>)}</div>
  </GeoKbModuleSection>;
}

const RENDERERS: Readonly<Record<GeoKnowledgeModuleName, (props: ModuleProps) => ReactNode>> = {
  entity: EntityModule,
  facts: FactsModule,
  qa: QaModule,
  comparisons: ComparisonsModule,
  scope: ScopeModule,
  evidence: ({ pack, ...rest }) => <GeoEvidenceModuleView module={pack.evidence} {...rest} />,
  machine: ({ pack, ...rest }) => <GeoMachineModuleView module={pack.machine} {...rest} />,
  coverage: ({ pack, ...rest }) => <GeoCoverageModuleView module={pack.coverage} {...rest} />,
};

export function GeoKnowledgePackV2View({ pack, locale, heading = 3, modules = GEO_KNOWLEDGE_MODULES }: GeoKnowledgePackV2Props) {
  const copy = geoKnowledgePackCopy(locale);
  const card = useGeoKbCopy();
  const sources: SourceIndex = new Map(pack.sourceCatalogue.map((source) => [source.id, source]));
  const props: ModuleProps = { pack, sources, heading, locale, copy, card };
  return <div data-geo-knowledge-pack data-pack-version="v2" className="grid min-w-0 gap-6 text-text-dark-primary">
    {modules.map((name) => {
      const Module = RENDERERS[name];
      return <Module key={name} {...props} />;
    })}
  </div>;
}
