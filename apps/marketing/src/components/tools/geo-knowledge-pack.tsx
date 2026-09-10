"use client";

import type { ReactNode } from "react";

import { normalizeAccountWebsiteUrl } from "../../lib/account-websites/contracts.ts";
import type { GeoLimitationClause } from "../../lib/geo-tools/kb-knowledge-limitation.ts";
import type { GeoKnowledgePackV1 } from "../../lib/geo-tools/kb-knowledge-pack-contract.ts";
import type { GeoKnowledgePackV2 } from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";
import { GeoKbSection } from "./geo-kb-section.tsx";
import { GeoKnowledgePackV2View, type GeoKnowledgeModuleName } from "./geo-knowledge-pack-v2.tsx";
import { geoKnowledgePackCopy, type GeoKnowledgePackCopy } from "./geo-knowledge-pack-copy.ts";
import { useGeoKbCopy, type GeoKbCopy } from "./geo-kb-copy.ts";

type Heading = 3 | 4;
type Source = GeoKnowledgePackV1["sourceCatalogue"][number];

function Compact({ children, className = "", ...rest }: { readonly children: ReactNode; readonly className?: string } & Record<`data-${string}`, string | undefined>) {
  return <div {...rest} data-knowledge-copy="compact" className={`min-w-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere] ${className}`}>{children}</div>;
}

function Subheading({ heading, children, className = "" }: { readonly heading: Heading; readonly children: ReactNode; readonly className?: string }) {
  const Tag = (heading === 3 ? "h4" : "h5") as "h4" | "h5";
  return <Tag className={`min-w-0 break-words text-[15px] font-semibold leading-relaxed [overflow-wrap:anywhere] ${className}`}>{children}</Tag>;
}

function SafeLink({ url, children }: { readonly url: string; readonly children: ReactNode }) {
  const safe = /^https?:\/\//iu.test(url) && normalizeAccountWebsiteUrl(url) !== null;
  return safe
    ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-words text-brand-accent-text underline underline-offset-2 [overflow-wrap:anywhere]">{children}</a>
    : <span>{children}</span>;
}

