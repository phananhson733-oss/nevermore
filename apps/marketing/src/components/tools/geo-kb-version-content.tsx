"use client";
// @input -- one complete, already validated V2 payload/question/context version
// @output -- shared read-only candidate/frozen content in the Profile visual language
// @pos -- no current-Profile lookup, requests, source mutation or hash computation
import type { GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoQuestionSetV2 } from "../../lib/geo-tools/kb-question-set-v2.ts";
import type { GeoCompetitorEvidenceV2, GeoSnapshotContextV2 } from "../../lib/geo-tools/snapshot-context-v2.ts";
import { useId, type ReactNode } from "react";
import { normalizeAccountWebsiteUrl } from "../../lib/account-websites/contracts.ts";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";
import { geoKbV2Copy, type GeoKbV2Copy } from "./geo-kb-v2-copy.ts";

export interface GeoKbVersionContentProps {
  readonly payload: GeoKbPayloadV2;
  readonly questionSet: GeoQuestionSetV2;
  readonly context: GeoSnapshotContextV2;
  readonly locale: string;
}
function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
    <h3 id={id} className="-mx-5 -mt-5 mb-5 flex items-center gap-3 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7"><span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />{title}</h3>
    {children}
  </section>;
}
function Info({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <div className="min-w-0 space-y-1.5"><dt className="text-[12px] text-text-dark-secondary">{label}</dt><dd className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text-dark-primary [overflow-wrap:anywhere]">{children}</dd></div>;
}
function List({ values, empty }: { readonly values: readonly string[]; readonly empty: string }) {
  return values.length === 0 ? <span className="text-text-dark-secondary">{empty}</span> : <ul className="space-y-1.5">{values.map((value, index) => <li key={index} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</li>)}</ul>;
}
function SourceUrl({ value, empty }: { readonly value: string | null | undefined; readonly empty: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-text-dark-secondary">{empty}</span>;
  return /^https?:\/\//iu.test(value) && normalizeAccountWebsiteUrl(value) !== null
    ? <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-brand-accent-text underline underline-offset-2">{value}</a>
    : <span className="break-all">{value}</span>;
}
function Review({ value, copy }: { readonly value: GeoKbPayloadV2["roles"][number]["review"]; readonly copy: GeoKbV2Copy }) {
  return <span className="inline-flex rounded-full border border-brand-border-card bg-brand-bg px-2.5 py-1 text-[12px] text-text-dark-secondary">{copy.reviews[value]}</span>;
}
const text = (value: string | number | null | undefined, empty: string): string | number => value === null || value === undefined || value === "" ? empty : value;
const yesNo = (value: boolean | null | undefined, copy: GeoKbV2Copy): string => value === true ? copy.yes : value === false ? copy.no : copy.unknown;

function Roles({ payload, context, copy }: { readonly payload: GeoKbPayloadV2; readonly context: GeoSnapshotContextV2; readonly copy: GeoKbV2Copy }) {
  const policies = new Map(context.roles.map(role => [role.roleId, role]));
  const catalog = new Map(context.evidenceCatalog.map(item => [item.id, item]));
  return <Panel title={copy.sections.roles}>
    {payload.roles.length === 0 ? <p className="text-sm text-text-dark-secondary">{copy.empty}</p> : <div className="space-y-5">{payload.roles.map(role => {
      const policy = policies.get(role.id);
      const refs = [...new Set(role.source.evidenceRefs)], evidence = refs.flatMap(ref => catalog.has(ref) ? [catalog.get(ref)!] : []);
      const missing = refs.length !== evidence.length;
      const queries = new Set(evidence.filter(item => item.kind === "gsc").map(item => item.text));
      const basis = (["profile", "gsc", "crawl", "manual"] as const).filter(kind => evidence.some(item => item.kind === kind));
      return <article key={role.id} data-version-role={role.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3"><h4 className="break-words text-[15px] font-semibold [overflow-wrap:anywhere]">{text(role.label, copy.empty)}</h4><Review value={role.review} copy={copy} /></div>
        <div className="mb-5 space-y-2 text-[13px] leading-relaxed">
          <p data-role-source-badge className="inline-flex flex-wrap rounded-full border border-brand-border-card px-3 py-1.5 text-text-dark-secondary">{evidence.length === 0 ? missing ? copy.roleEvidence.missingEvidence : copy.roleEvidence.noEvidence : [role.source.kind === "model" ? copy.roleEvidence.inference : copy.sources[role.source.kind], ...basis.map(kind => copy.roleEvidence.basis[kind])].join(" · ")}</p>
          {queries.size > 0 ? <><p>{copy.roleEvidence.referencedQueries}: <span data-role-referenced-query-count>{queries.size}</span></p><p className="text-text-dark-secondary">{copy.roleEvidence.queryHelp}</p></> : !missing ? <p className="text-text-dark-secondary">{copy.roleEvidence.noQueries}</p> : null}
          {missing ? <p data-role-source-missing className="text-text-dark-secondary">{copy.roleEvidence.missingRefs}</p> : null}
        </div>
        <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
          <Info label={copy.fields.questionLabel}>{text(role.questionLabel, copy.empty)}</Info><Info label={copy.fields.segment}>{text(role.segment, copy.empty)}</Info>
          <Info label={copy.fields.painPoints}><List values={role.painPoints} empty={copy.empty} /></Info><Info label={copy.fields.alternatives}><List values={role.alternatives} empty={copy.empty} /></Info>
          <Info label={copy.fields.criteria}><List values={role.decisionCriteria} empty={copy.empty} /></Info><Info label={copy.fields.vocabulary}><List values={role.vocabulary} empty={copy.empty} /></Info>
          <Info label={copy.fields.userEdited}><span data-role-user-edited>{yesNo(policy?.userEdited, copy)}</span></Info>
          <Info label={copy.fields.eligibleLayers}>{policy === undefined ? copy.unknown : <List values={policy.eligibleLayers.map(layer => copy.layers[layer])} empty={copy.empty} />}</Info>
        </dl>
        <details data-role-lineage className="mt-5 rounded-[10px] border border-brand-border-card p-4">
          <summary className="cursor-pointer text-[13px] text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{copy.roleEvidence.details}</summary>
          <dl className="mt-4 grid min-w-0 gap-5 sm:grid-cols-2"><Info label={copy.fields.source}>{copy.sources[role.source.kind]}</Info>
            <Info label={copy.fields.generation}>{text(role.source.generationId, copy.empty)}</Info><Info label={copy.fields.sourceItem}>{text(role.source.itemId, copy.empty)}</Info>
            <Info label={copy.fields.evidenceRefs}><List values={role.source.evidenceRefs} empty={copy.empty} /></Info>
          </dl>
        </details>
      </article>;
    })}</div>}
  </Panel>;
}

function CompetitorCapture({ evidence, copy }: { readonly evidence: GeoCompetitorEvidenceV2 | undefined; readonly copy: GeoKbV2Copy }) {
  const c = copy.competitorCapture;
  if (evidence === undefined) return <p data-competitor-no-capture className="mt-5 text-[13px] text-text-dark-secondary">{c.noCapture}</p>;
  const capture = evidence.capture;
  return <section data-competitor-capture className="mt-5 space-y-4 border-t border-brand-border-card pt-5">
    <h5 className="text-[14px] font-semibold">{c.lastCapture}</h5>
    <p data-competitor-capture-status className={`text-[13px] font-medium ${capture.status === "available" ? "text-text-dark-primary" : "text-brand-error"}`}>{c.statuses[capture.status]}{capture.reason === null ? "" : ` · ${c.reasons[capture.reason]}`}</p>
    <p className="text-[12px] leading-relaxed text-text-dark-secondary">{c.separate}</p>
    <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Info label={copy.fields.brandName}>{text(capture.brandName, copy.notRecorded)}</Info><Info label={copy.fields.aliases}><List values={capture.aliases} empty={copy.notRecorded} /></Info>
      <Info label={copy.fields.declaredSource}><SourceUrl value={capture.sourceUrl} empty={copy.unknown} /></Info><Info label={copy.fields.observedAt}>{text(capture.observedAt, copy.unknown)}</Info>
      <Info label={c.captureMethod}>{text(capture.method, copy.notRecorded)}</Info><Info label={c.receiptTime}>{evidence.receiptCreatedAt}</Info>
      <Info label={copy.fields.source}>{capture.source === "crawl" ? copy.roleEvidence.basis.crawl : copy.notRecorded}</Info><Info label={copy.fields.truncated}>{yesNo(capture.signalsTruncated, copy)}</Info>
    </dl>
    <details data-competitor-signals className="rounded-[10px] border border-brand-border-card p-4">
      <summary className="cursor-pointer text-[13px] text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{c.signals}</summary>
      {capture.signals.length === 0 ? <p className="mt-3 text-[13px] text-text-dark-secondary">{copy.notRecorded}</p> : <ul className="mt-4 space-y-5">{capture.signals.map((signal, index) => <li key={index} className="border-t border-brand-border-card pt-4 first:border-t-0 first:pt-0"><dl className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Info label={copy.fields.brandName}>{signal.name}</Info><Info label={copy.fields.aliases}><List values={signal.aliases} empty={copy.empty} /></Info>
        <Info label={c.signalKind}>{signal.kind}</Info><Info label={copy.fields.declaredSource}><SourceUrl value={signal.url} empty={copy.unknown} /></Info>
        <Info label={c.hostMatched}>{yesNo(signal.hostMatched, copy)}</Info><Info label={c.signalExclusion}>{text(signal.excludedReason, copy.empty)}</Info>
      </dl></li>)}</ul>}
    </details>
    <details data-competitor-receipt className="rounded-[10px] border border-brand-border-card p-4"><summary className="cursor-pointer text-[13px] text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{c.receiptIdentity}</summary><dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
      <Info label={copy.receipts}>{evidence.receiptId}</Info><Info label={c.receiptHash}>{evidence.contentHash}</Info><Info label={c.evidenceId}>{capture.evidenceId}</Info><Info label={c.bodyHash}>{text(capture.bodyHash, copy.notRecorded)}</Info>
    </dl></details>
  </section>;
}

function Competitors({ payload, context, copy }: { readonly payload: GeoKbPayloadV2; readonly context: GeoSnapshotContextV2; readonly copy: GeoKbV2Copy }) {
  return <Panel title={copy.sections.competitors}>{payload.competitors.length === 0 ? <p className="text-sm text-text-dark-secondary">{copy.empty}</p> : <div className="space-y-4">{payload.competitors.map((competitor, index) => <article key={index} data-version-competitor={competitor.domain} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
    <section data-current-competitor-mapping><h4 className="mb-4 text-[14px] font-semibold">{copy.competitorCapture.mapping}</h4><dl className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Info label={copy.fields.domain}>{text(competitor.domain, copy.empty)}</Info><Info label={copy.fields.brandName}>{text(competitor.brandName, copy.empty)}</Info>
      <Info label={copy.fields.aliases}><List values={competitor.aliases ?? []} empty={copy.empty} /></Info><Info label={copy.fields.confirmation}>{competitor.confirmed ? copy.confirmed : copy.unconfirmed}</Info>
    </dl><p data-sov-eligibility className="mt-4 text-[12px] leading-relaxed text-text-dark-secondary">{competitor.confirmed && competitor.brandName.trim() !== "" ? copy.competitorCapture.sovConfirmed : copy.competitorCapture.sovExcluded}</p></section>
    <CompetitorCapture evidence={context.competitorEvidence.find(entry => entry.capture.domain === competitor.domain)} copy={copy} />
  </article>)}</div>}</Panel>;
}

function Facts({ payload, context, copy }: { readonly payload: GeoKbPayloadV2; readonly context: GeoSnapshotContextV2; readonly copy: GeoKbV2Copy }) {
  const admitted = new Map(context.facts.map(fact => [fact.key, fact]));
  return <Panel title={copy.sections.facts}>
    <p className="mb-5 text-[13px] leading-relaxed text-text-dark-secondary">{copy.factsHelp}</p>
    {payload.facts.length === 0 ? <p className="text-sm text-text-dark-secondary">{copy.empty}</p> : <div className="space-y-5">{payload.facts.map(fact => {
      const policy = admitted.get(fact.key);
      const reason = policy?.reason || fact.reason;
      return <article key={fact.key} data-version-fact={fact.key} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center gap-3"><h4 className="break-words text-[15px] font-semibold [overflow-wrap:anywhere]">{fact.key}</h4><Review value={fact.review} copy={copy} /></div>
        <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
          <Info label={copy.fields.declaredValue}>{text(fact.value, copy.unknown)}</Info>
          <Info label={copy.fields.admittedValue}><span data-admitted-value>{policy === undefined ? copy.unknown : policy.value === null ? copy.notAdmitted : policy.value}</span></Info>
          <Info label={copy.fields.declaredSource}><SourceUrl value={fact.sourceUrl} empty={copy.unknown} /></Info><Info label={copy.fields.declaredTime}>{text(fact.observedAt, copy.unknown)}</Info>
          <Info label={copy.fields.source}>{policy === undefined ? copy.unknown : copy.sources[policy.source]}</Info><Info label={copy.fields.reason}>{reason === "" ? copy.empty : copy.reasons[reason]}</Info>
          <Info label={copy.fields.admittedSource}><SourceUrl value={policy?.sourceUrl} empty={copy.unknown} /></Info><Info label={copy.fields.admittedTime}>{text(policy?.observedAt, copy.unknown)}</Info>
          <Info label={copy.fields.supportRef}>{policy?.supportRef ? `${policy.supportRef.receiptId} · ${policy.supportRef.evidenceId}` : copy.empty}</Info>
        </dl>
      </article>;
    })}</div>}
  </Panel>;
}

function Questions({ payload, questionSet, copy }: { readonly payload: GeoKbPayloadV2; readonly questionSet: GeoQuestionSetV2; readonly copy: GeoKbV2Copy }) {
  const roles = new Map(payload.roles.map(role => [role.id, role.label]));
  const headings = [copy.fields.question, copy.fields.layer, copy.fields.role, copy.fields.entities, copy.fields.questionPolicy];
  const cell = "block min-w-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere] sm:table-cell sm:border-b sm:border-brand-border-card sm:px-3 sm:py-4 sm:align-top";
  const mobileLabel = (label: string) => <span className="mb-1 block text-[12px] text-text-dark-secondary sm:hidden">{label}</span>;
  return <Panel title={copy.sections.questions}>
    <table className="block w-full table-fixed text-left sm:table"><caption className="sr-only">{copy.sections.questions}</caption>
      <thead className="hidden sm:table-header-group"><tr>{headings.map(heading => <th key={heading} scope="col" className="border-b border-brand-border-strong px-3 pb-3 text-[12px] font-medium text-text-dark-secondary">{heading}</th>)}</tr></thead>
      <tbody className="block sm:table-row-group">{questionSet.questions.map(question => <tr key={question.id} data-version-question={question.id} className="mb-4 grid gap-4 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 last:mb-0 sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
        <td className={cell}>{mobileLabel(copy.fields.question)}{question.text}</td>
        <td className={cell}>{mobileLabel(copy.fields.layer)}{copy.layers[question.layer]}</td>
        <td className={cell}>{mobileLabel(copy.fields.role)}<span data-question-role>{question.roleId === null ? copy.allRoles : text(roles.get(question.roleId), copy.unknownRole)}</span></td>
        <td className={cell}>{mobileLabel(copy.fields.entities)}<List values={question.requiredEntities} empty={copy.empty} /></td>
        <td className={cell}>{mobileLabel(copy.fields.questionPolicy)}<p>{copy.modes[question.mode]}</p><p className="mt-1 text-text-dark-secondary">{question.calibrated ? copy.calibrated : copy.uncalibrated}</p>
          <details className="mt-3"><summary className="cursor-pointer text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{copy.questionEvidence}</summary>
            <dl className="mt-3 space-y-3"><Info label={copy.fields.source}>{copy.provenance[question.provenance.kind]}</Info><Info label={copy.fields.generator}>{question.provenance.generatorVersion}</Info>
              <Info label={copy.fields.template}>{text(question.templateId, copy.empty)}</Info><Info label={copy.fields.evidenceRefs}><List values={question.provenance.evidenceRefs} empty={copy.empty} /></Info>
              <Info label={copy.fields.entities}><List values={question.provenance.entityRefs} empty={copy.empty} /></Info>
            </dl>
          </details>
        </td>
      </tr>)}</tbody>
    </table>
  </Panel>;
}

function Sources({ context, copy }: { readonly context: GeoSnapshotContextV2; readonly copy: GeoKbV2Copy }) {
  const { gsc, selectedEvidenceCounts, availableEvidenceCounts } = context.sourceSummary;
  return <Panel title={copy.sections.sources}>
    <h4 className="mb-4 text-[15px] font-semibold">Search Console · {gsc === null ? copy.notRecorded : gsc.status === "available" ? copy.available : copy.unavailable}</h4>
    <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Info label={copy.fields.property}>{text(gsc?.property, copy.unknown)}</Info><Info label={copy.fields.window}>{gsc?.window ? `${gsc.window.startDate} → ${gsc.window.endDate}` : copy.unknown}</Info>
      <Info label={copy.fields.queryCount}><span data-gsc-query-count>{text(gsc?.queryCount, copy.unknown)}</span></Info><Info label={copy.fields.truncated}><span data-gsc-truncated>{yesNo(gsc?.truncated, copy)}</span></Info>
      <Info label={copy.fields.observedAt}>{text(gsc?.observedAt, copy.unknown)}</Info><Info label={copy.fields.reason}>{text(gsc?.reason, copy.empty)}</Info>
    </dl>
    <table className="mt-6 w-full table-fixed text-left text-[13px]"><caption className="sr-only">{copy.sections.sources}</caption>
      <thead><tr><th scope="col" className="pb-3 pr-3 font-medium">{copy.fields.source}</th><th scope="col" className="pb-3 pr-3 font-medium">{copy.fields.selected}</th><th scope="col" className="pb-3 font-medium">{copy.fields.available}</th></tr></thead>
      <tbody>{(["profile", "gsc", "crawl", "manual"] as const).map(kind => <tr key={kind} data-source-count={kind} className="border-t border-brand-border-card"><th scope="row" className="break-words py-3 pr-3 font-normal">{copy.sources[kind]}</th><td data-selected-count className="py-3 pr-3">{selectedEvidenceCounts[kind]}</td><td className="py-3">{availableEvidenceCounts[kind]}</td></tr>)}</tbody>
    </table>
    <details data-evidence-catalog className="mt-6 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
      <summary className="cursor-pointer text-[14px] font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{copy.rawEvidence} · {context.evidenceCatalog.length}</summary>
      <ul className="mt-4 divide-y divide-brand-border-card">{context.evidenceCatalog.map(evidence => <li key={evidence.id} className="min-w-0 space-y-2 py-4 first:pt-0 last:pb-0"><p className="break-all text-[12px] text-text-dark-secondary">{evidence.id} · {copy.sources[evidence.kind]}</p><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed [overflow-wrap:anywhere]">{evidence.text}</p></li>)}</ul>
    </details>
    <details className="mt-4 rounded-[10px] border border-brand-border-card bg-brand-bg p-4"><summary className="cursor-pointer text-[14px] font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{copy.receipts} · {context.sourceReceiptRefs.length}</summary>
      <ul className="mt-3 space-y-3 text-[12px] text-text-dark-secondary">{context.sourceReceiptRefs.map(receipt => <li key={receipt.receiptId} className="break-all">{receipt.receiptId}<br />{receipt.contentHash}</li>)}</ul>
    </details>
  </Panel>;
}

export function GeoKbVersionContent({ payload, questionSet, context, locale }: GeoKbVersionContentProps) {
  const copy = geoKbV2Copy(locale);
  return <div data-geo-version-content className="grid min-w-0 gap-6 text-text-dark-primary">
    <GeoKbInheritedProfile profile={null} copy={payload.profileCopy} locale={locale} inline copyDescription={copy.profileDescription} />
    <Panel title={copy.sections.identity}><dl className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Info label={copy.fields.website}><SourceUrl value={payload.targetUrl} empty={copy.unknown} /></Info><Info label={copy.fields.officialName}>{payload.officialName}</Info>
      <Info label={copy.fields.aliases}><List values={payload.aliases} empty={copy.empty} /></Info><Info label={copy.fields.categories}><List values={payload.categoryTerms} empty={copy.empty} /></Info>
      <Info label={copy.fields.market}>{payload.market.country}</Info><Info label={copy.fields.language}>{payload.market.language}</Info>
    </dl></Panel>
    <Competitors payload={payload} context={context} copy={copy} />
    <Roles payload={payload} context={context} copy={copy} /><Facts payload={payload} context={context} copy={copy} />
    <Questions payload={payload} questionSet={questionSet} copy={copy} /><Sources context={context} copy={copy} />
    <Panel title={copy.sections.version}><dl className="grid min-w-0 gap-5 sm:grid-cols-2">
      <Info label={copy.fields.candidate}>{context.candidateId}</Info><Info label={copy.fields.kbId}>{context.kbId}</Info>
      <Info label={copy.fields.schema}><List values={[payload.schemaVersion, questionSet.schemaVersion, context.schemaVersion]} empty={copy.empty} /></Info>
      <Info label={copy.fields.registry}>{questionSet.registryVersion === "none" ? copy.empty : questionSet.registryVersion}</Info><Info label={copy.fields.method}>{questionSet.methodVersion}</Info>
      <Info label={copy.fields.skippedLayers}><List values={context.skippedLayers.map(layer => copy.layers[layer])} empty={copy.empty} /></Info>
      <Info label={copy.fields.payloadHash}>{context.payloadHash}</Info><Info label={copy.fields.questionHash}>{context.questionSetHash}</Info><Info label={copy.fields.contextHash}>{context.contentHash}</Info>
    </dl></Panel>
  </div>;
}
