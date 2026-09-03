"use client";
// @input -- detached V2 draft, explicit field/review gestures
// @output -- editable GEO-only values in the Profile editor's form; fact filling never means crawl verification
import { useId, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { GeoKbSection } from "./geo-kb-section.tsx";
import { geoFactV2Schema, geoRoleV2Schema, type GeoKbPayloadV2, type GeoKbReview } from "../../lib/geo-tools/kb-v2-contract.ts";
import { editGeoKbFactV2, editGeoKbRoleV2 } from "./geo-kb-v2-editor.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";

/** Kept as the name the other GEO panels import; the form is now the shared one. */
export function GeoKbEditorPanel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <GeoKbSection title={title} heading={4}>{children}</GeoKbSection>;
}
/** The Profile editor's rhythm: one field per row, rows separated by a rule. */
function Rows({ children }: { readonly children: ReactNode }) {
  return <div className="min-w-0 divide-y divide-brand-border-card">{children}</div>;
}
function Row({ children }: { readonly children: ReactNode }) {
  return <div className="min-w-0 py-6 first:pt-0 last:pb-0 sm:py-7">{children}</div>;
}
function Field({ label, value, onChange, kind, field }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly kind: string; readonly field: string }) {
  const id = useId(), data = { [`data-${kind}-field`]: field };
  return <div className="min-w-0 space-y-3">
    <Label htmlFor={id} className="text-[14px] text-text-dark-primary">{label}</Label>
    <Input id={id} {...data} autoComplete="off" value={value} onChange={event => onChange(event.target.value)} />
  </div>;
}
/**
 * A list edited the way the Profile editor edits one: a row per entry with its
 * own remove control, one add control below. The newline-separated textarea it
 * replaces looked nothing like the editor one card above, and it turned
 * "remove the third item" into a text-editing job.
 */
function ListField({ label, values, onChange, kind, field, locale }: { readonly label: string; readonly values: readonly string[]; readonly onChange: (values: readonly string[]) => void; readonly kind: string; readonly field: string; readonly locale: string }) {
  const t = geoKbV2EditorCopy(locale);
  return <fieldset {...{ [`data-${kind}-field`]: field }} data-list-field={field} className="min-w-0 space-y-2">
    <legend className="mb-3 text-[14px] font-medium text-text-dark-primary">{label}</legend>
    {values.map((item, index) => <div key={`${field}-${index}`} className="flex items-start gap-2">
      <Input className="flex-1" aria-label={`${label} ${index + 1}`} autoComplete="off" value={item} onChange={event => onChange(values.map((entry, position) => position === index ? event.target.value : entry))} />
      <Button type="button" variant="outline" size="icon" className="size-11 hover:border-brand-error/50 hover:bg-brand-error/5 hover:text-brand-error"
        aria-label={`${t.listRemove} ${label} ${index + 1}`} title={`${t.listRemove} ${label} ${index + 1}`}
        onClick={() => onChange(values.filter((_entry, position) => position !== index))}><Minus aria-hidden="true" className="size-4" /></Button>
    </div>)}
    <Button type="button" variant="outline" size="icon" className="size-11 text-brand-accent-text hover:bg-brand-accent-soft"
      aria-label={`${t.listAdd} ${label}`} title={`${t.listAdd} ${label}`}
      onClick={() => onChange([...values, ""])}><Plus aria-hidden="true" className="size-4" /></Button>
  </fieldset>;
}
/**
 * The state stays visible; the three buttons that change it move behind a
 * disclosure. Confirming the whole knowledge base at once is the ordinary
 * path, and a wall of per-row buttons made the ordinary path look like the
 * exception.
 */
function Review({ kind, current, valid, locale, onChange }: { readonly kind: "role" | "fact"; readonly current: GeoKbReview; readonly valid: boolean; readonly locale: string; readonly onChange: (review: GeoKbReview) => void }) {
  const t = geoKbV2EditorCopy(locale), c = geoKbV2Copy(locale);
  return <details className="mt-5">
    <summary className="cursor-pointer text-[13px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">
      <span data-review-state>{c.reviews[current]}</span>
      <span className="ml-2 text-brand-accent-text">{t.reviewOne}</span>
    </summary>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {(["accepted", "excluded", "pending"] as const).map(review => <Button key={review} type="button" variant="outline" {...{ [`data-review-${kind}`]: review }} disabled={current === review || review === "accepted" && !valid} onClick={() => onChange(review)}>{review === "accepted" ? t.accept : review === "excluded" ? t.exclude : t.pending}</Button>)}
    </div>
  </details>;
}

