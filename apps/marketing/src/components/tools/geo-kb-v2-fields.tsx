"use client";
// @input -- detached V2 draft, explicit field/review gestures
// @output -- editable GEO-only values; fact filling never means crawl verification
import { useId, type ReactNode } from "react";
import { geoFactV2Schema, geoRoleV2Schema, type GeoKbPayloadV2, type GeoKbReview } from "../../lib/geo-tools/kb-v2-contract.ts";
import { editGeoKbFactV2, editGeoKbRoleV2 } from "./geo-kb-v2-editor.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";

export function GeoKbEditorPanel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className="min-w-0 rounded-card border border-brand-border-strong bg-brand-panel p-5 sm:p-7"><h4 id={id} className="mb-5 border-b border-brand-border-card pb-4 text-[15px] font-semibold text-text-dark-primary">{title}</h4>{children}</section>;
}
function Field({ label, value, onChange, kind, field, list = false }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly kind: string; readonly field: string; readonly list?: boolean }) {
  const id = useId(), data = { [`data-${kind}-field`]: field };
  return <div className="min-w-0"><label htmlFor={id} className="mb-2 block text-[13px] font-medium text-text-dark-primary">{label}</label>{list
    ? <Textarea id={id} {...data} value={value} onChange={event => onChange(event.target.value)} className="min-h-24" />
    : <Input id={id} {...data} value={value} onChange={event => onChange(event.target.value)} />}</div>;
}
function Reviews({ kind, current, valid, locale, onChange }: { readonly kind: "role" | "fact"; readonly current: GeoKbReview; readonly valid: boolean; readonly locale: string; readonly onChange: (review: GeoKbReview) => void }) {
  const t = geoKbV2EditorCopy(locale), c = geoKbV2Copy(locale);
  return <div className="flex flex-wrap items-center gap-3"><span className="text-sm" data-review-state>{c.reviews[current]}</span>{(["accepted", "excluded", "pending"] as const).map(review => <Button key={review} type="button" variant="outline" {...{ [`data-review-${kind}`]: review }} disabled={current === review || review === "accepted" && !valid} onClick={() => onChange(review)}>{review === "accepted" ? t.accept : review === "excluded" ? t.exclude : t.pending}</Button>)}</div>;
}

