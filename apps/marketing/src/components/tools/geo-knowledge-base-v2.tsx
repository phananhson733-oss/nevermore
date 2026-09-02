"use client";
// @input -- complete owned V2 editor data; Profile is maintained once by its parent
// @output -- explicit supplement/review and immutable snapshot stages
// @pos -- no live draft is ever merged into a prepared or frozen version
import { useId, useState } from "react";
import type { GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import type { GeoKbGenerationKind } from "../../lib/geo-tools/kb-generation.ts";
import { Button } from "../ui/button.tsx";
import { useGeoKbV2Editor } from "./use-geo-kb-v2-editor.ts";
import { GeoKbV2Fields } from "./geo-kb-v2-fields.tsx";
import { GeoKbV2Sources, GeoKbV2RoleProposals } from "./geo-kb-v2-sources.tsx";
import { appendGeoProfileFactV2 } from "./geo-kb-v2-editor.ts";
import { GeoKbV2PreparedReview } from "./geo-kb-v2-prepared-review.tsx";
import { GeoKbVersionContent } from "./geo-kb-version-content.tsx";
import { GeoKbFrozenCopy } from "./geo-kb-frozen-copy.tsx";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";
import { GeoProfileCopyReview } from "./geo-kb-profile-copy-review.tsx";
import { GeoKbV2MeasurementReview } from "./geo-kb-v2-measurement.tsx";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
import { GeoKbV2Progress } from "./geo-kb-v2-progress.tsx";
import { GeoKbV2Block } from "./geo-kb-v2-block.tsx";
import { GeoKbFrozenSummary } from "./geo-kb-frozen-summary.tsx";

export interface GeoKnowledgeBaseV2Props {
  readonly initialView: GeoKbEditorViewV2; readonly locale: string; readonly inline?: boolean;
  readonly confirmedProfileRevision?: number; readonly canonicalWebsiteId?: string;
}
export function GeoKnowledgeBaseV2({ inline = false, ...props }: GeoKnowledgeBaseV2Props) {
  const editor = useGeoKbV2Editor(props), { view, payload } = editor, t = geoKbV2EditorCopy(props.locale);
  const [stage, setStage] = useState<"input" | "frozen">("input"), id = useId();
  const roleGeneration = view.generations.roles;
  const roleProposal = roleGeneration?.state === "succeeded" && roleGeneration.result?.schemaVersion === "marketing-geo-role-proposal.v1" ? roleGeneration.result : null;
  const blockedGeneration = (kind: GeoKbGenerationKind) => editor.generationAction(kind) !== "normal";
  return <section data-geo-kb-v2 data-inline={inline} className="min-w-0 space-y-6 text-text-dark-primary">
    <div role="tablist" aria-label="GEO" className="flex gap-2 border-b border-brand-border-card pb-3">{(["input", "frozen"] as const).map(value => <Button key={value} id={`${id}-${value}-tab`} role="tab" aria-controls={`${id}-${value}-panel`} aria-selected={stage === value} tabIndex={stage === value ? 0 : -1} data-stage={value} type="button" variant={stage === value ? "default" : "outline"} onClick={() => setStage(value)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? "input" : event.key === "End" ? "frozen" : value === "input" ? "frozen" : "input";
      setStage(next); document.getElementById(`${id}-${next}-tab`)?.focus();
    }}>{t[value]}</Button>)}</div>
    {editor.edited ? <p role="status" className="text-sm text-text-dark-secondary">{t.unsaved}</p> : editor.dirty || view.requiresSave ? <p role="status" data-save-pending className="text-sm text-text-dark-secondary">{t.savePending}</p> : null}
    {editor.status.kind === "error" ? <p role="alert" className="text-sm text-brand-error">{editor.status.code === "invalid_input" ? t.invalid : editor.status.code === "input_stale" ? t.staleLineage : editor.status.code === "conflict" ? t.conflict : t.error} <span className="break-all font-mono text-xs">{editor.status.code}</span></p> : null}
    {editor.status.kind === "saved" && !editor.dirty ? <p role="status" className="text-sm text-text-dark-secondary">{t.saved}</p> : null}
    <div role="tabpanel" hidden={stage !== "input"} id={`${id}-input-panel`} aria-labelledby={`${id}-input-tab`} className="space-y-6">
      <GeoKbV2Block id="profile"><GeoKbInheritedProfile profile={view.profile} copy={payload.profileCopy} locale={props.locale} inline facts={payload.facts} onAddFact={(key, value) => {
        const next = appendGeoProfileFactV2(payload, key, value);
        if (next !== null) editor.change(next);
      }} />
      {editor.copyStale ? <p role="status" className="text-sm text-brand-error">{t.sourceChanged}</p> : null}
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={editor.busy} onClick={() => void editor.reviewProfileCopy()}>{t.reviewCopy}</Button><Button type="button" variant="outline" disabled={editor.busy} onClick={() => void editor.reload()}>{t.reload}</Button></div>
      {editor.copyProposal === null ? null : <GeoProfileCopyReview current={payload.profileCopy} proposal={editor.copyProposal} onApply={editor.adoptProfileCopy} onDismiss={editor.dismissProfileCopy} disabled={editor.busy || !editor.canAdoptProfileCopy} />}
      <GeoKbV2MeasurementReview profile={payload.profileCopy.profile} payload={payload} locale={props.locale} disabled={editor.busy} onChange={editor.change} /></GeoKbV2Block>
      <GeoKbV2Block id="supplement"><GeoKbV2Fields payload={payload} locale={props.locale} onChange={editor.change} /></GeoKbV2Block>
      <GeoKbV2Block id="run">
      <GeoKbV2Progress busy={editor.busy} dirty={editor.dirty} requiresSave={view.requiresSave} copyStale={editor.copyStale} needsReview={editor.needsReview}
        canGenerate={editor.canGenerate} canPrepare={editor.canPrepare} canFreeze={editor.canFreeze} hasSourceReceipt={view.sourceReceipt !== null}
        hasRoleProposal={roleProposal !== null} hasCandidate={view.prepared !== null} candidateStale={editor.candidateStale} reviewed={editor.reviewed} />
      <div className="space-y-3"><div className="flex flex-wrap gap-3">
        <Button data-save-v2 type="button" disabled={editor.busy} onClick={() => void editor.save()}>{editor.busy && editor.status.kind === "busy" && editor.status.operation === "save" ? t.busy : t.save}</Button>
        <Button data-refresh-sources type="button" variant="outline" disabled={!editor.canGenerate} onClick={() => void editor.refreshSources()}>{t.sources}</Button>
        <Button data-generate="roles" type="button" variant="outline" disabled={blockedGeneration("roles")} onClick={() => void editor.generate("roles")}>{t.generateRoles}</Button>
        <Button data-generate="questions" type="button" variant="outline" disabled={blockedGeneration("questions")} onClick={() => void editor.generate("questions")}>{t.prepare}</Button>
      </div>{editor.dirty || view.requiresSave ? <p className="text-sm text-text-dark-secondary">{t.saveFirst}</p> : null}{editor.needsReview ? <p className="text-sm text-text-dark-secondary">{t.reviewPending}</p> : null}</div>
      {(["roles", "questions"] as const).map(kind => {
        const action = editor.generationAction(kind);
        if (action !== "new_input" && action !== "resend_same") return null;
        return <section key={kind} className="space-y-3 rounded-card border border-brand-accent/40 bg-brand-panel p-5 text-sm">
          <h3 className="font-semibold">{kind === "roles" ? t.generateRoles : t.prepare}</h3><p>{action === "new_input" ? t.newInputHelp : t.resendHelp}</p>
          <Button type="button" variant="outline" {...{ [action === "new_input" ? "data-new-generation" : "data-resend-generation"]: kind }} disabled={editor.busy} onClick={() => void editor.generate(kind, action)}>{action === "new_input" ? t.newInput : t.resendSame}</Button>
        </section>;
      })}
      {(["roles", "questions"] as const).map(kind => {
        const generation = view.generations[kind], pending = editor.pending[kind];
        if (generation === null && pending === null) return null;
        const uncertain = generation?.state === "uncertain" || pending !== null && generation?.generationId !== pending.generationId;
        return <section data-generation-state={kind} key={kind} className="space-y-3 rounded-card border border-brand-border-card bg-brand-panel p-5 text-sm">
          <h3 className="font-semibold">{kind === "roles" ? t.generateRoles : t.prepare}</h3>
          <p role="status">{pending?.readNotFound && pending.generationId === null ? t.notFoundRequest : uncertain ? t.uncertain : generation?.state === "claimed" || generation?.state === "dispatched" ? t.running : generation?.state === "failed" ? t.failed : `${t.state}: ${generation?.state ?? "unknown"}`}</p>
          {uncertain ? <p>{t.newVersionNeeded}</p> : null}
          {generation ? <><dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-text-dark-secondary">{t.state}</dt><dd>{generation.state}</dd></div>
            {generation.errorReason === null ? null : <div><dt className="text-text-dark-secondary">{t.reason}</dt><dd className="break-words">{generation.errorReason}</dd></div>}
            {generation.attempt === null ? null : <><div><dt className="text-text-dark-secondary">{t.attempt}</dt><dd className="tabular-nums">{generation.attempt.attemptedCalls}</dd></div>
            <div><dt className="text-text-dark-secondary">{t.delivery}</dt><dd>{t.deliveries[generation.attempt.delivery]}</dd></div></>}
          </dl>{generation.attempt?.attemptedCalls === 0 ? <p className="text-xs text-text-dark-secondary">{t.billingNote}</p> : null}</> : null}
          {generation || pending ? <details data-generation-identity><summary className="cursor-pointer text-xs text-text-dark-secondary">{t.recordDetails}</summary><dl className="mt-3 grid gap-2 text-xs">
            {generation ? <div><dt className="text-text-dark-secondary">{t.recordId}</dt><dd className="break-all font-mono">{generation.generationId}</dd></div> : null}
            {pending ? <div><dt className="text-text-dark-secondary">{t.requestKey}</dt><dd className="break-all font-mono">{pending.idempotencyKey}</dd></div> : null}
            {generation?.attempt?.modelRequested == null ? null : <div><dt className="text-text-dark-secondary">{t.model}</dt><dd className="break-all font-mono">{generation.attempt.modelRequested}</dd></div>}
            {generation?.attempt == null || generation.attempt.inputTokens === null && generation.attempt.outputTokens === null ? null : <div><dt className="text-text-dark-secondary">{t.tokens}</dt><dd className="tabular-nums">{generation.attempt.inputTokens ?? "—"} / {generation.attempt.outputTokens ?? "—"}</dd></div>}
            {generation?.attempt?.requestCount == null ? null : <div><dt className="text-text-dark-secondary">{t.requestCount}</dt><dd className="tabular-nums">{generation.attempt.requestCount}</dd></div>}
          </dl></details> : null}
          <Button type="button" variant="outline" data-read-generation={kind} disabled={editor.busy} onClick={() => void editor.readGeneration(kind)}>{t.readGeneration}</Button>
        </section>;
      })}
      {editor.retainedRequests.length ? <section className="space-y-4 rounded-card border border-brand-border-card bg-brand-panel p-5 text-sm"><h3 className="font-semibold">{t.retainedRequests}</h3>{editor.retainedRequests.map(entry => <article key={entry.id} className="space-y-2 rounded-lg border border-brand-border-card p-4">
        <p>{entry.kind === "roles" ? t.generateRoles : t.prepare} · v{entry.baseVersion} · {entry.state}</p><p className="break-all font-mono text-xs">{entry.generationId ?? entry.idempotencyKey} {entry.errorReason ?? ""}</p>
        <Button type="button" variant="outline" data-read-retained={entry.id} disabled={editor.busy} onClick={() => void editor.readRetainedRequest(entry)}>{t.readGeneration}</Button>
      </article>)}</section> : null}
      {view.sourceReceipt ? <GeoKbV2Sources receipt={view.sourceReceipt} baseline={view.payload} payload={payload} locale={props.locale} stale={editor.copyStale || editor.sourceSelection.stale} onChange={editor.change} /> : null}
      {roleProposal ? <GeoKbV2RoleProposals proposal={roleProposal} payload={payload} locale={props.locale} stale={!editor.roleProposalReusable(roleProposal)} onAdopt={(ids, mode) => editor.adoptRoles(roleProposal, ids, mode)} /> : null}
      <GeoKbV2PreparedReview candidate={view.prepared} locale={props.locale} stale={editor.candidateStale} reviewed={editor.reviewed} busy={editor.busy} canFreeze={editor.canFreeze} onReview={editor.confirmReview} onFreeze={() => void editor.freeze()} />
      </GeoKbV2Block>
    </div><div role="tabpanel" hidden={stage !== "frozen"} id={`${id}-frozen-panel`} aria-labelledby={`${id}-frozen-tab`}>
      {view.frozen === null ? <p className="text-sm text-text-dark-secondary">{t.noFrozen}</p> : "context" in view.frozen ? <div data-frozen-v2 className="space-y-5"><GeoKbFrozenSummary frozen={view.frozen} /><GeoKbVersionContent payload={view.frozen.payload} questionSet={view.frozen.questionSet} context={view.frozen.context} locale={props.locale} /></div> : <div className="space-y-5"><p className="text-sm text-text-dark-secondary">{t.legacy}</p><GeoKbFrozenCopy payload={view.frozen.payload} locale={props.locale} revision={view.frozen.revision} /><ul className="space-y-3">{view.frozen.questions?.map(question => <li key={question.id} className="rounded-[10px] border border-brand-border-card p-4 text-sm">{question.text}<p>{question.layer} · {question.roleId ?? "—"}</p><p>{question.requiredEntities?.join(" · ")}</p></li>)}</ul></div>}
    </div>
  </section>;
}