function Definition({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <div className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
    <span className="block text-[12px] font-medium text-text-dark-secondary">{label}</span>
    <Compact className="mt-2 text-text-dark-primary">{children}</Compact>
  </div>;
}

function PublicSources({ refs, sources, copy, locale }: { readonly refs: readonly string[]; readonly sources: ReadonlyMap<string, Source>; readonly copy: GeoKnowledgePackCopy; readonly locale: string }) {
  const visible = refs.flatMap((ref) => {
    const source = sources.get(ref);
    return source === undefined || source.availability === "unavailable" ? [] : [source];
  }).filter((source, index, list) => list.findIndex((candidate) => candidate.id === source.id) === index);
  if (visible.length === 0) return null;
  return <div data-public-sources className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-relaxed text-text-dark-secondary">
    <span>{copy.evidenceBasis}:</span>
    {visible.map((source, index) => <span key={source.id} className="min-w-0">{index === 0 ? "" : "· "}{source.url === null ? source.label : <SafeLink url={source.url}>{source.label}</SafeLink>}{source.observedAt === null ? null : <> <span>({formatDate(source.observedAt, locale)})</span></>}</span>)}
  </div>;
}

/**
 * A v1 module's limitation, localized where the pack carries the keys for it.
 *
 * v1 packs are old by definition, so most reach this with `limitationKeys`
 * absent and render the server's English -- which is the only thing they store.
 * A v1 pack built after 2026-09-10 carries the keys and reads in the reader's
 * language, the same way the v2/v3 card does.
 */
function Limitation({ module, copy, card }: {
  readonly module: { readonly limitation: string; readonly limitationKeys?: readonly GeoLimitationClause[] };
  readonly copy: GeoKnowledgePackCopy;
  readonly card: GeoKbCopy;
}) {
  const localized = module.limitationKeys === undefined ? null : card.module.limitation(module.limitationKeys);
  return <Compact data-module-limitation={localized === null ? "stored" : "localized"} className="mb-5 rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3 text-text-dark-secondary"><span className="font-medium text-text-dark-primary">{copy.partial}:</span> {localized ?? module.limitation}</Compact>;
}

function Unavailable({ reason, copy }: { readonly reason: keyof GeoKnowledgePackCopy["unavailable"]; readonly copy: GeoKnowledgePackCopy }) {
  return <Compact className="rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-4 text-text-dark-secondary">{copy.unavailable[reason]}</Compact>;
}

function ModuleFrame({ title, heading, children }: { readonly title: string; readonly heading: Heading; readonly children: ReactNode }) {
  return <GeoKbSection title={title} heading={heading}>{children}</GeoKbSection>;
}

function TextList({ values, empty }: { readonly values: readonly string[]; readonly empty: string }) {
  return values.length === 0
    ? <Compact className="text-text-dark-secondary">{empty}</Compact>
    : <ul className="space-y-2 text-[13px] leading-relaxed">{values.map((value, index) => <li key={index} className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</li>)}</ul>;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function GeoKnowledgePackV1View({ pack, locale, heading = 3 }: { readonly pack: GeoKnowledgePackV1; readonly locale: string; readonly heading?: Heading }) {
  const copy = geoKnowledgePackCopy(locale);
  const card = useGeoKbCopy();
  const sources = new Map(pack.sourceCatalogue.map((source) => [source.id, source]));
  const entity = pack.entity;
  const facts = pack.facts;
  const qa = pack.qa;
  const comparisons = pack.comparisons;
  const scope = pack.scope;
  const evidence = pack.evidence;
  const machine = pack.machine;
  const coverage = pack.coverage;

  return <div data-geo-knowledge-pack className="grid min-w-0 gap-6 text-text-dark-primary">
    <ModuleFrame title={copy.sections.entity} heading={heading}>
      {entity.status === "unavailable" ? <Unavailable reason={entity.reason} copy={copy} /> : <>
        {entity.status === "partial" ? <Limitation module={entity} copy={copy} card={card} /> : null}
        <Subheading heading={heading} className="text-[17px]">{entity.value.name}</Subheading>
        <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-3">
          <Definition label={copy.fields.shortDefinition}>{entity.value.definitions.w25}</Definition>
          <Definition label={copy.fields.standardDefinition}>{entity.value.definitions.w55}</Definition>
          <Definition label={copy.fields.detailedDefinition}>{entity.value.definitions.w120}</Definition>
        </div>
        <dl className="mt-6 grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2">
          <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.aliases}</dt><dd className="mt-1"><TextList values={entity.value.aliases} empty={copy.none} /></dd></div>
          <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.categories}</dt><dd className="mt-1"><TextList values={[entity.value.categories.primary, ...entity.value.categories.secondary]} empty={copy.none} /></dd></div>
          <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.audience}</dt><dd className="mt-1"><Compact>{entity.value.audience.who}</Compact></dd></div>
          <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.notFor}</dt><dd className="mt-1"><Compact className={entity.value.audience.notFor === null ? "text-text-dark-secondary" : ""}>{entity.value.audience.notFor ?? copy.notRecorded}</Compact></dd></div>
          {entity.value.disambiguation === null ? null : <div className="sm:col-span-2"><dt className="text-[12px] text-text-dark-secondary">{copy.fields.disambiguation}</dt><dd className="mt-1"><Compact>{entity.value.disambiguation}</Compact></dd></div>}
          <div className="sm:col-span-2"><dt className="text-[12px] text-text-dark-secondary">{copy.fields.officialLinks}</dt><dd className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-[13px] leading-relaxed">
            {Object.entries(entity.value.links).flatMap(([label, url]) => url === null ? [] : [<SafeLink key={label} url={url}>{label}</SafeLink>])}
            {entity.value.sameAs.map((url) => <SafeLink key={url} url={url}>{new URL(url).hostname}</SafeLink>)}
          </dd></div>
        </dl>
        <PublicSources refs={entity.value.sourceRefs} sources={sources} copy={copy} locale={locale} />
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.facts} heading={heading}>
      {facts.status === "unavailable" ? <Unavailable reason={facts.reason} copy={copy} /> : <>
        {facts.status === "partial" ? <Limitation module={facts} copy={copy} card={card} /> : null}
        <div className="space-y-4">{facts.value.map((fact) => <article key={fact.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
          <span className="inline-flex rounded-full border border-brand-border-card px-2.5 py-1 text-[12px] text-text-dark-secondary">{copy.factTypes[fact.type]}</span>
          <Compact className="mt-3 text-[14px] text-text-dark-primary">{fact.statement}</Compact>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-text-dark-secondary">
            {fact.observedAt === null ? null : <span>{copy.fields.observedAt}: {formatDate(fact.observedAt, locale)}</span>}
            {fact.nextReviewAt === null ? null : <span>{copy.fields.nextReviewAt}: {formatDate(fact.nextReviewAt, locale)}</span>}
          </div>
          <PublicSources refs={fact.sourceRefs} sources={sources} copy={copy} locale={locale} />
        </article>)}</div>
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.qa} heading={heading}>
      {qa.status === "unavailable" ? <Unavailable reason={qa.reason} copy={copy} /> : <>
        {qa.status === "partial" ? <Limitation module={qa} copy={copy} card={card} /> : null}
        <div className="space-y-4">{qa.value.map((item) => <article key={item.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
          <span className="inline-flex rounded-full border border-brand-border-card px-2.5 py-1 text-[12px] text-text-dark-secondary">{copy.intents[item.intent]}</span>
          <Subheading heading={heading} className="mt-3">{item.question}</Subheading>
          <dl className="mt-4 space-y-4">
            <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.directAnswer}</dt><dd className="mt-1"><Compact>{item.directAnswer}</Compact></dd></div>
            {item.expansion === null ? null : <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.detail}</dt><dd className="mt-1"><Compact>{item.expansion}</Compact></dd></div>}
            {item.variants.length === 0 ? null : <div><dt className="text-[12px] text-text-dark-secondary">{copy.fields.variants}</dt><dd className="mt-1"><TextList values={item.variants} empty={copy.none} /></dd></div>}
          </dl>
          <PublicSources refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} />
        </article>)}</div>
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.comparisons} heading={heading}>
      {comparisons.status === "unavailable" ? <Unavailable reason={comparisons.reason} copy={copy} /> : <>
        {comparisons.status === "partial" ? <Limitation module={comparisons} copy={copy} card={card} /> : null}
        <div className="space-y-5">{comparisons.value.map((comparison) => <article key={comparison.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><Subheading heading={heading}>{comparison.competitor.name}</Subheading><span className="text-[12px] text-text-dark-secondary">{copy.fields.checkedAt}: {formatDate(comparison.checkedAt, locale)}</span></div>
          <table className="mt-4 block w-full table-fixed text-left sm:table"><caption className="sr-only">{copy.sections.comparisons}: {comparison.competitor.name}</caption>
            <thead className="hidden sm:table-header-group"><tr><th scope="col" className="border-b border-brand-border-strong px-3 pb-3 text-[12px] font-medium text-text-dark-secondary">&nbsp;</th><th scope="col" className="border-b border-brand-border-strong px-3 pb-3 text-[12px] font-medium text-text-dark-secondary">{copy.fields.product}</th><th scope="col" className="border-b border-brand-border-strong px-3 pb-3 text-[12px] font-medium text-text-dark-secondary">{comparison.competitor.name}</th></tr></thead>
            <tbody className="block sm:table-row-group">{comparison.rows.map((row) => <tr key={row.id} className="mb-3 grid gap-3 border-b border-brand-border-card pb-3 last:mb-0 last:border-b-0 last:pb-0 sm:mb-0 sm:table-row sm:pb-0">
              <th scope="row" className="block text-[13px] font-medium sm:table-cell sm:border-b sm:border-brand-border-card sm:px-3 sm:py-4 sm:align-top">{row.dimension}<span data-comparison-row-status className="mt-1 block text-[12px] font-normal text-text-dark-secondary">{copy.comparisonStatuses[row.availability]}</span></th>
              <td className="block text-[13px] leading-relaxed sm:table-cell sm:border-b sm:border-brand-border-card sm:px-3 sm:py-4 sm:align-top"><span className="mb-1 block text-[12px] text-text-dark-secondary sm:hidden">{copy.fields.product}</span>{row.product ?? copy.comparisonStatuses[row.availability]}</td>
              <td className="block text-[13px] leading-relaxed sm:table-cell sm:border-b sm:border-brand-border-card sm:px-3 sm:py-4 sm:align-top"><span className="mb-1 block text-[12px] text-text-dark-secondary sm:hidden">{comparison.competitor.name}</span>{row.competitor ?? copy.comparisonStatuses[row.availability]}</td>
            </tr>)}</tbody>
          </table>
          <div className="mt-4 border-t border-brand-border-card pt-4"><span className="block text-[12px] text-text-dark-secondary">{copy.fields.verdict}</span><Compact className="mt-1">{comparison.verdict}</Compact></div>
          <PublicSources refs={comparison.sourceRefs} sources={sources} copy={copy} locale={locale} />
        </article>)}</div>
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.scope} heading={heading}>
      {scope.status === "unavailable" ? <Unavailable reason={scope.reason} copy={copy} /> : <>
        {scope.status === "partial" ? <Limitation module={scope} copy={copy} card={card} /> : null}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">{(["does", "doesNot", "needsHuman", "misconceptions"] as const).map((kind) => <section key={kind} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
          <Subheading heading={heading}>{copy.scopeGroups[kind]}</Subheading>
          <ul className="mt-3 space-y-3">{scope.value[kind].map((item) => <li key={item.id}><Compact>{item.text}</Compact><PublicSources refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} /></li>)}</ul>
        </section>)}</div>
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.evidence} heading={heading}>
      {evidence.status === "unavailable" ? <Unavailable reason={evidence.reason} copy={copy} /> : <>
        {evidence.status === "partial" ? <Limitation module={evidence} copy={copy} card={card} /> : null}
        <div className="grid min-w-0 gap-5 sm:grid-cols-2">{(["proof", "changelog", "press", "thirdPartyProfiles"] as const).flatMap((kind) => evidence.value[kind].length === 0 ? [] : [<section key={kind} className="min-w-0">
          <Subheading heading={heading}>{copy.evidenceGroups[kind]}</Subheading>
          <ul className="mt-3 space-y-3">{evidence.value[kind].map((item) => <li key={item.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
            <Compact className="font-medium">{item.url === null ? item.label : <SafeLink url={item.url}>{item.label}</SafeLink>}</Compact>
            <Compact className="mt-1 text-text-dark-secondary">{item.summary}</Compact>
            <PublicSources refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} />
          </li>)}</ul>
        </section>])}</div>
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.machine} heading={heading}>
      {machine.status === "unavailable" ? <Unavailable reason={machine.reason} copy={copy} /> : <>
        {machine.status === "partial" ? <Limitation module={machine} copy={copy} card={card} /> : null}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(["jsonLd", "llms", "robots", "sitemap", "hreflang"] as const).map((kind) => {
            const item = machine.value[kind];
            return <section key={kind} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
              <span className="block text-[12px] text-text-dark-secondary">{copy.machineFields[kind]}</span>
              <Compact className="mt-1 font-medium">{copy.machineStatuses[item.status]}</Compact>
              {kind === "jsonLd" && machine.value.jsonLd.types.length > 0 ? <Compact className="mt-2 text-text-dark-secondary">{copy.fields.types}: {machine.value.jsonLd.types.join(" · ")}</Compact> : null}
              {kind === "hreflang" && machine.value.hreflang.locales.length > 0 ? <Compact className="mt-2 text-text-dark-secondary">{copy.fields.locales}: {machine.value.hreflang.locales.join(" · ")}</Compact> : null}
              {kind === "sitemap" && machine.value.sitemap.status === "present" ? <Compact className="mt-2 text-text-dark-secondary">{copy.fields.sitemapUrls}: {machine.value.sitemap.urlCount}<br />{copy.fields.knowledgePages}: {machine.value.sitemap.knowledgePagesListed ? copy.yes : copy.no}</Compact> : null}
              <PublicSources refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} />
            </section>;
          })}
        </div>
      </>}
    </ModuleFrame>

    <ModuleFrame title={copy.sections.coverage} heading={heading}>
      {coverage.status === "unavailable" ? <Unavailable reason={coverage.reason} copy={copy} /> : <>
        {coverage.status === "partial" ? <Limitation module={coverage} copy={copy} card={card} /> : null}
        <div className="space-y-4">{coverage.value.map((item) => <article key={item.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3"><Subheading heading={heading}>{item.label}</Subheading><span className="inline-flex rounded-full border border-brand-border-card px-2.5 py-1 text-[12px] text-text-dark-secondary">{copy.coverageStatuses[item.status]}</span></div>
          <Compact className="mt-3">{item.summary}</Compact>
          {item.nextAction === null ? null : <div className="mt-3"><span className="block text-[12px] text-text-dark-secondary">{copy.fields.nextAction}</span><Compact className="mt-1">{item.nextAction}</Compact></div>}
          <PublicSources refs={item.sourceRefs} sources={sources} copy={copy} locale={locale} />
        </article>)}</div>
      </>}
    </ModuleFrame>
  </div>;
}

