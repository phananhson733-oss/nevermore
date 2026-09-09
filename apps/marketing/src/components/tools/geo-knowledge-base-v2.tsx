"use client";
// @input -- one owned knowledge base, as either complete V2 editor data or a V3 draft; Profile is maintained once by its parent
// @output -- the card for whichever format arrived: one generate gesture, one create gesture, or the V3 review surface
// @pos -- no live draft is ever merged into a prepared or frozen version, and no format is ever redrawn as the other
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GeoKbEditorViewV2 } from "./geo-kb-v2-wire.ts";
import { Button } from "../ui/button.tsx";
import { useGeoKbV2Editor } from "./use-geo-kb-v2-editor.ts";
import { GeoKbVersionContent } from "./geo-kb-version-content.tsx";
import { GeoKbCard } from "./geo-kb-card.tsx";
import { useGeoKbCopy } from "./geo-kb-copy.ts";
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
import { GeoKnowledgeBaseV3 } from "./geo-kb-v3-review.tsx";
import { createGeoKbV3Draft, upgradeGeoKbToV3 } from "./use-geo-kb-v3-editor.ts";
import type { GeoKbEditorViewV3 } from "./geo-kb-v3-wire.ts";

interface GeoKnowledgeBaseShellProps {
  readonly locale: string; readonly inline?: boolean;
  readonly confirmedProfileRevision?: number; readonly canonicalWebsiteId?: string;
}

/**
 * One knowledge base in exactly one format, never both.
 *
 * `initialView` and `v3Draft` used to be independent props, and the pair was
 * unsatisfiable: the v2 editor loader refuses a v3 draft, so nothing could ever
 * hold a v2 view *and* a v3 draft for the same knowledge base, and the v3 arm of
 * the branch below was unreachable by construction rather than merely unwired.
 * A union says which of the two the caller actually has, so "a v3 draft with no
 * v2 view" is expressible and "both at once" is not.
 */
export type GeoKnowledgeBaseV2Props =
  | (GeoKnowledgeBaseShellProps & {
      readonly initialView: GeoKbEditorViewV2;
      /**
       * Re-read this knowledge base from the route.
       *
       * Required rather than optional because a knowledge base with nothing
       * stored in it is started here, and the created draft is a v3 one that
       * only the route can hand back. A caller with no way to re-read would
       * leave the owner looking at a start button whose press changed the
       * server and nothing on the screen, so the type refuses to be that
       * caller instead of the card discovering it at runtime.
       */
      readonly onStarted: () => void;
      readonly v3Draft?: undefined;
      readonly onUpdateV3?: undefined;
      readonly onReloadV3?: undefined;
    })
  | (GeoKnowledgeBaseShellProps & {
      readonly initialView?: undefined;
      readonly onStarted?: undefined;
      /**
       * A v3 draft, when this knowledge base has been updated to v3. It replaces
       * the card rather than sitting beside it: the two are the same knowledge
       * base in two formats, and drawing both would offer the owner two publish
       * actions with different meanings.
       */
      readonly v3Draft: GeoKbEditorViewV3;
      /** The billed v3 update. Owned by the run route, so it is passed through. */
      readonly onUpdateV3?: () => void;
      /**
       * Re-read this knowledge base after the review card replaced the stored
       * draft -- which rebuilding it from the confirmed Profile does.
       *
       * Optional rather than required, unlike `onStarted` on the other arm,
       * because the review card has a working fallback: it reloads the page.
       * A caller that owns a cheaper re-read passes it here. Nothing does yet;
       * `website-geo-editor.tsx` already holds exactly such a `reload` and
       * wiring it is one line, reported as a seam rather than made here.
       */
      readonly onReloadV3?: () => void;
    });

/**
 * The v2 card and the v3 review card are separate components rather than one
 * component with a branch, because each owns a different editor hook and a hook
 * cannot be called conditionally.
 */
export function GeoKnowledgeBaseV2(props: GeoKnowledgeBaseV2Props) {
  if (props.v3Draft !== undefined) {
    const { v3Draft, onUpdateV3, onReloadV3, locale, inline = false, confirmedProfileRevision } = props;
    return <GeoKnowledgeBaseV3
      view={v3Draft}
      locale={locale}
      inline={inline}
      /* Spread rather than passed as `undefined`: the card treats an absent
         revision as "nothing to compare", and a caller that does not know the
         current one must not be able to make it look like a match. */
      {...(confirmedProfileRevision === undefined ? {} : { confirmedProfileRevision })}
      {...(onUpdateV3 === undefined ? {} : { onUpdate: onUpdateV3 })}
      {...(onReloadV3 === undefined ? {} : { onReload: onReloadV3 })}
    />;
  }
  const { v3Draft: _v3Draft, onUpdateV3: _onUpdateV3, onReloadV3: _onReloadV3, onStarted, ...card } = props;
  // The cut between the two formats, and the only place it is made.
  //
  // No stored draft: this knowledge base has no v1/v2 work to lose, so it starts
  // straight into v3. `draftHash === null` is the wire's own statement that no
  // draft is stored -- `parseGeoKbEditorViewV2` refuses any view where it
  // disagrees with `draftVersion === 0`, so the two cannot drift apart here.
  //
  // A published version no longer disqualifies it. That half of the condition
  // was here because the v3 loader answered `v3_predecessor_unsupported` for a
  // v3 draft standing over a v1/v2 version, which was a permanent 503 for that
  // knowledge base. The loader now reports such a version as `opaque` instead,
  // so the pair is a working state and the published version stays exactly what
  // AI Visibility and Brief read until a v3 publish supersedes it.
  if (card.initialView.draftHash === null) {
    return <GeoKbV3StartCard view={card.initialView} locale={card.locale} inline={card.inline ?? false} onStarted={onStarted} />;
  }
  // A stored v1/v2 draft holds work. It keeps the card that can read it, and the
  // move to v3 is offered there as a named gesture that says what it discards --
  // never taken on the owner's behalf by a format change they did not ask for.
  return <GeoKnowledgeBaseV2Card {...card} onUpgraded={onStarted} />;
}

