"use client";
// @input -- exact persisted source receipt and the saved draft it was requested for
// @output -- inspectable provenance and explicit guarded item adoption
import type { GeoKbPayloadV2 } from "../../lib/geo-tools/kb-v2-contract.ts";
import type { GeoKbSourceReportV2 } from "../../lib/geo-tools/kb-source-contract.ts";
import type { GeoRoleProposal } from "../../lib/geo-tools/kb-role-proposal.ts";
import { canonicalGeoV2Text } from "../../lib/geo-tools/kb-v2-json.ts";
import { Button } from "../ui/button.tsx";
import { GeoKbEditorPanel } from "./geo-kb-v2-fields.tsx";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";

export function GeoKbV2Sources({ receipt, payload, stale, locale, onChange }: { readonly receipt: GeoKbSourceReportV2; readonly baseline: GeoKbPayloadV2; readonly payload: GeoKbPayloadV2; readonly stale: boolean; readonly locale: string; readonly onChange: (payload: GeoKbPayloadV2) => void }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  const same = (a: unknown, b: unknown) => a !== undefined && canonicalGeoV2Text(a) === canonicalGeoV2Text(b);
  return <GeoKbEditorPanel title={c.sections.sources}>
    <p className="text-sm text-text-dark-secondary">{t.sourceHelp}</p>{stale ? <p role="status" className="mt-3 text-sm text-brand-error">{t.oldSource}</p> : null}
    <p className="mt-3 break-all text-xs text-text-dark-secondary">{receipt.receiptId} · {receipt.contentHash} · {receipt.createdAt}</p>
    <div className="my-5 grid gap-2 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-sm">
      <p>{c.fields.property}: {receipt.gsc.property ?? c.unknown}</p><p>{c.fields.window}: {receipt.gsc.window.startDate} — {receipt.gsc.window.endDate}</p>
      <p>{c.fields.queryCount}: {receipt.gsc.queryCount ?? c.unknown} · {c.fields.truncated}: {receipt.gsc.truncated === null ? c.unknown : receipt.gsc.truncated ? c.yes : c.no}</p>
      <p>{c.fields.observedAt}: {receipt.gsc.observedAt ?? c.unknown} · {receipt.gsc.reason ?? c.available}</p>
      {receipt.gsc.queries.length ? <details><summary>{c.rawEvidence}</summary><ul className="mt-3 space-y-2">{receipt.gsc.queries.map(query => <li key={query.id}>{query.text}<p className="break-all text-xs">{query.id}</p></li>)}</ul></details> : null}
    </div>
    <div className="space-y-4">{receipt.competitors.map(entry => {
      const index = payload.competitors.findIndex(item => item.domain === entry.domain);
      const current = payload.competitors[index];
      const applicable = !stale && current !== undefined && !current.confirmed && entry.status === "available" &&
        (current.brandName === "" || current.brandName === entry.brandName) && ((current.aliases ?? []).length === 0 || same(current.aliases, entry.aliases)) &&
        !(current.brandName === entry.brandName && same(current.aliases ?? [], entry.aliases));
      return <article key={entry.evidenceId} className="space-y-3 rounded-[10px] border border-brand-border-card p-4 text-sm">
        <h4 className="font-medium">{entry.domain}</h4><p className="break-all">{entry.sourceUrl ?? c.unknown} · {entry.observedAt ?? c.unknown} · {entry.method ?? c.unknown}</p>
        {entry.status === "available" ? <><p>{entry.brandName} · {entry.aliases.join(" · ")}</p><Button type="button" variant="outline" data-apply-competitor={entry.evidenceId} disabled={!applicable} onClick={() => { if (applicable) onChange({ ...payload, competitors: payload.competitors.map((item, position) => position === index ? { domain: entry.domain, brandName: entry.brandName, aliases: entry.aliases, confirmed: false } : item) }); }}>{t.adopt}</Button></> : <p>{entry.status} · {entry.reason}</p>}
        <details><summary>{c.rawEvidence}</summary><ul className="mt-3 space-y-2">{entry.signals.map((signal, position) => <li key={position}>{signal.name} · {signal.kind} · {signal.hostMatched ? c.yes : c.no} · {signal.excludedReason ?? c.empty}<p className="break-all">{signal.url ?? c.unknown}</p></li>)}</ul></details>
      </article>;
    })}{receipt.facts.map(entry => {
      const index = payload.facts.findIndex(item => item.key === entry.key), current = payload.facts[index];
      const applicable = !stale && current !== undefined && entry.status === "available" && current.key === entry.key && current.value === entry.value && current.sourceUrl === entry.sourceUrl &&
        !(current.supportRef?.receiptId === receipt.receiptId && current.supportRef.evidenceId === entry.evidenceId);
      return <article key={entry.evidenceId} className="space-y-3 rounded-[10px] border border-brand-border-card p-4 text-sm"><h4 className="font-medium">{entry.key}</h4>
        <p className="break-all">{entry.sourceUrl ?? c.unknown} · {entry.observedAt ?? c.unknown}</p>
        {entry.status === "available" ? <><p>{entry.value}</p><blockquote className="border-l-2 border-brand-border-card pl-3">{entry.excerpt}</blockquote><Button type="button" variant="outline" data-apply-fact={entry.evidenceId} disabled={!applicable || entry.sourceUrl === null || entry.observedAt === null} onClick={() => {
          if (!applicable || entry.sourceUrl === null || entry.observedAt === null) return;
          onChange({ ...payload, facts: payload.facts.map((item, position) => position === index ? { key: entry.key, value: entry.value, reason: "", sourceUrl: entry.sourceUrl!, observedAt: entry.observedAt!, review: "pending", supportRef: { receiptId: receipt.receiptId, evidenceId: entry.evidenceId } } : item) });
        }}>{t.adopt}</Button></> : <><p>{entry.status} · {entry.reason}</p>{entry.excerpt ? <blockquote>{entry.excerpt}</blockquote> : null}</>}
      </article>;
    })}</div>
  </GeoKbEditorPanel>;
}