/**
 * The published schema this file dispatches on, declared as the contract's own
 * literal type. Renaming the schema in the contract fails to compile here
 * rather than silently routing every v2 pack to the v1 renderer, which would
 * drop origin, decision and the collected/empty distinction without an error.
 */
const PACK_V2_SCHEMA: GeoKnowledgePackV2["schemaVersion"] = "marketing-geo-knowledge-pack.v2";

/**
 * v1 packs keep the renderer they were written against, byte for byte. They
 * carry no `origin`, no `decision` and no `collected`, so drawing them through
 * the v2 renderer would have to invent all three; a historical version is
 * shown as what it actually recorded.
 */
export function GeoKnowledgePack({ pack, locale, heading = 3, modules }: {
  readonly pack: GeoKnowledgePackV1 | GeoKnowledgePackV2;
  readonly locale: string;
  readonly heading?: Heading;
  /** v2 only: which of the eight modules to draw, so the card can group them. */
  readonly modules?: readonly GeoKnowledgeModuleName[];
}) {
  return pack.schemaVersion === PACK_V2_SCHEMA
    ? <GeoKnowledgePackV2View pack={pack} locale={locale} heading={heading} modules={modules} />
    : <GeoKnowledgePackV1View pack={pack} locale={locale} heading={heading} />;
}
