"use client";
// @input -- exact persisted source receipt and the saved draft it was requested for
// @output -- the two things a source refresh brings back that a person acts on:
//             a competitor's observed brand identity, and a fact's crawl evidence
import type { GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoKbSourceReportV2 } from "../../lib/geo-tools/kb-source-contract.ts";
import type { GeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import { canonicalGeoV2Text } from "../../lib/geo-tools/kb-v2-json.ts";
import { Button } from "../ui/button.tsx";
import { GeoKbEditorPanel } from "./geo-kb-v2-fields.tsx";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";

/**
 * `reason` is a closed enum in the contract, so it is mapped to copy rather
 * than printed: `not_connected` is a code, not a sentence a visitor can act on.
 */
function GscLine({ gsc, c }: { readonly gsc: GeoKbSourceReportV2["gsc"]; readonly c: ReturnType<typeof geoKbV2Copy> }) {
  if (gsc.status !== "available") return <p data-gsc-unavailable className="mt-3 text-sm text-text-dark-secondary">{c.sources.gsc}: {c.unavailable} · {c.gscReasons[gsc.reason]}</p>;
  if (gsc.queryCount === 0) return <p data-gsc-empty className="mt-3 text-sm text-text-dark-secondary">{c.gscEmpty}</p>;
  if (gsc.truncated) return <p data-gsc-truncated className="mt-3 text-sm text-brand-error">{c.gscTruncated}</p>;
  return null;
}

export function GeoKbV2Sources({ receipt, payload, stale, locale, onChange }: { readonly receipt: GeoKbSourceReportV2; readonly baseline: GeoKbPayloadV2; readonly payload: GeoKbPayloadV2; readonly stale: boolean; readonly locale: string; readonly onChange: (payload: GeoKbPayloadV2) => void }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  const same = (a: unknown, b: unknown) => a !== undefined && canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
  // Not "source summary" any more: what is left is what the last refresh
  // brought back that a person can act on. The title does not promise anything
  // is adoptable -- every entry can be unavailable or in conflict -- and does
  // not say "crawl", because the Search Console line above is not one.
  return <GeoKbEditorPanel title={c.sections.adoptable}>
    <p className="text-sm text-text-dark-secondary">{t.sourceHelp}</p>{stale ? <p role="status" className="mt-3 text-sm text-brand-error">{t.oldSource}</p> : null}
    {/* When this was captured, and nothing else about the receipt. The staleness
        flag above compares kbId, host and Profile reference but not the draft
        hash, so a receipt taken for an earlier draft still reads as current --
        adding the draft hash to that flag would disable adoption after any
        unrelated edit, which is worse. The per-entry guards below already
        refuse an entry the draft has moved away from; this line is how a person
        sees that the evidence is older than the draft in front of them. */}
    <p data-receipt-captured className="mt-3 text-[12px] text-text-dark-secondary">{c.fields.observedAt}: {receipt.createdAt}</p>
    {/* Not the property, the window or the raw queries -- those describe how
        the refresh ran. What is stated is the two shapes of Search Console
        result a person would act on differently before pressing a billed
        generation: nothing came back, or what came back was clipped at the
        row cap so roles were derived from a partial sample. An unavailable
        source states no count at all; unavailable is not zero. */}
    <GscLine gsc={receipt.gsc} c={c} />
    <div className="mt-5 space-y-4">{receipt.competitors.map(entry => {
      const index = payload.competitors.findIndex(item => item.domain === entry.domain);
      const current = payload.competitors[index];
      const applicable = !stale && current !== undefined && !current.confirmed && entry.status === "available" &&
        (current.brandName === "" || current.brandName === entry.brandName) && ((current.aliases ?? []).length === 0 || same(current.aliases, entry.aliases)) &&
        !(current.brandName === entry.brandName && same(current.aliases ?? [], entry.aliases));
      return <article key={entry.evidenceId} className="space-y-3 rounded-[10px] border border-brand-border-card p-4 text-sm">
        <h4 className="font-medium">{entry.domain}</h4><p className="break-all text-text-dark-secondary">{entry.sourceUrl ?? c.unknown} · {entry.observedAt ?? c.unknown}</p>
        {entry.status === "available" ? <><p>{entry.brandName} · {entry.aliases.join(" · ")}</p><Button type="button" variant="outline" data-apply-competitor={entry.evidenceId} disabled={!applicable} onClick={() => { if (applicable) onChange({ ...payload, competitors: payload.competitors.map((item, position) => position === index ? { domain: entry.domain, brandName: entry.brandName, aliases: entry.aliases, confirmed: false } : item) }); }}>{t.adopt}</Button></> : <p data-entry-refused>{c.adoptable.statuses[entry.status]} · {c.adoptable.reasons[entry.reason]}</p>}
      </article>;
    })}{receipt.facts.map(entry => {
      const index = payload.facts.findIndex(item => item.key === entry.key), current = payload.facts[index];
      const applicable = !stale && current !== undefined && entry.status === "available" && current.key === entry.key && current.value === entry.value && current.sourceUrl === entry.sourceUrl &&
        !(current.supportRef?.receiptId === receipt.receiptId && current.supportRef.evidenceId === entry.evidenceId);
      return <article key={entry.evidenceId} className="space-y-3 rounded-[10px] border border-brand-border-card p-4 text-sm"><h4 className="font-medium">{entry.key}</h4>
        <p className="break-all text-text-dark-secondary">{entry.sourceUrl ?? c.unknown} · {entry.observedAt ?? c.unknown}</p>
        {entry.status === "available" ? <><p>{entry.value}</p><blockquote className="border-l-2 border-brand-border-card pl-3">{entry.excerpt}</blockquote><Button type="button" variant="outline" data-apply-fact={entry.evidenceId} disabled={!applicable || entry.sourceUrl === null || entry.observedAt === null} onClick={() => {
          if (!applicable || entry.sourceUrl === null || entry.observedAt === null) return;
          onChange({ ...payload, facts: payload.facts.map((item, position) => position === index ? { key: entry.key, value: entry.value, reason: "", sourceUrl: entry.sourceUrl!, observedAt: entry.observedAt!, review: "pending", supportRef: { receiptId: receipt.receiptId, evidenceId: entry.evidenceId } } : item) });
        }}>{t.adopt}</Button></> : <><p data-entry-refused>{c.adoptable.statuses[entry.status]} · {c.adoptable.reasons[entry.reason]}</p>{entry.excerpt ? <blockquote className="border-l-2 border-brand-border-card pl-3">{entry.excerpt}</blockquote> : null}</>}
      </article>;
    })}</div>
  </GeoKbEditorPanel>;
}

const EVIDENCE_KINDS = ["profile", "gsc", "crawl", "manual"] as const;

export function GeoKbV2RoleProposals({ proposal, payload, locale, stale, onAdopt }: { readonly proposal: GeoRoleProposal; readonly payload: GeoKbPayloadV2; readonly locale: string; readonly stale: boolean; readonly onAdopt: (ids: readonly string[], mode?: "append" | "replace_selected" | "replace_all") => void }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  const ids = proposal.output.roles.filter(role => !payload.roles.some(item => item.id === role.id)).map(role => role.id);
  // What each role was built from, by kind. `evidenceRefs` are row ids inside
  // this proposal's own source list -- a query's or a capture's UUID, which
  // nothing in the product can look up -- and a role carries dozens of them.
  // The kinds and the count are the part a person weighs before adopting.
  const kinds = new Map(proposal.input.sources.map(source => [source.id, source.kind] as const));
  return <GeoKbEditorPanel title={t.proposals}><p className="text-sm text-text-dark-secondary">{t.proposalHelp}</p>
    {stale ? <p role="status" className="mb-4 mt-3 text-sm text-brand-error">{t.stale}</p> : null}
    <div className="mt-4 space-y-4">{proposal.output.roles.map(role => {
      // Every ref resolves: `parseGeoRoleSynthesis` rejects a role whose
      // references are not in this proposal's own source list, so there is no
      // missing-evidence state to report here.
      const refs = [...new Set(role.evidenceRefs)];
      const basis = EVIDENCE_KINDS.filter(kind => refs.some(ref => kinds.get(ref) === kind));
      return <article key={role.id} className="space-y-3 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-sm"><h4 className="font-semibold">{role.label}</h4>
      <p>{c.fields.questionLabel}: {role.questionLabel}</p><p>{c.fields.segment}: {role.segment}</p>
      {(["painPoints", "alternatives", "decisionCriteria", "vocabulary"] as const).map(field => <p key={field}>{c.fields[field === "decisionCriteria" ? "criteria" : field]}: {role[field].join(" · ") || c.empty}</p>)}
      <p data-role-basis={role.id} className="text-xs text-text-dark-secondary">{c.fields.evidenceRefs}: {refs.length === 0 ? c.roleEvidence.noEvidence : [refs.length, ...basis.map(kind => c.roleEvidence.basis[kind])].join(" · ")}</p>
      <Button type="button" variant="outline" data-adopt-role={role.id} disabled={stale || !ids.includes(role.id) || payload.roles.length >= 5} onClick={() => onAdopt([role.id])}>{t.adopt}</Button>
      {!ids.includes(role.id) ? <Button type="button" variant="outline" data-replace-role={role.id} disabled={stale} onClick={() => onAdopt([role.id], "replace_selected")}>{t.replaceRole}</Button> : null}
    </article>;
    })}</div>
    <Button type="button" variant="outline" className="mt-4" data-adopt-all-roles disabled={stale || ids.length === 0 || payload.roles.length + ids.length > 5} onClick={() => onAdopt(ids)}>{t.adoptAll}</Button>
    {payload.roles.length > 0 ? <div className="mt-4 space-y-3"><p className="text-sm text-text-dark-secondary">{t.replaceHelp}</p><Button type="button" variant="outline" data-replace-all-roles disabled={stale || proposal.output.roles.length === 0} onClick={() => onAdopt(proposal.output.roles.map(role => role.id), "replace_all")}>{t.replaceAllRoles}</Button></div> : null}
    <details className="mt-4 text-sm"><summary className="cursor-pointer">{c.rawEvidence}</summary><ul className="mt-3 space-y-3">{proposal.input.sources.map(source => <li key={source.id}><p className="text-xs text-text-dark-secondary">{c.sources[source.kind]}</p><p className="whitespace-pre-wrap break-words">{source.text}</p></li>)}</ul></details>
    <div className="mt-4 text-sm"><p>{c.fields.categories}: {proposal.output.categoryTerms.map(item => item.text).join(" · ")}</p></div>
    {/* Selected against available, per kind. This was two `JSON.stringify`
        calls -- `{"profile":29,"gsc":7,...}` printed at a person. */}
    <p className="mt-4 text-[13px] text-text-dark-secondary">{t.evidenceCounts}</p>
    <dl data-evidence-counts className="mt-2 grid gap-2 text-sm sm:grid-cols-2">{EVIDENCE_KINDS.map(kind => <div key={kind} data-evidence-count={kind} className="flex items-baseline justify-between gap-3 border-t border-brand-border-card pt-2">
      <dt className="text-text-dark-secondary">{c.sources[kind]}</dt><dd className="tabular-nums">{proposal.selectedEvidenceCounts[kind]} / {proposal.availableEvidenceCounts[kind]}</dd>
    </div>)}</dl>
  </GeoKbEditorPanel>;
}