/**
 * The card for a knowledge base that does not exist yet.
 *
 * It replaces the v2 card rather than adding a button to it, because the two
 * offer different things: the v2 card's one gesture runs the v1/v2 pipeline and
 * would write a v1/v2 draft, which is exactly the outcome this cut exists to
 * stop for a knowledge base that has no history to keep.
 *
 * What the gesture does is create the first v3 draft and nothing else. The
 * route it calls makes no model call, spends no crawl allowance and collects
 * nothing (`kb-v3-draft-create.ts`); it locks the generation input a later,
 * billed run pays against. So the card carries no cost sentence: the shell's
 * default one describes the update run, which is the *next* press, on the
 * review card this one hands over to. Printing it here would announce a charge
 * that this button provably does not make.
 *
 * That absence is a copy gap rather than a design: there is no catalog key for
 * "this step is free and produces a draft to review", and adding one is
 * reported as a seam rather than invented here.
 */
function GeoKbV3StartCard({ view, locale, inline, onStarted }: {
  readonly view: GeoKbEditorViewV2;
  readonly locale: string;
  readonly inline: boolean;
  readonly onStarted: () => void;
}) {
  const copy = useGeoKbCopy();
  const [state, setState] = useState<"idle" | "busy" | "invalid" | "error">("idle");
  /**
   * One create, however fast the button is pressed -- and a ref rather than
   * `state`, which is what this guard used to read.
   *
   * Two clicks inside one task run the same handler closure, so the second one
   * still sees `state === "idle"` however many times the first has set it: the
   * re-render that would have disabled the button has not happened yet.
   * Measured, not reasoned: with the state guard in place, two `click()` calls
   * in a single `act` sent two create requests. The second one spends one of
   * the four creates an hour this knowledge base is allowed, on a draft the
   * first one is already making.
   */
  const creating = useRef(false);

  async function start(): Promise<void> {
    if (creating.current) return;
    creating.current = true;
    setState("busy");
    const result = await createGeoKbV3Draft(view.kbId);
    /**
     * `result.draft.blockers` is deliberately not rendered here, and is not
     * dropped either.
     *
     * A blocker names a reason the created draft cannot start a paid run --
     * today, a Profile with no categories, which confirms without them
     * (`categories` is not in `REQUIRED_PROFILE_FIELDS`) and leaves the billed
     * update unable to build its input at all. This card cannot be the place
     * that says so: the very next thing it does is hand this knowledge base
     * over to the review card, and a sentence printed on a card that is about
     * to be replaced is a sentence nobody reads.
     *
     * The review card states it instead, and derives it from the locked
     * generation input rather than from this one-shot answer -- so it is still
     * there on the second visit, and after any reload, rather than only in the
     * seconds after a create. See `geoKbV3DraftBlockers`.
     */
    // A knowledge base that already holds a draft is one this card has stopped
    // describing, however it got there -- another tab, or a create that raced
    // this one. Re-reading shows whatever is actually stored; keeping a start
    // button over it would offer to create a second first draft.
    if (result.ok || result.code === "draft_exists" || result.code === "legacy_draft" || result.code === "conflict") {
      // Deliberately left latched: this card is being replaced by the re-read,
      // and a second create over a draft that now exists could only ever be
      // refused.
      onStarted();
      return;
    }
    creating.current = false;
    // Two different remedies, kept apart. One is a Profile that has to be
    // completed and confirmed before anything can be built from it; the other
    // is a failure to try again later. Collapsing them would send an owner to
    // retry a refusal that will never change on its own.
    setState(["profile_unusable", "profile_not_confirmed", "website_not_found", "draft_invalid"].includes(result.code) ? "invalid" : "error");
  }

  return <GeoKbCard
    data-geo-kb-start={true}
    host={view.host}
    locale={locale}
    inline={inline}
    state="none"
    statusText={copy.status.none}
    onUpdate={() => void start()}
    updateDisabled={state === "busy"}
    costNote={<></>}
  >
    {state === "invalid" || state === "error"
      ? <p role="alert" className="text-[13px] text-brand-error">{state === "invalid" ? copy.state.invalid : copy.state.error}</p>
      : null}
  </GeoKbCard>;
}

