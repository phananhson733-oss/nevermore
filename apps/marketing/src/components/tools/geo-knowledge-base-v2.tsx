"use client";
// @input -- complete owned V2 editor data; Profile is maintained once by its parent
// @output -- one generate gesture and the knowledge base it produced
// @pos -- no live draft is ever merged into a prepared or frozen version
import { useTranslations } from "next-intl";
import type { GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import { Button } from "../ui/button.tsx";
import { useGeoKbV2Editor } from "./use-geo-kb-v2-editor.ts";
import { GeoKbVersionContent } from "./geo-kb-version-content.tsx";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";

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
 * cannot proceed, the run stops and the customer sees the update outcome.
 */
export function GeoKnowledgeBaseV2({ inline = false, ...props }: GeoKnowledgeBaseV2Props) {
  const editor = useGeoKbV2Editor(props), { view, payload } = editor;
  const t = geoKbV2EditorCopy(props.locale), c = geoKbV2Copy(props.locale), te = useTranslations("tools.geoKnowledgeBase.editor");
  const customer = props.locale.startsWith("zh") ? {
    failed: "更新未完成，仍显示上次的知识内容。", failedEmpty: "知识内容尚未生成，请稍后重试。",
    pending: "更新结果尚未确认，当前内容保持不变。", running: "正在更新知识内容…", current: "当前 GEO 知识内容", empty: "还没有 GEO 知识内容。",
    stale: "网站资料已更新，可以重新生成知识内容。", check: "检查更新结果", oldCheck: "检查之前的更新结果",
    unknown: "更新结果尚未确认，可以检查结果；不会自动重复扣费。", retry: "继续更新", retryHelp: "继续检查并处理这次更新。",
    newInput: "使用更新后的资料生成", newInputHelp: "将按更新后的资料重新生成，并消耗积分。",
    sourceChanged: "请先在网站资料中保存最新内容，再重新生成。",
    invalid: "网站资料暂时无法用于生成，请检查并保存后重试。", error: "更新暂未完成，请稍后再试。",
  } : {
    failed: "The update did not finish. Your previous knowledge is still shown.", failedEmpty: "Knowledge has not been generated yet. Please try again later.",
    pending: "The update outcome is unknown. Your current content is unchanged.", running: "Updating knowledge…", current: "Current GEO knowledge", empty: "No GEO knowledge yet.",
    stale: "Your website information changed. You can generate updated knowledge.", check: "Check update", oldCheck: "Check earlier update",
    unknown: "The outcome is unknown. Check the result; no charge is repeated automatically.", retry: "Continue update", retryHelp: "Continue checking and processing this update.",
    newInput: "Generate using updated information", newInputHelp: "This generates from your updated information and uses credits.",
    sourceChanged: "Save the latest website information before generating again.",
    invalid: "The website information cannot be used yet. Check and save it before trying again.", error: "The update could not finish. Please try again later.",
  };
  const frozen = view.frozen;
  const current = frozen !== null && "context" in frozen && frozen.contentHash === view.draftHash;
  const unsupportedLanguage = te("unsupportedLanguage", { language: editor.generationLanguage });
  const unsupportedLanguageAfterStart = te("unsupportedLanguageAfterStart", { language: payload.market.language });
  const generationKinds = ["roles", "knowledge_pack", "questions"] as const;
  const hasUnknown = generationKinds.some(kind => view.generations[kind]?.state === "uncertain" || editor.pending[kind] !== null && editor.pending[kind]?.generationId !== view.generations[kind]?.generationId);
  const hasRunning = generationKinds.some(kind => ["claimed", "dispatched"].includes(view.generations[kind]?.state ?? ""));
  const stopped = editor.build?.stoppedAt != null || editor.confirm?.stoppedAt != null || editor.status.kind === "error" || generationKinds.some(kind => view.generations[kind]?.state === "failed");
  const state = editor.building || hasRunning ? "running" : hasUnknown ? "pending" : stopped ? "failed" : current ? "current" : frozen === null ? "none" : "stale";
  const statusText = state === "running" ? customer.running : state === "pending" ? customer.pending : state === "failed" ? frozen === null ? customer.failedEmpty : customer.failed : state === "current" ? customer.current : state === "none" ? customer.empty : customer.stale;
  return <section data-geo-kb-v2 data-inline={inline} className="min-w-0 space-y-6 text-text-dark-primary">
    {/* The Profile editor's header, in the same order: which website this is,
        one persistent live region whose text changes (a node inserted per
        change is not reliably announced), then the action. */}
    <div className="flex min-w-0 flex-col gap-4 rounded-card border border-brand-border-card bg-brand-panel p-6">
      <div>
        <span className="block break-all text-[13px] text-brand-accent-text">{view.host}</span>
        <span aria-live="polite" aria-atomic="true" data-kb-state={state} className="mt-2 block min-h-5 text-[13px] text-text-dark-secondary">
          {statusText}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button data-generate-kb type="button" disabled={editor.busy || editor.building || !editor.generationLanguageSupported} onClick={() => void editor.generateAll()}>{editor.building ? t.busy : frozen === null ? te("generate") : te("regenerate")}</Button>
      </div>
      {/* One billed run, said once, beside the button that bills it. */}
      {editor.generationLanguageSupported
        ? <span className="block text-[12px] leading-relaxed text-text-dark-secondary">{te("generateCost")}</span>
        : <span data-generation-language-warning role="status" className="block text-[12px] leading-relaxed text-brand-error">{unsupportedLanguage}</span>}
    </div>
    {editor.status.kind === "error" ? <p role="alert" className="text-[13px] text-brand-error">{editor.status.code === "invalid_input" ? customer.invalid : editor.status.code === "input_stale" ? customer.sourceChanged : editor.status.code === "generation_running" ? customer.running : editor.status.code === "unsupported_language" ? unsupportedLanguageAfterStart : customer.error}</p> : null}

    {editor.copyStale ? <p role="status" className="text-[13px] text-brand-error">{customer.sourceChanged}</p> : null}

    {/* A generation the server has not settled. It is the one place a person
        still has to act, because pressing again could be a second billed call
        for a request that may already have run. */}
    {generationKinds.map(kind => {
      const knowledgeGenerationId = editor.recoveryKnowledgeGenerationId(kind);
      const action = editor.generationAction(kind, knowledgeGenerationId);
      if (action !== "new_input" && action !== "resend_same") return null;
      return <div key={kind} className="flex flex-wrap items-center gap-3 text-[13px] text-text-dark-secondary">
        <span>{action === "new_input" ? customer.newInputHelp : customer.retryHelp}</span>
        <Button type="button" variant="outline" {...{ [action === "new_input" ? "data-new-generation" : "data-resend-generation"]: kind }} disabled={editor.busy || !editor.savedGenerationLanguageSupported} onClick={() => void editor.generate(kind, action, action === "resend_same" ? knowledgeGenerationId : undefined)}>{action === "new_input" ? customer.newInput : customer.retry}</Button>
      </div>;
    })}
    {generationKinds.map(kind => {
      const generation = view.generations[kind], pending = editor.pending[kind];
      if (generation === null && pending === null) return null;
      const uncertain = generation?.state === "uncertain" || pending !== null && generation?.generationId !== pending.generationId;
      // A settled, successful generation says what it produced by producing it.
      // Only an unsettled or failed one needs a row of its own.
      const running = generation?.state === "claimed" || generation?.state === "dispatched";
      if (!uncertain && !running && generation?.state !== "failed" && pending?.readNotFound !== true) return null;
      return <div data-generation-state={kind} key={kind} className="flex flex-wrap items-center gap-3 text-[13px] text-text-dark-secondary">
        {uncertain || pending?.readNotFound ? <span role="status">{customer.unknown}</span> : null}
        <Button type="button" variant="outline" data-read-generation={kind} disabled={editor.busy} onClick={() => void editor.readGeneration(kind)}>{customer.check}</Button>
      </div>;
    })}
    {editor.retainedRequests.length ? <div className="flex flex-wrap gap-3">{editor.retainedRequests.map(entry =>
      <Button key={entry.id} type="button" variant="outline" data-read-retained="" disabled={editor.busy} onClick={() => void editor.readRetainedRequest(entry)}>{customer.oldCheck}</Button>
    )}</div> : null}

    {/* The knowledge base itself. */}
    {frozen === null ? <p data-kb-empty className="text-sm text-text-dark-secondary">{te("generateEmpty")}</p>
      : "context" in frozen ? <div data-frozen-v2 className="space-y-5"><GeoKbVersionContent payload={frozen.payload} questionSet={frozen.questionSet} context={frozen.context} knowledgePack={"knowledgePack" in frozen ? frozen.knowledgePack : null} locale={props.locale} customerFacing /></div>
      : <div className="space-y-5"><p className="text-sm text-text-dark-secondary">{t.legacy}</p><ul className="space-y-3">{frozen.questions?.map(question => <li key={question.id} data-legacy-question="" className="rounded-[10px] border border-brand-border-card p-4 text-[13px] leading-relaxed">{question.text}<span className="mt-1 block text-[13px] leading-relaxed text-text-dark-secondary">{c.layers[question.layer as keyof typeof c.layers] ?? question.layer}</span><span className="mt-1 block text-[13px] leading-relaxed">{question.requiredEntities?.join(" · ")}</span></li>)}</ul></div>}
  </section>;
}