/** One list read out, not edited: the entries as they stand. */
function ReadList({ label, values, empty }: { readonly label: string; readonly values: readonly string[]; readonly empty: string }) {
  return <div className="min-w-0 border-t border-brand-border-card py-3 first:border-t-0 first:pt-0">
    <span className="text-[12px] text-text-dark-secondary">{label}</span>
    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-dark-primary [overflow-wrap:anywhere]">{values.filter(entry => entry.trim() !== "").join(" · ") || empty}</p>
  </div>;
}
/**
 * A role is read out, not filled in. It comes from the Product Profile's ICP
 * fields or from a generation, and both of those are better at it than a
 * person retyping seven fields per role. Hand editing is still there, one
 * disclosure away, for the cases the derivation gets wrong.
 */
function RoleCard({ role, locale, children }: { readonly role: GeoKbPayloadV2["roles"][number]; readonly locale: string; readonly children: ReactNode }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  return <>
    <div className="min-w-0">
      <p className="break-words text-[15px] font-semibold text-text-dark-primary [overflow-wrap:anywhere]">{role.label.trim() || c.empty}</p>
      <p className="mt-1 text-[12px] text-text-dark-secondary">{role.segment.trim() || c.empty}</p>
      <div className="mt-4">
        <ReadList label={c.fields.painPoints} values={role.painPoints} empty={c.empty} />
        <ReadList label={c.fields.alternatives} values={role.alternatives} empty={c.empty} />
        <ReadList label={c.fields.criteria} values={role.decisionCriteria} empty={c.empty} />
        <ReadList label={c.fields.vocabulary} values={role.vocabulary} empty={c.empty} />
        <ReadList label={c.fields.questionLabel} values={[role.questionLabel]} empty={c.empty} />
      </div>
    </div>
    <details className="mt-4">
      <summary className="cursor-pointer text-[13px] text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{t.editRole}</summary>
      <div className="mt-4">{children}</div>
    </details>
  </>;
}

