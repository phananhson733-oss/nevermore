"use client";
// @input -- validated account context with separate current Profile and exact frozen input
// @output -- compact, complete read-only source inspection; no implicit sync or historical fill
// @pos -- AI Visibility input provenance and frozen question preview
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { normalizeAccountWebsiteUrl, type MarketingWebsiteProfileV1, type WebsiteProfileFieldName, type WebsiteProfileReferenceV1 } from "../../lib/account-websites/contracts.ts";
import type { GeoKbPayload } from "../../lib/geo-tools/kb-contract.ts";
import { geoProfileMeasurementDifferences } from "../../lib/geo-tools/kb-profile-suggestions.ts";
import type { VisibilityWebsiteContext } from "../../lib/geo-tools/visibility-context.ts";
import { localePath } from "../../lib/locale-path.ts";

const DISCLOSURE = "min-w-0 border-t border-brand-border-card py-4";
const SUMMARY = "cursor-pointer text-sm font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent";
const GRID = "mt-4 grid min-w-0 gap-x-8 gap-y-4 text-sm sm:grid-cols-2";
const LINK = "break-all text-brand-accent-text underline decoration-brand-accent/40 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent";
const GROUPS = [
  { title: "product", fields: ["productName", "oneLinePositioning", "valueProposition", "coreFeatures", "categories", "businessModel", "primaryCta", "trustSignals", "firstOutcome"] },
  { title: "audience", fields: ["primaryIcp", "buyer", "user", "triggerPain", "icpInterests", "icpPain", "icpBehavior", "icpPositioning", "jtbd", "useCases", "outcomes", "barriers", "qualificationSignals", "disqualifiers"] },
  { title: "market", fields: ["country", "locale"] },
  { title: "competitors", fields: ["directCompetitors", "indirectAlternatives", "excludedAlternatives"] },
] as const satisfies readonly { readonly title: string; readonly fields: readonly WebsiteProfileFieldName[] }[];

