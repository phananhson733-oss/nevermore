"use client";
// @input -- complete owned V2 editor data; Profile is maintained once by its parent
// @output -- one generate gesture and the knowledge base it produced
// @pos -- no live draft is ever merged into a prepared or frozen version
import { useTranslations } from "next-intl";
import type { GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import { Button } from "../ui/button.tsx";
import { useGeoKbV2Editor } from "./use-geo-kb-v2-editor.ts";
import { GeoKbVersionContent } from "./geo-kb-version-content.tsx";
import { GeoKbFrozenCopy } from "./geo-kb-frozen-copy.tsx";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
import { GeoKbV2BuildReport } from "./geo-kb-v2-build-report.tsx";
import { GeoKbV2ConfirmReport } from "./geo-kb-v2-confirm-report.tsx";

export interface GeoKnowledgeBaseV2Props {
  readonly initialView: GeoKbEditorViewV2; readonly locale: string; readonly inline?: boolean;
  readonly confirmedProfileRevision?: number; readonly canonicalWebsiteId?: string;
}

/**
 * One button, the way the Product Profile has one: the inputs are maintained
 * there, and this derives a knowledge base from them.
 *
 * What it replaced was a five-step workbench -- save the draft, refresh the
 * sources, generate the roles, prepare the candidate, freeze it -- each step a
 * button of its own, around editors for roles, competitors and facts that held
 * nothing until those steps had run. None of the five was a decision the person
 * pressing it was making; the decisions live in the Profile. Where a step
 * genuinely cannot proceed, the run stops and the report below names which one.
 */
export function GeoKnowledgeBaseV2({ inline = false, ...props }: GeoKnowledgeBaseV2Props) {
  const editor = useGeoKbV2Editor(props), { view, payload } = editor;
  const t = geoKbV2EditorCopy(props.locale), c = geoKbV2Copy(props.locale), te = useTranslations("tools.geoKnowledgeBase.editor");
  const stateLabel = (state: string | undefined) => te(`generationStates.${(["claimed", "dispatched", "succeeded", "failed", "uncertain", "unknown", "not_found"] as const).find(known => known === state) ?? "unknown"}`);
  const frozen = view.frozen;
  const current = frozen !== null && "context" in frozen && frozen.contentHash === view.draftHash;
  const unsupportedLanguage = te("unsupportedLanguage", { language: editor.generationLanguage });
  const unsupportedLanguageAfterStart = te("unsupportedLanguageAfterStart", { language: payload.market.language });
  return <section data-geo-kb-v2 data-inline={inline} className="min-w-0 space-y-6 text-text-dark-primary">
    {/* The Profile editor's header, in the same order: which website this is,
        one persistent live region whose text changes (a node inserted per
        change is not reliably announced), then the action. */}
    <div className="flex min-w-0 flex-col gap-4 rounded-card border border-brand-border-card bg-brand-panel p-6">
      <div>
        <p className="break-all text-[13px] text-brand-accent-text">{view.host}</p>
        <p aria-live="polite" aria-atomic="true" data-kb-state={editor.building ? "running" : current ? "current" : frozen === null ? "none" : "stale"} className="mt-2 min-h-5 text-[13px] text-text-dark-secondary">
          {editor.building ? te("generateBusy") : current ? te("generateCurrent") : frozen === null ? te("generateNone") : te("generateStale")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button data-generate-kb type="button" disabled={editor.busy || editor.building || !editor.generationLanguageSupported} onClick={() => void editor.generateAll()}>{editor.building ? t.busy : frozen === null ? te("generate") : te("regenerate")}</Button>
      </div>
      {/* One billed run, said once, beside the button that bills it. */}
      {editor.generationLanguageSupported
        ? <p className="text-[12px] leading-relaxed text-text-dark-secondary">{te("generateCost")}</p>
        : <p data-generation-language-warning role="status" className="text-[12px] leading-relaxed text-brand-error">{unsupportedLanguage}</p>}
      <GeoKbV2BuildReport report={editor.build} locale={props.locale} />
      <GeoKbV2ConfirmReport report={editor.confirm} />
    </div>
    {editor.status.kind === "error" ? <p role="alert" className="text-sm text-brand-error">{editor.status.code === "invalid_input" ? t.invalid : editor.status.code === "input_stale" ? t.staleLineage : editor.status.code === "conflict" ? te("conflict") : editor.status.code === "generation_running" ? te("generationRunning") : editor.status.code === "unsupported_language" ? unsupportedLanguageAfterStart : t.error}{["invalid_input", "input_stale", "conflict", "generation_running", "unsupported_language"].includes(editor.status.code) ? null : <> <span className="break-all font-mono text-xs">{editor.status.code}</span></>}</p> : null}

    {/* What it reads. Maintained in the Profile, read out here, never typed
        into here -- which is the whole reason this page has one button. */}
    <GeoKbInheritedProfile profile={view.profile} copy={payload.profileCopy} locale={props.locale} inline heading={3} />
    {editor.copyStale ? <p role="status" className="text-sm text-brand-error">{t.sourceChanged}</p> : null}

    {/* A generation the server has not settled. It is the one place a person
        still has to act, because pressing again could be a second billed call
        for a request that may already have run. */}
    {(["roles", "questions"] as const).map(kind => {
      const action = editor.generationAction(kind);
      if (action !== "new_input" && action !== "resend_same") return null;
      return <section key={kind} className="space-y-3 rounded-card border border-brand-accent/40 bg-brand-panel p-5 text-sm">
        <h3 className="font-semibold">{kind === "roles" ? t.generateRoles : t.prepare}</h3><p>{action === "new_input" ? t.newInputHelp : t.resendHelp}</p>
        <Button type="button" variant="outline" {...{ [action === "new_input" ? "data-new-generation" : "data-resend-generation"]: kind }} disabled={editor.busy || !editor.savedGenerationLanguageSupported} onClick={() => void editor.generate(kind, action)}>{action === "new_input" ? t.newInput : t.resendSame}</Button>
      </section>;
    })}
    {(["roles", "questions"] as const).map(kind => {
      const generation = view.generations[kind], pending = editor.pending[kind];
      if (generation === null && pending === null) return null;
      const uncertain = generation?.state === "uncertain" || pending !== null && generation?.generationId !== pending.generationId;
      // A settled, successful generation says what it produced by producing it.
      // Only an unsettled or failed one needs a row of its own.
      const running = generation?.state === "claimed" || generation?.state === "dispatched";
      if (!uncertain && !running && generation?.state !== "failed" && pending?.readNotFound !== true) return null;
      return <section data-generation-state={kind} key={kind} className="space-y-3 rounded-card border border-brand-border-card bg-brand-panel p-5 text-sm">
        <h3 className="font-semibold">{kind === "roles" ? t.generateRoles : t.prepare}</h3>
        <p role="status">{pending?.readNotFound && pending.generationId === null ? t.notFoundRequest : uncertain ? t.uncertain : running ? t.running : t.failed}</p>
        {uncertain ? <p>{t.newVersionNeeded}</p> : null}
        {generation?.attempt ? <><dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-text-dark-secondary">{te("attempt")}</dt><dd className="tabular-nums">{generation.attempt.attemptedCalls}</dd></div>
          <div><dt className="text-text-dark-secondary">{te("delivery")}</dt><dd>{te(`deliveries.${generation.attempt.delivery}`)}</dd></div>
        </dl>{generation.attempt.attemptedCalls === 0 ? <p className="text-xs text-text-dark-secondary">{te("billingNote")}</p> : null}</> : null}
        <Button type="button" variant="outline" data-read-generation={kind} disabled={editor.busy} onClick={() => void editor.readGeneration(kind)}>{t.readGeneration}</Button>
      </section>;
    })}
    {editor.retainedRequests.length ? <section className="space-y-4 rounded-card border border-brand-border-card bg-brand-panel p-5 text-sm"><h3 className="font-semibold">{t.retainedRequests}</h3>{editor.retainedRequests.map(entry => <article key={entry.id} className="space-y-2 rounded-lg border border-brand-border-card p-4">
      <p>{entry.kind === "roles" ? t.generateRoles : t.prepare} · v{entry.baseVersion} · {stateLabel(entry.state)}</p>
      {/* Which request this is. Two retained requests are otherwise identical
          and the read button acts on exactly one of them. */}
      <p className="break-all font-mono text-xs text-text-dark-secondary">{entry.generationId ?? entry.idempotencyKey} {entry.errorReason ?? ""}</p>
      <Button type="button" variant="outline" data-read-retained={entry.id} disabled={editor.busy} onClick={() => void editor.readRetainedRequest(entry)}>{t.readGeneration}</Button>
    </article>)}</section> : null}

    {/* The knowledge base itself. */}
    {frozen === null ? <p data-kb-empty className="text-sm text-text-dark-secondary">{te("generateEmpty")}</p>
      : "context" in frozen ? <div data-frozen-v2 className="space-y-5"><GeoKbVersionContent payload={frozen.payload} questionSet={frozen.questionSet} context={frozen.context} locale={props.locale} customerFacing /></div>
      : <div className="space-y-5"><p className="text-sm text-text-dark-secondary">{t.legacy}</p><GeoKbFrozenCopy payload={frozen.payload} locale={props.locale} revision={frozen.revision} /><ul className="space-y-3">{frozen.questions?.map(question => <li key={question.id} className="rounded-[10px] border border-brand-border-card p-4 text-sm">{question.text}<p className="text-text-dark-secondary">{c.layers[question.layer as keyof typeof c.layers] ?? question.layer}</p><p>{question.requiredEntities?.join(" · ")}</p></li>)}</ul></div>}
  </section>;
}