export function GeoKbV2Fields({ payload, locale, onChange, supportRefNote }: { readonly payload: GeoKbPayloadV2; readonly locale: string; readonly onChange: (payload: GeoKbPayloadV2) => void; readonly supportRefNote?: string }) {
  const c = geoKbV2Copy(locale), t = geoKbV2EditorCopy(locale);
  const patch = (value: Partial<GeoKbPayloadV2>) => onChange({ ...payload, ...value });
  return <div className="grid min-w-0 gap-6">
    <GeoKbEditorPanel title={c.sections.identity}><Rows>
      <Row><Field kind="base" field="officialName" label={c.fields.officialName} value={payload.officialName} onChange={officialName => patch({ officialName })} /></Row>
      <Row><ListField locale={locale} kind="base" field="aliases" label={c.fields.aliases} values={payload.aliases} onChange={aliases => patch({ aliases: [...aliases] })} /></Row>
      <Row><ListField locale={locale} kind="base" field="categoryTerms" label={c.fields.categories} values={payload.categoryTerms} onChange={categoryTerms => patch({ categoryTerms: [...categoryTerms] })} /></Row>
      <Row><Field kind="base" field="country" label={c.fields.market} value={payload.market.country} onChange={country => patch({ market: { ...payload.market, country } })} /></Row>
      <Row><Field kind="base" field="language" label={c.fields.language} value={payload.market.language} onChange={language => patch({ market: { ...payload.market, language } })} /></Row>
    </Rows></GeoKbEditorPanel>

    <GeoKbEditorPanel title={c.sections.roles}><p className="mb-5 text-[13px] leading-relaxed text-text-dark-secondary">{t.editHelp}</p><div className="space-y-5">{payload.roles.map((role, index) => {
      const change = (next: typeof role) => patch({ roles: payload.roles.map((item, position) => position === index ? next : item) });
      return <article key={role.id} data-edit-role={role.id} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
        <RoleCard role={role} locale={locale}><Rows>
          {(["label", "questionLabel", "segment"] as const).map(field => <Row key={field}><Field kind="role" field={field} label={field === "label" ? t.roleLabel : c.fields[field]} value={role[field]} onChange={value => change(editGeoKbRoleV2(role, { [field]: value }))} /></Row>)}
          {(["painPoints", "alternatives", "decisionCriteria", "vocabulary"] as const).map(field => <Row key={field}><ListField locale={locale} kind="role" field={field} label={c.fields[field === "decisionCriteria" ? "criteria" : field]} values={role[field]} onChange={values => change(editGeoKbRoleV2(role, { [field]: [...values] }))} /></Row>)}
        </Rows>
        <Review kind="role" current={role.review} locale={locale} valid={geoRoleV2Schema.safeParse({ ...role, review: "accepted" }).success} onChange={review => change({ ...role, review })} />
        <Button type="button" variant="ghost" className="mt-3" onClick={() => patch({ roles: payload.roles.filter((_, position) => position !== index) })}>{t.remove}</Button>
        </RoleCard>
      </article>;
    })}</div><Button type="button" variant="outline" className="mt-5" disabled={payload.roles.length >= 5} onClick={() => patch({ roles: [...payload.roles, { id: `manual-${crypto.randomUUID()}`, label: "", questionLabel: "", segment: "", painPoints: [], decisionCriteria: [], alternatives: [], vocabulary: [], review: "pending", source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: [] } }] })}>{t.addRole}</Button></GeoKbEditorPanel>

    <GeoKbEditorPanel title={c.sections.competitors}><div className="space-y-5">{payload.competitors.map((competitor, index) => {
      const change = (next: Partial<typeof competitor>) => patch({ competitors: payload.competitors.map((item, position) => position === index ? { ...item, ...next } : item) });
      return <article key={index} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
        <Rows>
          <Row><Field kind="competitor" field="domain" label={c.fields.domain} value={competitor.domain} onChange={domain => change({ domain, confirmed: false })} /></Row>
          <Row><Field kind="competitor" field="brandName" label={c.fields.brandName} value={competitor.brandName} onChange={brandName => change({ brandName, confirmed: false })} /></Row>
          <Row><ListField locale={locale} kind="competitor" field="aliases" label={c.fields.aliases} values={competitor.aliases ?? []} onChange={aliases => change({ aliases: [...aliases], confirmed: false })} /></Row>
        </Rows>
        <label className="mt-5 flex items-center gap-3 text-sm"><input type="checkbox" checked={competitor.confirmed} disabled={!competitor.brandName.trim()} onChange={event => change({ confirmed: event.target.checked })} />{c.fields.confirmation}</label>
        <Button type="button" variant="ghost" className="mt-3" onClick={() => patch({ competitors: payload.competitors.filter((_, position) => position !== index) })}>{t.remove}</Button>
      </article>;
    })}</div><Button type="button" variant="outline" className="mt-5" disabled={payload.competitors.length >= 5} onClick={() => patch({ competitors: [...payload.competitors, { domain: "", brandName: "", confirmed: false, aliases: [] }] })}>{t.addCompetitor}</Button></GeoKbEditorPanel>

    <GeoKbEditorPanel title={c.sections.facts}><p className="mb-5 text-[13px] leading-relaxed text-text-dark-secondary">{c.factsHelp}</p><div className="space-y-5">{payload.facts.map((fact, index) => {
      const change = (next: typeof fact) => patch({ facts: payload.facts.map((item, position) => position === index ? next : item) });
      const labels = { key: t.factKey, value: c.fields.declaredValue, sourceUrl: c.fields.declaredSource, observedAt: c.fields.declaredTime };
      return <article key={index} data-edit-fact={index} className="min-w-0 rounded-[10px] border border-brand-border-card bg-brand-bg p-4 sm:p-5">
        <Rows>
          {(["key", "value", "sourceUrl", "observedAt"] as const).map(field => <Row key={field}><Field kind="fact" field={field} label={labels[field]} value={fact[field]} onChange={value => change(editGeoKbFactV2(fact, { [field]: value }))} /></Row>)}
        </Rows>
        {/* Not the receipt and evidence ids -- those describe the pipeline.
            This says what editing the row costs: crawl evidence a source
            refresh paid for, gone, and only another refresh brings it back. */}
        {fact.supportRef === null || supportRefNote === undefined ? null : <p data-support-ref-note className="mt-5 text-[12px] text-text-dark-secondary">{supportRefNote}</p>}
        {/* The reason only matters for a fact that has no source, and the
            review state is what the one confirm gesture sets. Neither belongs
            in front of every row. */}
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">{t.editFact}</summary>
          <label className="mt-4 block min-w-0 space-y-3 text-[14px] text-text-dark-primary">{c.fields.reason}<select className="block w-full rounded-md border border-brand-border-card bg-brand-bg p-2 text-[14px]" value={fact.reason} onChange={event => change(editGeoKbFactV2(fact, { reason: event.target.value as typeof fact.reason }))}><option value="">{c.empty}</option>{Object.entries(c.reasons).map(([reason, label]) => <option key={reason} value={reason}>{label}</option>)}</select></label>
          <Review kind="fact" current={fact.review} locale={locale} valid={geoFactV2Schema.safeParse({ ...fact, review: "accepted" }).success} onChange={review => change({ ...fact, review })} />
          <Button type="button" variant="ghost" className="mt-3" onClick={() => patch({ facts: payload.facts.filter((_, position) => position !== index) })}>{t.remove}</Button>
        </details>
      </article>;
    })}</div><Button type="button" variant="outline" className="mt-5" disabled={payload.facts.length >= 24} onClick={() => patch({ facts: [...payload.facts, { key: "", value: "", reason: "lowConfidence", sourceUrl: "", observedAt: "", review: "pending", supportRef: null }] })}>{t.addFact}</Button></GeoKbEditorPanel>
  </div>;
}