function Row({ label, children, mono = false }: { readonly label: string; readonly children: ReactNode; readonly mono?: boolean }) {
  return <div className="min-w-0"><dt className="mb-1 text-xs text-text-dark-secondary">{label}</dt><dd className={`m-0 whitespace-pre-wrap break-words text-text-dark-primary ${mono ? "font-mono text-xs [overflow-wrap:anywhere]" : ""}`}>{children}</dd></div>;
}
function Value({ value }: { readonly value: string | readonly string[] }) {
  const t = useTranslations("tools.aiVisibility");
  if (value.length === 0) return <span className="text-text-dark-secondary">{t("source.empty")}</span>;
  return typeof value === "string" ? value : <ul className="m-0 list-inside list-disc space-y-1">{value.map((entry, i) => <li key={i}>{entry}</li>)}</ul>;
}
function SourceLink({ url }: { readonly url: string }) {
  if (!/^https?:\/\//iu.test(url) || normalizeAccountWebsiteUrl(url) === null) return <Value value={url} />;
  const parsed = new URL(url);
  return <a className={LINK} href={url} title={url} target="_blank" rel="noopener noreferrer">{parsed.host}{parsed.pathname === "/" ? "" : parsed.pathname}</a>;
}
function Timestamp({ value, locale }: { readonly value: string; readonly locale: string }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC</time>;
}
function ProfileIdentity({ reference }: { readonly reference: WebsiteProfileReferenceV1 }) {
  const t = useTranslations("tools.aiVisibility");
  return <dl className={GRID}>
    <Row label={t("source.revision")}>{t("source.currentVersion", { version: reference.snapshotRevision })}</Row>
    <Row label={t("source.websiteId")} mono>{reference.websiteId}</Row>
    <Row label={t("source.snapshotId")} mono>{reference.snapshotId}</Row>
    <Row label={t("source.profileHash")} mono>{reference.profileHash}</Row>
    <Row label={t("source.schemaVersion")} mono>{reference.profileSchemaVersion}</Row>
    <Row label={t("source.referenceSchema")} mono>{reference.schemaVersion}</Row>
  </dl>;
}
function CompleteProfile({ profile, locale }: { readonly profile: MarketingWebsiteProfileV1; readonly locale: string }) {
  const t = useTranslations("tools.aiVisibility");
  return <div className="mt-5 min-w-0">
    {GROUPS.map(group => <details className={DISCLOSURE} key={group.title}>
      <summary className={SUMMARY}>{t(`source.sections.${group.title}`)}</summary>
      <dl className={GRID}>{group.fields.map(field => <div key={field} data-profile-field={field} className="min-w-0">
        <dt className="mb-1 text-xs text-text-dark-secondary">{t(`source.fields.${field}`)}</dt>
        <dd className="m-0 whitespace-pre-wrap break-words text-text-dark-primary"><Value value={profile[field]} /></dd>
      </div>)}</dl>
    </details>)}
    <details className={DISCLOSURE}>
      <summary className={SUMMARY}>{t("source.sections.provenance")}</summary>
      {profile.fieldProvenance.length === 0 ? <p className="mt-3 text-sm text-text-dark-secondary">{t("source.provenanceEmpty")}</p> : <ul className="mt-4 space-y-4">
        {profile.fieldProvenance.map(entry => <li key={entry.path} className="min-w-0 border-l-2 border-brand-border-card pl-4 text-sm">
          <p className="font-medium">{t(`source.fields.${entry.path.slice(1)}`)}</p>
          <p className="mt-1 text-xs text-text-dark-secondary">{t(`source.provenanceSources.${entry.source}`)} · {t(`source.derivations.${entry.derivation}`)} · {t(`source.confidences.${entry.confidence}`)}</p>
          {entry.observedAt !== null && <p className="mt-1 text-xs text-text-dark-secondary">{t("source.observedAt")}: <Timestamp value={entry.observedAt} locale={locale} /></p>}
          {entry.limitation !== null && <p className="mt-2 whitespace-pre-wrap break-words text-text-dark-secondary">{entry.limitation}</p>}
          {entry.evidenceUrls.length > 0 && <ul className="mt-2 space-y-1">{entry.evidenceUrls.map(url => <li key={url} className="min-w-0"><SourceLink url={url} /></li>)}</ul>}
        </li>)}
      </ul>}
    </details>
  </div>;
}
function MeasurementInput({ payload }: { readonly payload: GeoKbPayload }) {
  const t = useTranslations("tools.aiVisibility");
  return <div className="mt-6 min-w-0 border-t border-brand-border-card pt-5">
    <h4 className="font-medium text-text-dark-primary">{t("source.measurement")}</h4>
    <p className="mt-2 text-sm text-text-dark-secondary">{t("source.measurementNote")}</p>
    <dl className={GRID}>
      <Row label={t("source.targetUrl")}><SourceLink url={payload.targetUrl} /></Row>
      <Row label={t("source.officialName")}><Value value={payload.officialName} /></Row>
      <Row label={t("source.aliases")}><Value value={payload.aliases} /></Row>
      <Row label={t("source.categoryTerms")}><Value value={payload.categoryTerms} /></Row>
      <Row label={t("source.market")}>{payload.market.country} / {payload.market.language}</Row>
      <Row label={t("source.schemaVersion")} mono>{payload.schemaVersion}</Row>
    </dl>
    <details className={`mt-5 ${DISCLOSURE}`}><summary className={SUMMARY}>{t("source.roles")} · {payload.roles.length}</summary>
      {payload.roles.length === 0 ? <p className="mt-3 text-sm"><Value value="" /></p> : <ul className="mt-3 divide-y divide-brand-border-card">{payload.roles.map(role => <li key={role.id} className="pb-4">
        <dl className={GRID}>
          <Row label={t("source.roleLabel")}><Value value={role.label} /></Row><Row label={t("source.roleId")} mono>{role.id}</Row>
          <Row label={t("source.segment")}><Value value={role.segment} /></Row><Row label={t("source.painPoints")}><Value value={role.painPoints} /></Row>
          <Row label={t("source.decisionCriteria")}><Value value={role.decisionCriteria} /></Row><Row label={t("source.vocabulary")}><Value value={role.vocabulary} /></Row>
        </dl>
      </li>)}</ul>}
    </details>
    <details className={DISCLOSURE}><summary className={SUMMARY}>{t("source.competitors")} · {payload.competitors.length}</summary>
      {payload.competitors.length === 0 ? <p className="mt-3 text-sm"><Value value="" /></p> : <ul className="mt-3 divide-y divide-brand-border-card">{payload.competitors.map((entry, i) => <li key={i} className="py-4">
        <p className={`text-xs ${entry.confirmed ? "text-brand-accent-text" : "text-text-dark-secondary"}`}>{t(entry.confirmed ? "source.confirmed" : "source.unconfirmed")}</p>
        <dl className={GRID}><Row label={t("source.competitorDomain")}><Value value={entry.domain} /></Row><Row label={t("source.competitorBrand")}><Value value={entry.brandName} /></Row><Row label={t("source.competitorAliases")}><Value value={entry.aliases ?? []} /></Row></dl>
      </li>)}</ul>}
    </details>
    <details className={DISCLOSURE}><summary className={SUMMARY}>{t("source.facts")} · {payload.facts.length}</summary>
      {payload.facts.length === 0 ? <p className="mt-3 text-sm"><Value value="" /></p> : <ul className="mt-3 divide-y divide-brand-border-card">{payload.facts.map(entry => <li key={entry.key} className="pb-4"><dl className={GRID}>
        <Row label={t("source.factKey")}><Value value={entry.key} /></Row><Row label={t("source.factValue")}><Value value={entry.value} /></Row>
        <Row label={t("source.factReason")}>{entry.reason === "" ? t("source.factVerified") : t(`source.factReasons.${entry.reason}`)}</Row>
        <Row label={t("source.factSource")}><SourceLink url={entry.sourceUrl} /></Row>
        <Row label={t("source.observedAt")}><Value value={entry.observedAt} /></Row>
      </dl></li>)}</ul>}
    </details>
    <details className={DISCLOSURE}><summary className={SUMMARY}>{t("source.importedFrom")}</summary>
      {payload.importedFrom === null ? <p className="mt-3 text-sm"><Value value="" /></p> : <dl className={GRID}>
        <Row label={t("source.websiteId")} mono>{payload.importedFrom.websiteId}</Row><Row label={t("source.snapshotId")} mono>{payload.importedFrom.snapshotId}</Row><Row label={t("source.revision")}>{payload.importedFrom.snapshotRevision}</Row>
      </dl>}
    </details>
  </div>;
}

export function AiVisibilitySource({ site, locale, historical = false }: { readonly site: VisibilityWebsiteContext; readonly locale: string; readonly historical?: boolean }) {
  const t = useTranslations("tools.aiVisibility");
  const { currentProfile, frozen, preparation } = site;
  const measurementDifferences = frozen?.payload.profileCopy === undefined ? [] : geoProfileMeasurementDifferences(frozen.payload.profileCopy.profile, frozen.payload);
  const differenceLabels = { officialName: "officialName", categoryTerms: "categoryTerms", market: "market", roles: "roles", competitors: "competitors" } as const;
  return <section data-testid="visibility-source" aria-label={t("source.title")} className="min-w-0 rounded-xl border border-brand-border-card bg-brand-panel px-5 py-5 font-sans sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="font-semibold text-text-dark-primary">{t("source.title")}</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-dark-secondary">{t(historical ? "source.historical" : "source.subtitle")}</p></div>
      {!historical && <span className="rounded border border-brand-border-card px-2 py-1 font-mono text-xs text-text-dark-primary">{t(`source.status.${preparation.status}`)}</span>}
    </div>
    {!historical && <div className="my-4 space-y-2 text-sm text-text-dark-secondary">
      <p>{t(`source.sync.${preparation.profileSync}`)}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2"><a className={LINK} href={localePath(locale, `/account/websites/${site.website.websiteId}`)}>{t("source.settings")}</a><a className={LINK} href={localePath(locale, `/account/websites/${site.website.websiteId}/geo`)}>{t(frozen === null ? "source.prepare" : "source.review")}</a></div>
    </div>}
    {measurementDifferences.length > 0 && <p data-source="measurement-differences" className="my-4 border-l-2 border-brand-border-strong pl-3 text-sm leading-relaxed text-text-dark-secondary">{t("source.measurementDifferences", { fields: measurementDifferences.map(field => t(`source.${differenceLabels[field]}`)).join(" · ") })}</p>}
    {preparation.languageWarnings.length > 0 && <ul className="my-4 space-y-1 border-l-2 border-brand-warning pl-3 text-sm text-text-dark-primary">{preparation.languageWarnings.map(warning => <li key={warning}>{t(`source.warnings.${warning}`)}</li>)}</ul>}
    {!historical && (currentProfile === null ? <p className="py-4 text-sm text-text-dark-secondary">{t("source.emptyProfile")}</p> : <details data-source="current-profile" className={DISCLOSURE}>
      <summary className={SUMMARY}>{t("source.currentTitle")} <span className="ml-2 font-mono text-xs text-text-dark-secondary">{t("source.currentVersion", { version: currentProfile.reference.snapshotRevision })}</span></summary>
      <p className="mt-3 text-sm text-text-dark-secondary">{t("source.currentDescription")}</p>
      <p className="mt-2 text-xs text-text-dark-secondary">{t("source.confirmedAt")}: <Timestamp value={currentProfile.confirmedAt} locale={locale} /></p>
      <ProfileIdentity reference={currentProfile.reference} /><CompleteProfile profile={currentProfile.profile} locale={locale} />
    </details>)}
    {frozen === null ? <p className="border-t border-brand-border-card py-4 text-sm text-text-dark-secondary">{t("source.emptyFrozen")}</p> : <>
      <details data-source="frozen" className={DISCLOSURE}>
        <summary className={SUMMARY}>{t("source.frozenTitle")} <span className="ml-2 font-mono text-xs text-text-dark-secondary">{t("source.frozenVersion", { version: frozen.revision })}</span></summary>
        <p className="mt-3 text-sm text-text-dark-secondary">{t("source.frozenDescription")}</p>
        <dl className={GRID}>
          <Row label={t("source.frozenAt")}><Timestamp value={frozen.frozenAt} locale={locale} /></Row><Row label={t("source.snapshotId")} mono>{frozen.snapshotId}</Row>
          <Row label={t("source.websiteId")} mono>{site.website.websiteId}</Row><Row label={t("source.knowledgeBaseId")} mono><Value value={site.knowledgeBase?.kbId ?? ""} /></Row>
          <Row label={t("source.contentHash")} mono>{frozen.contentHash}</Row><Row label={t("source.questionSetHash")} mono>{frozen.questionSetHash}</Row>
          <Row label={t("source.registryVersion")} mono>{frozen.registryVersion}</Row>
        </dl>
        {frozen.payload.profileCopy === undefined ? <p className="mt-5 border-l-2 border-brand-border-strong pl-3 text-sm text-text-dark-secondary">{t("source.legacy")}</p> : <details className={`mt-5 ${DISCLOSURE}`}>
          <summary className={SUMMARY}>{t("source.profileCopy")}</summary>
          <p className="mt-3 break-all font-mono text-xs text-text-dark-secondary">{frozen.payload.profileCopy.schemaVersion}</p>
          {frozen.profileReference !== null && <ProfileIdentity reference={frozen.profileReference} />}
          <CompleteProfile profile={frozen.payload.profileCopy.profile} locale={locale} />
        </details>}
        <MeasurementInput payload={frozen.payload} />
      </details>
      <details data-source="questions" data-testid="frozen-question-preview" className={DISCLOSURE}>
        <summary className={SUMMARY}>{t("source.questions", { count: frozen.questionCount })}</summary>
        <p className="mt-3 text-sm text-text-dark-secondary">{t("source.questionNote")}</p>
        <p className="mt-2 font-mono text-xs text-text-dark-secondary">{t("source.questionCounts", { total: frozen.questionCount, retrieval: frozen.retrievalCount })}</p>
        {frozen.skippedLayers.length > 0 && <p className="mt-2 text-xs text-text-dark-secondary">{t("source.skippedLayers")}: {frozen.skippedLayers.map(layer => t(`source.layers.${layer}`)).join(" · ")}</p>}
        <ol className="mt-4 divide-y divide-brand-border-card">{frozen.questions.map((question, index) => <li key={question.id} className="min-w-0 py-4">
          <div className="flex gap-3"><span className="shrink-0 font-mono text-xs text-text-dark-secondary">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="whitespace-pre-wrap break-words text-sm text-text-dark-primary">{question.text}</p><p className="mt-2 text-xs text-text-dark-secondary">{t(`source.layers.${question.layer}`)} · {t(`source.modes.${question.mode}`)} · {t(question.calibrated ? "source.calibrated" : "source.uncalibrated")}</p></div></div>
          <details className="ml-7 mt-3"><summary className={`${SUMMARY} text-xs`}>{t("source.identity")}</summary><dl className={GRID}>
            <Row label={t("source.questionId")} mono>{question.id}</Row><Row label={t("source.questionTemplate")} mono><Value value={question.templateId ?? ""} /></Row>
            <Row label={t("source.roleId")} mono><Value value={question.roleId ?? ""} /></Row><Row label={t("source.requiredEntities")}><Value value={question.requiredEntities} /></Row>
          </dl></details>
        </li>)}</ol>
      </details>
    </>}
  </section>;
}