export function GeoKbV2Fields({ payload, locale, onChange, supportRefNote }: { readonly payload: GeoKbPayloadV2; readonly locale: string; readonly onChange: (payload: GeoKbPayloadV2) => void; readonly supportRefNote?: string }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  const patch = (value: Partial<GeoKbPayloadV2>) => onChange({ ...payload, ...value });
  return <div className="grid min-w-0 gap-6">
    <GeoKbEditorPanel title={c.sections.identity}><div className="grid gap-5 sm:grid-cols-2">
      <Field kind="base" field="officialName" label={c.fields.officialName} value={payload.officialName} onChange={officialName => patch({ officialName })} />
      <Field kind="base" field="aliases" label={c.fields.aliases} list value={payload.aliases.join("\n")} onChange={value => patch({ aliases: value.split("\n") })} />
      <Field kind="base" field="categoryTerms" label={c.fields.categories} list value={payload.categoryTerms.join("\n")} onChange={value => patch({ categoryTerms: value.split("\n") })} />
      <Field kind="base" field="country" label={c.fields.market} value={payload.market.country} onChange={country => patch({ market: { ...payload.market, country } })} />
      <Field kind="base" field="language" label={c.fields.language} value={payload.market.language} onChange={language => patch({ market: { ...payload.market, language } })} />
    </div></GeoKbEditorPanel>
    <GeoKbEditorPanel title={c.sections.roles}><p className="mb-4 text-sm text-text-dark-secondary">{t.editHelp}</p><div className="space-y-6">{payload.roles.map((role, index) => {
      const change = (next: typeof role) => patch({ roles: payload.roles.map((item, position) => position === index ? next : item) });
      return <article key={role.id} data-edit-role={role.id} className="space-y-5 rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
        <div className="grid gap-5 sm:grid-cols-2">{(["label", "questionLabel", "segment"] as const).map(field => <Field key={field} kind="role" field={field} label={field === "label" ? t.roleLabel : c.fields[field]} value={role[field]} onChange={value => change(editGeoKbRoleV2(role, { [field]: value }))} />)}
          {(["painPoints", "alternatives", "decisionCriteria", "vocabulary"] as const).map(field => <Field key={field} kind="role" field={field} list label={c.fields[field === "decisionCriteria" ? "criteria" : field]} value={role[field].join("\n")} onChange={value => change(editGeoKbRoleV2(role, { [field]: value.split("\n") }))} />)}
        </div>
        <p className="text-xs text-text-dark-secondary">{c.fields.source}: {c.sources[role.source.kind]}</p>
        {role.source.generationId === null && role.source.itemId === null && role.source.evidenceRefs.length === 0 ? null : <details className="text-xs text-text-dark-secondary"><summary className="cursor-pointer">{c.roleEvidence.details}</summary><dl className="mt-2 grid gap-2">
          {role.source.generationId === null ? null : <div><dt>{c.fields.generation}</dt><dd className="break-all font-mono">{role.source.generationId}</dd></div>}
          {role.source.itemId === null ? null : <div><dt>{c.fields.sourceItem}</dt><dd className="break-all font-mono">{role.source.itemId}</dd></div>}
          {role.source.evidenceRefs.length === 0 ? null : <div><dt>{c.fields.evidenceRefs}</dt><dd className="break-all font-mono">{role.source.evidenceRefs.join(" · ")}</dd></div>}
        </dl></details>}
        <Reviews kind="role" current={role.review} locale={locale} valid={geoRoleV2Schema.safeParse({ ...role, review: "accepted" }).success} onChange={review => change({ ...role, review })} />
        <Button type="button" variant="ghost" onClick={() => patch({ roles: payload.roles.filter((_, position) => position !== index) })}>{t.remove}</Button>
      </article>;
    })}</div><Button type="button" variant="outline" className="mt-4" disabled={payload.roles.length >= 5} onClick={() => patch({ roles: [...payload.roles, { id: `manual-${crypto.randomUUID()}`, label: "", questionLabel: "", segment: "", painPoints: [], decisionCriteria: [], alternatives: [], vocabulary: [], review: "pending", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: [] } }] })}>{t.addRole}</Button></GeoKbEditorPanel>
    <GeoKbEditorPanel title={c.sections.competitors}><div className="space-y-5">{payload.competitors.map((competitor, index) => {
      const change = (next: Partial<typeof competitor>) => patch({ competitors: payload.competitors.map((item, position) => position === index ? { ...item, ...next } : item) });
      return <article key={index} className="space-y-4 rounded-[10px] border border-brand-border-card bg-brand-bg p-4"><div className="grid gap-5 sm:grid-cols-2">
        <Field kind="competitor" field="domain" label={c.fields.domain} value={competitor.domain} onChange={domain => change({ domain, confirmed: false })} />
        <Field kind="competitor" field="brandName" label={c.fields.brandName} value={competitor.brandName} onChange={brandName => change({ brandName, confirmed: false })} />
        <Field kind="competitor" field="aliases" label={c.fields.aliases} list value={(competitor.aliases ?? []).join("\n")} onChange={value => change({ aliases: value.split("\n"), confirmed: false })} />
      </div><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={competitor.confirmed} disabled={!competitor.brandName.trim()} onChange={event => change({ confirmed: event.target.checked })} />{c.fields.confirmation}</label><Button type="button" variant="ghost" onClick={() => patch({ competitors: payload.competitors.filter((_, position) => position !== index) })}>{t.remove}</Button></article>;
    })}</div><Button type="button" variant="outline" className="mt-4" disabled={payload.competitors.length >= 5} onClick={() => patch({ competitors: [...payload.competitors, { domain: "", brandName: "", confirmed: false, aliases: [] }] })}>{t.addCompetitor}</Button></GeoKbEditorPanel>
    <GeoKbEditorPanel title={c.sections.facts}><p className="mb-4 text-sm text-text-dark-secondary">{c.factsHelp}</p><div className="space-y-5">{payload.facts.map((fact, index) => {
      const change = (next: typeof fact) => patch({ facts: payload.facts.map((item, position) => position === index ? next : item) });
      const labels = { key: t.factKey, value: c.fields.declaredValue, sourceUrl: c.fields.declaredSource, observedAt: c.fields.declaredTime };
      return <article key={index} data-edit-fact={index} className="space-y-4 rounded-[10px] border border-brand-border-card bg-brand-bg p-4"><div className="grid gap-5 sm:grid-cols-2">{(["key", "value", "sourceUrl", "observedAt"] as const).map(field => <Field key={field} kind="fact" field={field} label={labels[field]} value={fact[field]} onChange={value => change(editGeoKbFactV2(fact, { [field]: value }))} />)}
        <label className="text-sm">{c.fields.reason}<select className="mt-2 block w-full rounded-md border border-brand-border-card bg-brand-bg p-2" value={fact.reason} onChange={event => change(editGeoKbFactV2(fact, { reason: event.target.value as typeof fact.reason }))}><option value="">{c.empty}</option>{Object.entries(c.reasons).map(([reason, label]) => <option key={reason} value={reason}>{label}</option>)}</select></label>
      </div><p className="break-all text-xs text-text-dark-secondary">{c.fields.supportRef}: {fact.supportRef === null ? c.notRecorded : `${fact.supportRef.receiptId} · ${fact.supportRef.evidenceId}`}</p>
        {fact.supportRef === null || supportRefNote === undefined ? null : <p data-support-ref-note className="text-xs text-text-dark-secondary">{supportRefNote}</p>}
        <Reviews kind="fact" current={fact.review} locale={locale} valid={geoFactV2Schema.safeParse({ ...fact, review: "accepted" }).success} onChange={review => change({ ...fact, review })} />
        <Button type="button" variant="ghost" onClick={() => patch({ facts: payload.facts.filter((_, position) => position !== index) })}>{t.remove}</Button>
      </article>;
    })}</div><Button type="button" variant="outline" className="mt-4" disabled={payload.facts.length >= 24} onClick={() => patch({ facts: [...payload.facts, { key: "", value: "", reason: "lowConfidence", sourceUrl: "", observedAt: "", review: "pending", supportRef: null }] })}>{t.addFact}</Button></GeoKbEditorPanel>
  </div>;
}