interface GeoKnowledgeBaseV2CardProps extends GeoKnowledgeBaseShellProps {
  readonly initialView: GeoKbEditorViewV2;
  /** Re-read this knowledge base: the upgrade replaces it with a v3 draft. */
  readonly onUpgraded: () => void;
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
 *
 * The shell is `GeoKbCard`, shared with the redesigned knowledge base, so this
 * card and the Product Profile card above it are drawn once rather than twice.
 * The customer sentences moved out of two inline locale literals and into the
 * catalog: shipped copy that the catalog does not hold cannot be reviewed, and
 * it left three catalog keys orphaned behind it.
 */
function GeoKnowledgeBaseV2Card({ inline = false, onUpgraded, ...props }: GeoKnowledgeBaseV2CardProps) {
  const editor = useGeoKbV2Editor(props), { view, payload } = editor;
  const [upgrade, setUpgrade] = useState<"idle" | "busy" | "error" | "unconfirmed">("idle");
  const upgrading = useRef(false);
  const t = geoKbV2EditorCopy(props.locale), c = geoKbV2Copy(props.locale), te = useTranslations("tools.geoKnowledgeBase.editor");
  const customer = useGeoKbCopy().state;
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
  /**
   * The one-way move to the redesigned knowledge base.
   *
   * It discards this draft -- a v1/v2 draft holds accepted facts and reviewed
   * roles the v3 generation input has no field for -- and the next update is
   * billed again, because only a paid run can fill a v3 body. The note beside
   * the button says both before it is pressed; the route requires this draft's
   * digest as the acknowledgement, so a press cannot be made by anything that
   * was not shown the draft it is discarding.
   */
  async function startUpgrade() {
    if (upgrading.current || view.draftHash === null) return;
    upgrading.current = true;
    setUpgrade("busy");
    const result = await upgradeGeoKbToV3({ kbId: view.kbId, baseVersion: view.draftVersion, draftHash: view.draftHash });
    // `draft_exists` means another tab got there first, and `conflict` means
    // this draft moved. Both are answered by re-reading, which shows whatever is
    // actually stored -- not by leaving a button that can only be refused.
    if (result.ok || result.code === "draft_exists" || result.code === "conflict") {
      onUpgraded();
      return;
    }
    upgrading.current = false;
    /*
     * Two different failures, because they leave the owner in two different
     * places -- and the list below is an allow-list on purpose.
     *
     * These are the refusals `kb-v3-draft-create.ts` decides BEFORE `saveDraft`
     * runs (:791 through :989, plus :1003's `input_locked`, which is the store
     * declining to write): nothing was replaced, so "nothing was changed" is a
     * fact and a retry is a real offer. Everything else falls to `unconfirmed`,
     * including `store_unavailable` -- which the route also returns from :1015
     * and :1050, AFTER the write that discards the v1/v2 draft -- `network`,
     * `bad_response`, and any code nobody has thought of yet. This is a one-way
     * gesture, so an unrecognised code must not be answered with an assurance:
     * telling the owner nothing changed when the move did go through hides both
     * the discarded draft and the fact that the next update is billed.
     */
    const nothingWritten = new Set([
      "invalid_request", "not_found", "legacy_draft", "generation_running",
      "website_not_found", "profile_not_confirmed", "profile_unusable",
      "draft_invalid", "input_changed",
    ]);
    setUpgrade(nothingWritten.has(result.code) ? "error" : "unconfirmed");
  }

  return <GeoKbCard
    data-geo-kb-v2={true}
    host={view.host}
    locale={props.locale}
    inline={inline}
    state={state}
    statusText={statusText}
    onUpdate={() => void editor.generateAll()}
    updateLabel={editor.building ? t.busy : frozen === null ? te("generate") : te("regenerate")}
    updateDisabled={editor.busy || editor.building || !editor.generationLanguageSupported}
    /* One billed run, said once, beside the button that bills it. */
    costNote={editor.generationLanguageSupported
      ? <span className="block text-[12px] leading-relaxed text-text-dark-secondary">{te("generateCost")}</span>
      : <span data-generation-language-warning role="status" className="block text-[12px] leading-relaxed text-brand-error">{unsupportedLanguage}</span>}
  >
    <div data-kb-upgrade-v3="" className="min-w-0 space-y-2 rounded-card border border-brand-border-card bg-brand-panel p-4">
      <p className="text-[13px] leading-relaxed text-text-dark-secondary">{te("upgradeNote")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-upgrade-v3=""
        disabled={upgrade === "busy" || editor.busy || editor.building}
        onClick={() => void startUpgrade()}
      >{te("upgrade")}</Button>
      {upgrade === "error" || upgrade === "unconfirmed"
        ? <p role="alert" className="text-[13px] leading-relaxed text-brand-error">{te(upgrade === "unconfirmed" ? "upgradeUnconfirmed" : "upgradeFailed")}</p>
        : null}
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
  </GeoKbCard>;
}