export function GeoKbV2RoleProposals({ proposal, payload, locale, stale, onAdopt }: { readonly proposal: GeoRoleProposal; readonly payload: GeoKbPayloadV2; readonly locale: string; readonly stale: boolean; readonly onAdopt: (ids: readonly string[], mode?: "append" | "replace_selected" | "replace_all") => void }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  const ids = proposal.output.roles.filter(role => !payload.roles.some(item => item.id === role.id)).map(role => role.id);
  return <GeoKbEditorPanel title={t.proposals}><p className="text-sm text-text-dark-secondary">{t.proposalHelp}</p><p className="my-3 break-all text-xs text-text-dark-secondary">{proposal.generationId} · {proposal.contentHash}</p>
    {stale ? <p role="status" className="mb-4 text-sm text-brand-error">{t.stale}</p> : null}
    <div className="space-y-4">{proposal.output.roles.map(role => <article key={role.id} className="space-y-3 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 text-sm"><h4 className="font-semibold">{role.label}</h4>
      <p>{c.fields.questionLabel}: {role.questionLabel}</p><p>{c.fields.segment}: {role.segment}</p>
      {(["painPoints", "alternatives", "decisionCriteria", "vocabulary"] as const).map(field => <p key={field}>{c.fields[field === "decisionCriteria" ? "criteria" : field]}: {role[field].join(" · ") || c.empty}</p>)}
      <p className="break-all text-xs">{c.fields.evidenceRefs}: {role.evidenceRefs.join(" · ")}</p>
      <Button type="button" variant="outline" data-adopt-role={role.id} disabled={stale || !ids.includes(role.id) || payload.roles.length >= 5} onClick={() => onAdopt([role.id])}>{t.adopt}</Button>
      {!ids.includes(role.id) ? <Button type="button" variant="outline" data-replace-role={role.id} disabled={stale} onClick={() => onAdopt([role.id], "replace_selected")}>{t.replaceRole}</Button> : null}
    </article>)}</div>
    <Button type="button" variant="outline" className="mt-4" data-adopt-all-roles disabled={stale || ids.length === 0 || payload.roles.length + ids.length > 5} onClick={() => onAdopt(ids)}>{t.adoptAll}</Button>
    {payload.roles.length > 0 ? <div className="mt-4 space-y-3"><p className="text-sm text-text-dark-secondary">{t.replaceHelp}</p><Button type="button" variant="outline" data-replace-all-roles disabled={stale || proposal.output.roles.length === 0} onClick={() => onAdopt(proposal.output.roles.map(role => role.id), "replace_all")}>{t.replaceAllRoles}</Button></div> : null}
    <details className="mt-4 text-sm"><summary>{c.rawEvidence}</summary><ul className="mt-3 space-y-3">{proposal.input.sources.map(source => <li key={source.id}><p className="break-all text-xs">{source.id} · {c.sources[source.kind]}</p><p className="whitespace-pre-wrap break-words">{source.text}</p></li>)}</ul></details>
    <div className="mt-4 text-sm"><p>{c.fields.categories}: {proposal.output.categoryTerms.map(item => item.text).join(" · ")}</p><p>{c.fields.selected}: {JSON.stringify(proposal.selectedEvidenceCounts)}</p><p>{c.fields.available}: {JSON.stringify(proposal.availableEvidenceCounts)}</p></div>
  </GeoKbEditorPanel>;
}
