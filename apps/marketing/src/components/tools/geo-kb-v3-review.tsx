"use client";
// @input  -- one loaded v3 draft, through the review editor hook
// @output -- the reviewable modules with their four gestures, the competitor rows above them, the free publish action, the update run, and the two exits from a draft that cannot make progress
// @pos    -- the surface for 接受 / 修正 / 排除 / 全部接受 and 发布, the competitor confirmations, the tab's half of the run protocol, and the rebuild/discard recovery; it names no work a run performs
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The review card for a draft nobody has published yet.
 *
 * Only five of the eight knowledge modules carry per-item decisions -- entity,
 * facts, Q&A, comparisons and scope -- so only those get rows and buttons.
 * Evidence, machine readability and coverage are observations of what was
 * looked at rather than claims being made, so no gesture is offered for them.
 *
 * They get no renderer here either, and the note standing in for them says
 * exactly that and nothing more. It used to say the content was "shown in full
 * on the published version", which named a surface that does not exist:
 * `kb-editor-loader.ts` carries a published v3 version's revision, timestamp,
 * content hash and per-item decisions and never its pack body, and
 * `GeoKnowledgePackV2View` -- the renderer that could draw one -- is reached
 * only from the v2 card's frozen view, which a v3 knowledge base never renders.
 * The modules themselves are in `payload.knowledge` right here; drawing them
 * would need the pack renderer's per-module components, which that file keeps
 * private. Until one of those two seams is opened, the only honest thing the
 * note can say is that this screen does not show them.
 *
 * The "accept all" button lives inside the module it accepts, in
 * `GeoKbModuleSection`'s `action` slot, rather than in a toolbar that has lost
 * track of which module it is pointing at. It writes `accepted`, the same
 * label the per-item button writes: the Owner's ruling (2026-09-09) is that a
 * batch acceptance is an acceptance, so there is no second label to explain
 * and no note beside the button explaining it.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Button } from "../ui/button.tsx";
import { GeoKbCard, type GeoKbCardSections } from "./geo-kb-card.tsx";
import { GeoKbCompetitors } from "./geo-kb-competitors.tsx";
import { GeoKbItemRow, type GeoKbItemActions } from "./geo-kb-item-row.tsx";
import { GeoKbEvidenceGroup, GeoKbModuleSection, geoKbModuleState, geoKbModuleValue, type GeoKbModulePresentation } from "./geo-kb-module-section.tsx";
import { geoKbFormatDate, useGeoKbCopy, type GeoKbCopy } from "./geo-kb-copy.ts";
import {
  geoKbItemSourceOf,
  GeoCoverageModuleView,
  GeoEvidenceModuleView,
  GeoMachineModuleView,
} from "./geo-knowledge-pack-v2.tsx";
import { geoKnowledgePackCopy } from "./geo-knowledge-pack-copy.ts";
import {
  geoKbV3DraftBlockers,
  relockGeoKbV3Draft,
  useGeoKbV3Editor,
  type GeoKbV3AutosaveHold,
  type GeoKbV3Blocker,
  type GeoKbV3Relocked,
} from "./use-geo-kb-v3-editor.ts";
import {
  abandonGeoKbRun,
  driveGeoKbRun,
  readGeoKbRunState,
  type GeoKbRunOperationView,
  type GeoKbRunView,
} from "./geo-kb-run-continue.ts";
import type { GeoKbEditorViewV3 } from "./geo-kb-v3-wire.ts";
import type { GeoKnowledgeSourceV2 } from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";
import { GEO_ENTITY_CORRECTABLE_PATHS, GEO_ENTITY_REQUIRED_PATHS } from "../../lib/geo-tools/kb-knowledge-shape.ts";
import {
  geoEntityCorrectionIssue,
  type GeoEntityCorrectionRuleV3,
  type GeoKnowledgeBodyV3,
  type GeoOverrideV3,
} from "../../lib/geo-tools/kb-v3-contract.ts";

type SourceIndex = ReadonlyMap<string, GeoKnowledgeSourceV2>;
type Editor = ReturnType<typeof useGeoKbV3Editor>;
type Correctable = (typeof GEO_ENTITY_CORRECTABLE_PATHS)[number];

const CORRECTABLE = new Set<string>(GEO_ENTITY_CORRECTABLE_PATHS);
/**
 * Entity fields the published entity has no shape for without a value. The
 * assembler withholds the whole identity section rather than publish one the
 * owner excluded, so the row does not offer the gesture.
 */
const REQUIRED_ENTITY = new Set<string>(GEO_ENTITY_REQUIRED_PATHS);

/**
 * How every module on this card is drawn. The limitation sentence is off:
 * each absence it would name is already said on the rows beneath it, and the
 * Owner read the sentence as one more line to skip (2026-09-11). The three
 * modules that report observations rather than ask for decisions fold to
 * their header as well; the five that carry buttons stay open, because a
 * folded module hides the very controls this card exists for.
 */
const REVIEWABLE: GeoKbModulePresentation = { limitation: false };
const READ_ONLY: GeoKbModulePresentation = { limitation: false, collapsible: true };

/** One item's provenance, in the shape both the draft and the pack express it. */
interface DraftProvenance {
  readonly itemKey: string;
  readonly origin: Parameters<typeof geoKbItemSourceOf>[0]["origin"];
  readonly sourceRefs: readonly string[];
  readonly evidenceChecks: Parameters<typeof GeoKbItemRow>[0]["evidenceChecks"];
  readonly alternateObservations: readonly unknown[];
}

/**
 * What a correction to one item edits. A correction carries the text a reader
 * sees and never the provenance, so each module has exactly the fields its own
 * contract admits -- and a fact keeps its label, because the label names the
 * attribute rather than stating the value.
 */
type Draft =
  | { readonly module: "facts"; readonly label: string; readonly statement: string; readonly value: string }
  | { readonly module: "qa"; readonly directAnswer: string; readonly expansion: string | null }
  | { readonly module: "comparisons"; readonly product: string; readonly competitor: string }
  | { readonly module: "scope"; readonly text: string }
  | { readonly module: "entity"; readonly field: Correctable; readonly value: string };

function overrideOf(draft: Draft): GeoOverrideV3 | null {
  switch (draft.module) {
    case "facts":
      // The contract holds a correction to the same rule generated text obeys:
      // a value and an unavailability reason cannot both be present.
      return draft.value.trim() === "" || draft.statement.trim() === ""
        ? null
        : { module: "facts", statement: draft.statement, label: draft.label, value: draft.value, reason: "" };
    case "qa":
      return draft.directAnswer.trim() === "" ? null : { module: "qa", directAnswer: draft.directAnswer, expansion: draft.expansion };
    case "comparisons":
      return draft.product.trim() === "" || draft.competitor.trim() === ""
        ? null
        : { module: "comparisons", product: draft.product, competitor: draft.competitor };
    case "scope":
      return draft.text.trim() === "" ? null : { module: "scope", text: draft.text };
    case "entity":
      // Each correctable path is narrowed to the width of the field it
      // replaces: four digits for `founded.year`, bounded plain text for the
      // other ten. A correction the published entity cannot hold is refused
      // here, where the owner can still read why, rather than at the publish
      // button behind a 422 nothing renders.
      return draft.value.trim() === "" || geoEntityCorrectionIssue(draft.field, draft.value) !== null
        ? null
        : { module: "entity", field: draft.field, value: draft.value };
  }
}

/**
 * The rule this entity correction breaks, or null while it is fine to save.
 *
 * An empty box is not a broken rule -- it is a box nobody has filled in, and
 * `overrideOf` already refuses it. Naming the plain-text bound over an empty
 * field would state the wrong problem, so emptiness is left to say itself.
 */
function entityCorrectionIssue(draft: Draft): GeoEntityCorrectionRuleV3 | null {
  return draft.module === "entity" && draft.value.trim() !== ""
    ? geoEntityCorrectionIssue(draft.field, draft.value)
    : null;
}

function Field({ label, value, onChange, rows = 1, describedBy = null, invalid = false }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly rows?: number;
  /** The inline reason element, so the control names its own constraint. */
  readonly describedBy?: string | null;
  readonly invalid?: boolean;
}) {
  return <label className="block min-w-0 space-y-1">
    <span className="block text-[12px] text-text-dark-secondary">{label}</span>
    <textarea
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid ? true : undefined}
      {...(describedBy === null ? {} : { "aria-describedby": describedBy })}
      className="block w-full rounded-[8px] border border-brand-border-card bg-brand-bg px-3 py-2 text-[13px] leading-relaxed text-text-dark-primary"
    />
  </label>;
}

function CorrectionForm({ draft, onChange, onSave, onCancel, held, t }: {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  /** The card cannot save anything; see `decisionsHeld`. */
  readonly held: boolean;
  readonly t: ReturnType<typeof useTranslations>;
}) {
  const override = overrideOf(draft);
  const issue = entityCorrectionIssue(draft);
  const generatedId = useId();
  const issueId = issue === null ? null : `${generatedId}-correction-issue`;
  return <div data-item-correction="" className="min-w-0 space-y-3 rounded-[10px] border border-brand-border-card bg-brand-panel p-4">
    {draft.module === "facts" ? <>
      <Field label={t("review.correctionValue")} value={draft.value} onChange={(value) => onChange({ ...draft, value })} />
      <Field label={t("review.correctionStatement")} value={draft.statement} onChange={(statement) => onChange({ ...draft, statement })} rows={2} />
    </> : null}
    {draft.module === "qa" ? <Field label={t("review.correctionAnswer")} value={draft.directAnswer} onChange={(directAnswer) => onChange({ ...draft, directAnswer })} rows={3} /> : null}
    {draft.module === "comparisons" ? <>
      <Field label={t("review.correctionProduct")} value={draft.product} onChange={(product) => onChange({ ...draft, product })} />
      <Field label={t("review.correctionCompetitor")} value={draft.competitor} onChange={(competitor) => onChange({ ...draft, competitor })} />
    </> : null}
    {draft.module === "scope" ? <Field label={t("review.correctionText")} value={draft.text} onChange={(text) => onChange({ ...draft, text })} rows={2} /> : null}
    {draft.module === "entity" ? <Field
      label={t("review.correctionValue")}
      value={draft.value}
      onChange={(value) => onChange({ ...draft, value })}
      rows={2}
      invalid={issue !== null}
      describedBy={issueId}
    /> : null}
    {/* A real element, the way a blocked exclusion states its reason, and never
        a tooltip: a tooltip is invisible on touch and to a screen reader that
        never hovers, which is exactly the reader who needs this sentence. */}
    {issue === null ? null : <p
      id={issueId ?? undefined}
      data-correction-issue={issue.kind}
      className="min-w-0 text-[12px] leading-relaxed text-text-dark-secondary"
    >{issue.kind === "fourDigitYear"
      ? t("review.correctionYear")
      // One sentence for both ways a bounded text field refuses -- too long,
      // and characters it cannot carry. "Too long" alone is wrong for a pasted
      // control character, which is the case that produces no visible symptom.
      : t("review.correctionPlainText", { max: String(issue.max) })}</p>}
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        data-correction-save=""
        disabled={override === null || held}
        {...(issueId === null ? {} : { "aria-describedby": issueId })}
        onClick={onSave}
      >{t("review.correctionSave")}</Button>
      <Button type="button" size="sm" variant="outline" data-correction-cancel="" onClick={onCancel}>{t("review.correctionCancel")}</Button>
    </div>
  </div>;
}

/**
 * Nothing the owner decides from here can be saved.
 *
 * Both holds are permanent for the life of the card (see `conflictHold` /
 * `inputChangedHold` in `use-geo-kb-v3-editor.ts`), so a control that queues a
 * decision has to be dead rather than accept one and drop it. Every such
 * control asks this one function: the correction form's save was left off the
 * list when the gate was spelled out three separate times, and it spent that
 * whole time closing the form and drawing the row as the owner's own claim
 * over a queue that never flushed.
 */
function decisionsHeld(hold: GeoKbV3AutosaveHold | null): boolean {
  return hold === "conflict" || hold === "inputChanged";
}

interface RowContext {
  readonly editor: Editor;
  readonly sources: SourceIndex;
  /**
   * Item keys whose stored decision was made against text this update has since
   * rewritten. Derived on the server -- the comparison needs a digest the
   * browser cannot compute -- and recomputed by every save, so a row stops
   * saying it once the owner has looked and decided again.
   */
  readonly restated: ReadonlySet<string>;
  readonly editing: string | null;
  readonly draft: Draft | null;
  readonly open: (itemKey: string, draft: Draft) => void;
  readonly change: (draft: Draft) => void;
  readonly close: () => void;
  readonly t: ReturnType<typeof useTranslations>;
  /**
   * The same catalog the published pack renders from. Reading `t()` with an
   * interpolated path here instead would be a second vocabulary for the same
   * labels, and next-intl answers a missing key by rendering the key, so the
   * two screens could disagree without either one failing.
   */
  readonly card: GeoKbCopy;
}

function Item({ item, typeLabel, correction, required = false, context, children }: {
  readonly item: DraftProvenance;
  readonly typeLabel: string;
  /** Null when this item's module or field cannot be rewritten in place. */
  readonly correction: Draft | null;
  /** Set when excluding this item would withhold its whole section. */
  readonly required?: boolean;
  readonly context: RowContext;
  readonly children: ReactNode;
}) {
  const { editor, sources, editing, draft, open, change, close, t, restated } = context;
  const state = editor.decisionFor(item.itemKey);
  const editingThis = editing === item.itemKey && draft !== null;
  const actions: GeoKbItemActions = {
    onAccept: () => editor.accept(item.itemKey),
    onCorrect: () => { if (correction !== null) open(item.itemKey, correction); },
    onExclude: () => editor.exclude(item.itemKey),
    onRevert: () => editor.revert(item.itemKey),
    disabled: decisionsHeld(editor.autosaveHold),
    required,
  };
  return <div className="min-w-0 space-y-2">
    <GeoKbItemRow
      typeLabel={typeLabel}
      // A correction is the owner's own claim, so the row states it as one even
      // before the version that publishes it exists.
      source={state.override === null ? geoKbItemSourceOf(item, sources) : { origin: "declared_owner" }}
      decision={state.decision}
      evidenceChecks={state.override === null ? item.evidenceChecks : "owner_declared"}
      priorSource={state.override === null ? null : geoKbItemSourceOf(item, sources)}
      conflict={item.alternateObservations.length > 0}
      // Section 4.4 lets a decision stand when the same page restates the same
      // item, instead of re-asking the owner everything on every update. This
      // is the other half of that: without it the row would present an approval
      // of a sentence nobody has read, and publish it as owner-confirmed.
      newObservation={restated.has(item.itemKey)}
      actions={actions}
    >{children}</GeoKbItemRow>
    {editingThis ? <CorrectionForm
      draft={draft}
      onChange={change}
      onSave={() => { const override = overrideOf(draft); if (override !== null) { editor.correct(item.itemKey, override); close(); } }}
      onCancel={close}
      held={decisionsHeld(editor.autosaveHold)}
      t={t}
    /> : null}
  </div>;
}

function AcceptAll({ editor, itemKeys, t }: { readonly editor: Editor; readonly itemKeys: readonly string[]; readonly t: ReturnType<typeof useTranslations> }) {
  const pending = itemKeys.filter((key) => { const state = editor.decisionFor(key); return state.decision === "pending" && state.override === null; });
  if (pending.length === 0) return null;
  return <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-accept-all=""
      disabled={decisionsHeld(editor.autosaveHold)}
      onClick={() => editor.acceptAll(pending)}
    >{t("review.acceptAll", { count: pending.length })}</Button>
  </div>;
}

function Text({ children }: { readonly children: ReactNode }) {
  return <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{children}</span>;
}

function EntityModule({ knowledge, context, packCopy }: {
  readonly knowledge: GeoKnowledgeBodyV3;
  readonly context: RowContext;
  readonly packCopy: ReturnType<typeof geoKnowledgePackCopy>;
}) {
  const entity = geoKbModuleValue(knowledge.entity);
  const fields = entity?.fields ?? [];
  return <GeoKbModuleSection
    title={packCopy.sections.entity}
    state={geoKbModuleState(knowledge.entity)}
    {...REVIEWABLE}
    action={<AcceptAll editor={context.editor} itemKeys={fields.map((field) => field.itemKey)} t={context.t} />}
  >
    <div className="min-w-0 space-y-3">
      {fields.map((field) => {
        const current = context.editor.decisionFor(field.itemKey);
        const override = current.override?.module === "entity" ? current.override.value : null;
        return <Item
          key={field.itemKey}
          item={field}
          typeLabel={context.card.entityFields[field.field]}
          required={REQUIRED_ENTITY.has(field.field)}
          correction={CORRECTABLE.has(field.field)
            ? { module: "entity", field: field.field as Correctable, value: override ?? entityValue(entity!, field.field) }
            : null}
          context={context}
        ><Text>{override ?? entityValue(entity!, field.field)}</Text></Item>;
      })}
    </div>
  </GeoKbModuleSection>;
}

/**
 * The clauses the folded summary may say, and `null` for every module the run
 * never measured.
 *
 * `geoKbModuleValue` hands back `null` for an `unavailable` module, and the
 * `?? []` this replaces then turned that into a count of `0`: "Facts 0
 * (confirmed 0)" reads as we looked and found none, which is the stronger claim
 * `GeoKbPublishedSummary.counts` refuses to make about off-site sources -- made
 * here about the owner's own sections. `partial` is left countable: its numbers
 * are real, and `settled` keeps the card open for it separately, because a
 * limitation sentence has nowhere to appear in a folded summary.
 *
 * "Confirmed" counts every acceptance, however it was made. It used to count
 * one-by-one acceptances only; the Owner retired that distinction on
 * 2026-09-09, so a draft carrying the old `accepted_in_bulk` label counts here
 * too rather than reading as unconfirmed forever.
 */
function publishedCounts(knowledge: GeoKnowledgeBodyV3, states: ReadonlyMap<string, { readonly decision: string }>) {
  const facts = geoKbModuleValue(knowledge.facts);
  const qa = geoKbModuleValue(knowledge.qa);
  const comparisons = geoKbModuleValue(knowledge.comparisons);
  const rows = (comparisons ?? []).flatMap((comparison) => comparison.rows);
  return {
    facts: facts === null ? null : {
      facts: facts.length,
      accepted: facts.filter((fact) => {
        const decision = states.get(fact.itemKey)?.decision;
        return decision === "accepted" || decision === "accepted_in_bulk";
      }).length,
    },
    qa: qa === null ? null : { qa: qa.length },
    comparisons: comparisons === null ? null : {
      comparisons: rows.length,
      available: rows.filter((row) => row.availability === "available").length,
    },
  };
}
/** The reader-visible text behind one entity field, as a string. */
function entityValue(entity: Record<string, unknown>, path: string): string {
  let node: unknown = entity;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.filter((entry) => typeof entry === "string").join(" · ");
  return "";
}

function FactsModule({ knowledge, context, packCopy }: {
  readonly knowledge: GeoKnowledgeBodyV3;
  readonly context: RowContext;
  readonly packCopy: ReturnType<typeof geoKnowledgePackCopy>;
}) {
  const facts = geoKbModuleValue(knowledge.facts) ?? [];
  return <GeoKbModuleSection
    title={packCopy.sections.facts}
    state={geoKbModuleState(knowledge.facts)}
    {...REVIEWABLE}
    action={<AcceptAll editor={context.editor} itemKeys={facts.map((fact) => fact.itemKey)} t={context.t} />}
  >
    <div className="min-w-0 space-y-3">
      {facts.map((fact) => {
        const current = context.editor.decisionFor(fact.itemKey);
        const override = current.override?.module === "facts" ? current.override : null;
        return <Item
          key={fact.itemKey}
          item={fact}
          typeLabel={packCopy.factTypes[fact.type] ?? fact.type}
          correction={{ module: "facts", label: fact.label, statement: override?.statement ?? fact.statement, value: override?.value ?? fact.value ?? "" }}
          context={context}
        ><Text>{override?.statement ?? fact.statement}</Text></Item>;
      })}
    </div>
  </GeoKbModuleSection>;
}

function QaModule({ knowledge, context, packCopy }: {
  readonly knowledge: GeoKnowledgeBodyV3;
  readonly context: RowContext;
  readonly packCopy: ReturnType<typeof geoKnowledgePackCopy>;
}) {
  const items = geoKbModuleValue(knowledge.qa) ?? [];
  return <GeoKbModuleSection
    title={packCopy.sections.qa}
    state={geoKbModuleState(knowledge.qa)}
    {...REVIEWABLE}
    action={<AcceptAll editor={context.editor} itemKeys={items.map((item) => item.itemKey)} t={context.t} />}
  >
    <div className="min-w-0 space-y-3">
      {items.map((item) => {
        const current = context.editor.decisionFor(item.itemKey);
        const override = current.override?.module === "qa" ? current.override : null;
        return <Item
          key={item.itemKey}
          item={item}
          typeLabel={packCopy.intents[item.intent] ?? item.intent}
          correction={{ module: "qa", directAnswer: override?.directAnswer ?? item.directAnswer, expansion: override?.expansion ?? item.expansion }}
          context={context}
        >
          <Text>{item.question}</Text>
          <span className="mt-2 block text-text-dark-secondary"><Text>{override?.directAnswer ?? item.directAnswer}</Text></span>
        </Item>;
      })}
    </div>
  </GeoKbModuleSection>;
}

function ComparisonsModule({ knowledge, context, packCopy }: {
  readonly knowledge: GeoKnowledgeBodyV3;
  readonly context: RowContext;
  readonly packCopy: ReturnType<typeof geoKnowledgePackCopy>;
}) {
  const comparisons = geoKbModuleValue(knowledge.comparisons) ?? [];
  const rows = comparisons.flatMap((comparison) => comparison.rows);
  /*
   * The assembler writes `not_applicable` here when the narrative had no
   * comparisons and no competitor was confirmed (`comparisonsModule` in
   * `kb-knowledge-assemble.ts`): the run read no competitor page and had
   * nothing to compare. The generic sentence for the reason -- "this section
   * does not apply this time" -- is true and says nothing; the Owner asked why
   * the module was empty (2026-09-11).
   *
   * The cause is read off the locked input, not inferred from the reason
   * code, because the card renders a STORED payload and the input can have
   * moved since the body was assembled. Two sentences, one per state:
   *
   *   no rival confirmed     say so, and point at the rows above where one is
   *                          confirmed -- the gesture exists now.
   *   a rival confirmed      the body predates the confirmation (a confirm
   *                          keeps the body; see `kb-v3-competitors.ts`), so
   *                          "none is confirmed" would be a lie about that
   *                          rival (gpt-6-astra, 2026-09-11). Say when the
   *                          absence was true and that the next update reads
   *                          the rival.
   */
  const noneConfirmed = context.editor.payload.generationInput.competitors.every((competitor) => !competitor.confirmed);
  const unavailableNote = knowledge.comparisons.status === "unavailable" && knowledge.comparisons.reason === "not_applicable"
    ? { unavailableNote: context.t(noneConfirmed ? "review.comparisonsNoConfirmedCompetitors" : "review.comparisonsAwaitingUpdate") }
    : {};
  return <GeoKbModuleSection
    title={packCopy.sections.comparisons}
    state={geoKbModuleState(knowledge.comparisons)}
    {...REVIEWABLE}
    {...unavailableNote}
    action={<AcceptAll editor={context.editor} itemKeys={rows.map((row) => row.itemKey)} t={context.t} />}
  >
    <div className="min-w-0 space-y-5">
      {comparisons.map((comparison) => <div key={comparison.id} className="min-w-0 space-y-3">
        <span className="block text-[15px] font-semibold text-text-dark-primary">{comparison.competitor.name}</span>
        {comparison.rows.map((row) => {
          const current = context.editor.decisionFor(row.itemKey);
          const override = current.override?.module === "comparisons" ? current.override : null;
          return <Item
            key={row.itemKey}
            item={row}
            typeLabel={row.dimension}
            correction={{ module: "comparisons", product: override?.product ?? row.product ?? "", competitor: override?.competitor ?? row.competitor ?? "" }}
            context={context}
          >
            <Text>{packCopy.fields.product}: {override?.product ?? row.product ?? packCopy.notRecorded}</Text>
            <span className="mt-1 block"><Text>{comparison.competitor.name}: {override?.competitor ?? row.competitor ?? packCopy.notRecorded}</Text></span>
          </Item>;
        })}
      </div>)}
    </div>
  </GeoKbModuleSection>;
}

const SCOPE_GROUPS = ["does", "doesNot", "needsHuman", "misconceptions"] as const;

function ScopeModule({ knowledge, context, packCopy }: {
  readonly knowledge: GeoKnowledgeBodyV3;
  readonly context: RowContext;
  readonly packCopy: ReturnType<typeof geoKnowledgePackCopy>;
}) {
  const scope = geoKbModuleValue(knowledge.scope);
  const keys = scope === null ? [] : SCOPE_GROUPS.flatMap((group) => scope[group].map((item) => item.itemKey));
  return <GeoKbModuleSection
    title={packCopy.sections.scope}
    state={geoKbModuleState(knowledge.scope)}
    {...REVIEWABLE}
    action={<AcceptAll editor={context.editor} itemKeys={keys} t={context.t} />}
  >
    {/* One block per group, stacked, never side by side and never a flat list.
        The four groups answer four different questions -- what it does, what it
        does not, what still needs a person, what people get wrong -- and a
        group with nothing in it is a finding, not an absence to skip. Flattened
        into one list, an empty `doesNot` disappeared from the screen entirely,
        which reads as "we did not measure that" being rendered as "there is
        nothing to say". Two columns put the third and fourth questions beside
        the first and second, which reads as two pairs rather than four
        answers. The comparison module right above it stacks the same way. */}
    <div className="min-w-0 space-y-5">
      {SCOPE_GROUPS.map((group) => <GeoKbEvidenceGroup
        key={group}
        title={packCopy.scopeGroups[group] ?? group}
        collected
        count={scope === null ? 0 : scope[group].length}
      >
        <div className="min-w-0 space-y-3">{(scope === null ? [] : scope[group]).map((item) => {
          const current = context.editor.decisionFor(item.itemKey);
          const override = current.override?.module === "scope" ? current.override.text : null;
          return <Item
            key={item.itemKey}
            item={item}
            typeLabel={packCopy.scopeGroups[group] ?? group}
            correction={{ module: "scope", text: override ?? item.text }}
            context={context}
          ><Text>{override ?? item.text}</Text></Item>;
        })}</div>
      </GeoKbEvidenceGroup>)}
    </div>
  </GeoKbModuleSection>;
}

/* ---------------------------------------------------------------------------
 * The update run
 *
 * `driveGeoKbRun` is the tab's half of a protocol whose whole point is that one
 * HTTP call advances one operation: a single long request is how a platform
 * timeout turns a charge into something with no record of where it landed. So
 * the card owns the loop, and it owns the two things a person needs from it --
 * a way to start one, and a way to continue one that stopped.
 *
 * Everything drawn below is read back from what the server reported about its
 * own ledger. Nothing here decides, or claims to know, what an update is able
 * to do: an operation this deployment has no producer for comes back
 * `failed_permanent` with reason `unsupported`, and it is drawn as exactly
 * that -- never as running, and never as done.
 * ------------------------------------------------------------------------- */

type GeoKbRunPhase = "idle" | "checking" | "driving";

type RunStatusKey =
  | "checking" | "driving" | "complete" | "finished" | "blocked"
  | "runActive" | "failed" | "stalled" | "aborted" | "unknown";

/**
 * `busy` and `blocked` share a sentence on purpose: to the owner they are the
 * same fact -- something else holds this work, come back to it -- and the
 * difference between "another invocation holds the run" and "another executor
 * holds every remaining operation" is not a difference they can act on.
 */
const RUN_STATUS: Readonly<Record<string, RunStatusKey>> = {
  complete: "complete",
  finished: "finished",
  blocked: "blocked",
  busy: "blocked",
  run_active: "runActive",
  failed: "failed",
  stalled: "stalled",
};

/**
 * Written out rather than interpolated into `t()`. next-intl answers a missing
 * key by rendering the key path, so an interpolated `run.${key}` would put a
 * dotted path on the customer's screen and pass every test that only checks
 * that "something appeared".
 */
function runStatusText(key: RunStatusKey, t: ReturnType<typeof useTranslations>): string {
  switch (key) {
    case "checking": return t("run.checking");
    case "driving": return t("run.driving");
    case "complete": return t("run.complete");
    case "finished": return t("run.finished");
    case "blocked": return t("run.blocked");
    case "runActive": return t("run.runActive");
    case "failed": return t("run.failed");
    case "stalled": return t("run.stalled");
    case "aborted": return t("run.aborted");
    case "unknown": return t("run.unknown");
  }
}

/**
 * Why a stopped update needs two sentences instead of one.
 *
 * The first says what happened, and it depends on how the call was refused: an
 * expired sign-in is not the same event as a server nothing could reach, and
 * one sentence for both sends the owner to press a button that answers 401
 * forever.
 *
 * The second says what to do next, and it is decided by the same fact that
 * decides whether the Continue button is drawn at all -- whether this page
 * holds a run id. A first call that never came back with one leaves nothing to
 * continue, so nothing may offer to continue it, in a button or in a sentence.
 */
type RunFailureKey = "auth" | "offline" | "unavailable" | "refused" | "unreadable" | "stopped";

/**
 * The route's own error codes, plus the two the fetch wrapper invents. A code
 * this table does not name falls back to the sentence that claims the least.
 */
const RUN_FAILURE: Readonly<Record<string, RunFailureKey>> = {
  auth_required: "auth",
  auth_unavailable: "unavailable",
  store_unavailable: "unavailable",
  network: "offline",
  cross_origin: "refused",
  invalid_request: "refused",
  invalid_input: "refused",
  not_found: "refused",
  payload_too_large: "refused",
  unsupported_media_type: "refused",
  bad_response: "unreadable",
};

/** Written out for the same reason `runStatusText` is: a missing key renders as its path. */
function runFailureText(key: RunFailureKey, t: ReturnType<typeof useTranslations>): string {
  switch (key) {
    case "auth": return t("run.failedAuth");
    case "offline": return t("run.failedOffline");
    case "unavailable": return t("run.failedUnavailable");
    case "refused": return t("run.failedRefused");
    case "unreadable": return t("run.failedUnreadable");
    case "stopped": return t("run.failed");
  }
}

function runNextText(
  failure: RunFailureKey | null,
  canContinue: boolean,
  t: ReturnType<typeof useTranslations>,
): string {
  if (failure === "auth") return canContinue ? t("run.nextSignInContinue") : t("run.nextSignIn");
  return canContinue ? t("run.nextContinue") : t("run.nextReload");
}

/** Statuses that leave a run open, and therefore owe the owner a next step. */
const RUN_OPEN: ReadonlySet<string> = new Set<RunStatusKey>(["failed", "stalled", "aborted", "runActive"]);

/**
 * The operations of one run, counted by what their ledger row says.
 *
 * `unsupported` is kept apart from `failed` because it is a statement about
 * this deployment rather than about this run: the operation was never sent, so
 * nothing was spent and retrying would not help. Folding it into "could not be
 * completed" would invite exactly the retry the executor exists to refuse.
 *
 * `dispatched` counts as an unknown outcome, not as work in flight. The row was
 * marked before the request left, so it may already have been billed; that is
 * the one thing about a run worth saying out loud.
 *
 * `chargeUnresolved` is the third thing, and it is neither of the other two: a
 * `failed_permanent` row whose *reason* is `outcome_unknown`. That is not the
 * state of the same name -- the line above already catches that one, and a row
 * still in it is going to be probed again. This pair is what
 * `kb-run-advance.ts` writes when the probe budget runs out: the run stopped
 * trying to find out what happened, and the charge behind it stays unresolved
 * for good. Counted as `failed` it reads "the step could not be completed",
 * which an owner hears as "nothing happened" over the one row whose whole
 * point is that something may have been paid for and its result lost.
 *
 * What the sentence for it may not say is that the operation *was* sent. The
 * ledger's probe RPC also accepts this write for an expired claim, and a
 * claimed row provably dispatched nothing, so the only claim that holds over
 * every row landing here is the conservative one: it may already have been
 * charged, and nobody will ever know.
 */
interface RunTally {
  readonly done: number;
  readonly outstanding: number;
  readonly unknownOutcome: number;
  readonly unsupported: number;
  readonly chargeUnresolved: number;
  readonly failed: number;
}

function runTally(operations: readonly GeoKbRunOperationView[]): RunTally {
  let done = 0, outstanding = 0, unknownOutcome = 0, unsupported = 0, chargeUnresolved = 0, failed = 0;
  for (const operation of operations) {
    if (operation.state === "succeeded") done += 1;
    else if (operation.state === "dispatched" || operation.state === "outcome_unknown") unknownOutcome += 1;
    else if (operation.state !== "failed_permanent") outstanding += 1;
    else if (operation.reason === "unsupported") unsupported += 1;
    else if (operation.reason === "outcome_unknown") chargeUnresolved += 1;
    else failed += 1;
  }
  return { done, outstanding, unknownOutcome, unsupported, chargeUnresolved, failed };
}

function RunPanel({ phase, run, resume, recovering, busyStreak, onContinue, onReload, t }: {
  readonly phase: GeoKbRunPhase;
  readonly run: GeoKbRunView | null;
  /** A run this knowledge base still has open, from the free read on load. */
  readonly resume: { readonly runId: string; readonly operations: readonly GeoKbRunOperationView[] } | null;
  /**
   * A rebuild or a discard is in flight.
   *
   * The three gestures share one latch, held in a ref, so `drive` refuses
   * while either of the other two is running -- and a ref cannot be rendered.
   * This is the latch's render-observable image: without it the Continue
   * button stayed live through a rebuild and a press produced nothing at all.
   * The reason is the recovery panel's own working line, which is on screen
   * for exactly as long as this is true.
   */
  readonly recovering: boolean;
  /**
   * The drive loop has been answered `busy` this many times in a row.
   *
   * The loop keeps retrying either way, and it must: a `busy` answer means a
   * run lease is still held, the lease expires on its own, and the next call
   * after it does claims the run and carries on with no gesture from anyone.
   * Shortening that wait would trade an update that heals itself for a button
   * somebody has to find. So this changes what the line SAYS, never how long
   * the loop runs.
   *
   * A streak rather than a single answer, because one `busy` mid-run is
   * ordinary -- a hand-off between invocations -- and flipping the live line
   * to "try again shortly" for three seconds would tell the owner to retry by
   * hand while the tab is already retrying.
   */
  readonly busyStreak: number;
  readonly onContinue: () => void;
  /** Redraw from the server; see `reloadThisPage`. */
  readonly onReload: () => void;
  readonly t: ReturnType<typeof useTranslations>;
}) {
  // A sustained refusal outranks the phase. `phase` describes what this tab is
  // doing (still driving, which stays true); the run line describes what the
  // server answered, and answering "Updating…" to a run nothing can advance
  // right now is the phase standing in for news it does not have.
  const status: RunStatusKey | null = phase === "driving" && run !== null && run.status === "busy" && busyStreak >= GEO_KB_RUN_BUSY_VOICE
    ? "blocked"
    : phase === "checking"
    ? "checking"
    : phase === "driving"
      ? "driving"
      : run === null
        ? null
        : run.errorCode === "aborted"
          ? "aborted"
          : RUN_STATUS[run.status] ?? "unknown";
  const tally = run !== null ? runTally(run.operations) : resume !== null ? runTally(resume.operations) : null;
  /**
   * `remaining` arrives as a decimal string and reads as NaN when it could not
   * be parsed. It is never rendered as 0: an unknown count shown as zero says
   * the update has nothing left to do, which is the one thing it does not know.
   */
  const remaining = run !== null && Number.isFinite(run.remaining) && run.remaining > 0 ? run.remaining : null;
  const remainingUnknown = run !== null && !Number.isFinite(run.remaining);
  const failure: RunFailureKey | null = status === "failed"
    ? RUN_FAILURE[run?.errorCode ?? ""] ?? "stopped"
    : null;
  // `resume !== null` is the one fact behind both the sentence and the button.
  const next = status !== null && RUN_OPEN.has(status) ? runNextText(failure, resume !== null, t) : null;
  const parts = tally === null ? [] : [
    ...(tally.done > 0 ? [t("run.done", { count: tally.done })] : []),
    ...(tally.outstanding > 0 ? [t("run.outstanding", { count: tally.outstanding })] : []),
    ...(tally.unknownOutcome > 0 ? [t("run.unknownOutcome", { count: tally.unknownOutcome })] : []),
    ...(tally.failed > 0 ? [t("run.failedOps", { count: tally.failed })] : []),
  ];
  if (status === null && resume === null) return null;
  return <div data-run-panel="" className="min-w-0 space-y-2">
    {status === null ? null : <span data-run-status={status} role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {failure === null ? runStatusText(status, t) : runFailureText(failure, t)}
    </span>}
    {status === null && resume !== null ? <span data-run-status="resumable" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {t("run.resumable")}
    </span> : null}
    {parts.length === 0 ? null : <span data-run-counts="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
      {parts.join(" · ")}
    </span>}
    {remaining === null ? null : <span data-run-remaining="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
      {t("run.remaining", { count: remaining })}
    </span>}
    {remainingUnknown ? <span data-run-remaining-unknown="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
      {t("run.remainingUnknown")}
    </span> : null}
    {tally === null || tally.chargeUnresolved === 0 ? null : <span data-run-charge-unresolved="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
      {t("run.chargeUnresolved", { count: tally.chargeUnresolved })}
    </span>}
    {tally === null || tally.unsupported === 0 ? null : <span data-run-unsupported="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
      {t("run.unsupported", { count: tally.unsupported })}
    </span>}
    {/* An update writes to the stored draft; this card is holding the one it
        was handed. Saying so is the difference between "nothing happened" and
        "you are looking at the version from before". It never says published:
        publishing is the separate free action below.

        Gated on a run id rather than on "a call came back": a first call that
        was refused before a run existed wrote nothing, and pointing that owner
        at a reload implies something is waiting there for them. */}
    {run === null || run.runId === null || phase !== "idle" ? null : <div className="min-w-0 space-y-1">
      <span data-run-reload="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
        {t("run.notReloaded")}
      </span>
      {/* The sentence asks for a reload, so the reload is here. Without it the
          owner reads "you are looking at the version from before" and carries
          on deciding on that version -- every one of those decisions is then
          refused as stale, which is the dead card this button exists to
          prevent. */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" data-kb-reload="" onClick={onReload}>{t("recovery.reload")}</Button>
      </div>
    </div>}
    {next === null ? null : <span data-run-next="" className="block text-[12px] leading-relaxed text-text-dark-secondary">
      {next}
    </span>}
    {resume === null ? null : <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" data-run-continue="" disabled={phase !== "idle" || recovering} onClick={onContinue}>
        {t("run.continue")}
      </Button>
    </div>}
  </div>;
}

/* ---------------------------------------------------------------------------
 * Getting unstuck
 *
 * Two states leave a v3 knowledge base with no way forward from the browser,
 * and both of them are reached by an ordinary owner doing an ordinary thing.
 *
 *  - **A Profile revision confirmed after the draft was locked.** The database
 *    requires the draft's `profileRef` to name the *current* confirmed snapshot
 *    (`marketing_geo_generation_input_current`), so every knowledge claim the
 *    update makes is refused `input_stale`. `kb-run-runtime.ts` files a 409 as
 *    retryable, `planGeoRun` re-starts a retryable operation with no attempt
 *    cap, the run never rests, its row stays `running`, and
 *    `marketing_geo_kb_run_single_active_idx` then refuses every future run
 *    while the resume it produces disables the Update button. Nothing about
 *    that resolves with time.
 *  - **A confirmed Profile with no categories.** `categories` is not in
 *    `REQUIRED_PROFILE_FIELDS`, so the Profile confirms, the draft is created,
 *    and the billed update can never build its input --
 *    `buildGeoKnowledgeSynthesisInputV2` requires at least one category term.
 *
 * The two exits below are the server's own, and both were already built and
 * proved (`kb-v3-relock.integration.test.ts`, `kb-run-ledger.integration.test.ts`)
 * with no client sending either request. What is decided here is only *when*
 * they are offered and *what the owner is told before pressing*:
 *
 *  - Both are gestures, never automatic. A re-lock destroys the knowledge a run
 *    was paid for; the route demands the digest of the exact draft being
 *    discarded precisely so that only a caller who was shown that draft can ask
 *    for it. And this page cannot detect a stale input to trigger on -- the
 *    ledger's reason vocabulary has no member for `input_stale`, so it arrives
 *    indistinguishable from an outage, and an automatic trigger would fire on
 *    every stalled update and destroy paid work over a transient 503.
 *  - The re-lock is offered first and clears the pinned run only when it
 *    actually rebuilt something. Asking when nothing moved is free -- the route
 *    answers `relocked: false` before building or writing anything -- so the
 *    gesture needs no diagnosis to be safe, and the answer is what tells the
 *    owner which world they were in. Dropping the run *first* would forfeit its
 *    key over a draft that turned out to be current.
 *  - Discarding the run is its own gesture, because a stalled update that was
 *    never stale still has to be droppable, and because it costs something a
 *    re-lock does not: the next update starts over.
 * ------------------------------------------------------------------------- */

type GeoKbV3Discarded = Extract<GeoKbV3Relocked, { readonly relocked: true }>["discarded"];

/** What became of the run that was pinned when a re-lock rebuilt the draft. */
type GeoKbRunClearOutcome = "none" | "cleared" | "busy" | "failed";

type GeoKbRecoveryState =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly gesture: "rebuild" | "discard" }
  /** The re-lock found the draft already current: nothing written, nothing lost. */
  | { readonly kind: "current" }
  | { readonly kind: "rebuilt"; readonly discarded: GeoKbV3Discarded; readonly cleared: GeoKbRunClearOutcome }
  | { readonly kind: "rebuildFailed"; readonly code: string }
  | { readonly kind: "discarded"; readonly gone: boolean }
  | { readonly kind: "discardBusy" }
  | { readonly kind: "discardFailed" };

/**
 * Which sentence a refused re-lock gets, chosen by what the route proves.
 *
 * Everything in this table is a refusal the route makes *before* it writes:
 * the quota check, the ownership and version checks, the running-generation
 * guard and the Profile read all precede `saveDraft`, and a `conflict` from
 * the store is a compare-and-swap that did not land. Those sentences may
 * therefore say "nothing was changed". Every code not listed falls through to
 * `unknown`, which says the opposite -- that this page cannot tell -- because
 * one of them (`store_unavailable`) is also what a *successful* write answers
 * when the digest the store returned is not ours, and a `network` failure
 * cannot distinguish a request that never left from a reply that was lost.
 */
type RelockFailureKey = "auth" | "limited" | "stale" | "running" | "profile" | "unknown";

const RELOCK_FAILURE: Readonly<Record<string, RelockFailureKey>> = {
  auth_required: "auth",
  rate_limited: "limited",
  conflict: "stale",
  legacy_draft: "stale",
  generation_running: "running",
  profile_not_confirmed: "profile",
  profile_unusable: "profile",
};

/** Written out for the same reason `runStatusText` is: a missing key renders as its path. */
function relockFailureText(key: RelockFailureKey, t: ReturnType<typeof useTranslations>): string {
  switch (key) {
    case "auth": return t("recovery.rebuildFailedAuth");
    case "limited": return t("recovery.rebuildFailedLimited");
    case "stale": return t("recovery.rebuildFailedStale");
    case "running": return t("recovery.rebuildFailedRunning");
    case "profile": return t("recovery.rebuildFailedProfile");
    case "unknown": return t("recovery.rebuildFailedUnknown");
  }
}

/**
 * The reason an update cannot run, in the owner's words.
 *
 * The sentences are the ones the v1 card already shows for the same two
 * blockers (`tools.geoKnowledgeBase.freeze.blockers`), read through an
 * exhaustive switch rather than by interpolating the blocker into `t()`: a
 * blocker this build has no key for would otherwise print its own name on the
 * customer's screen and satisfy every test that only checks that something
 * appeared.
 */
function blockerText(blocker: GeoKbV3Blocker, t: ReturnType<typeof useTranslations>): string {
  switch (blocker) {
    case "category_terms_missing": return t("category_terms_missing");
  }
}

/**
 * Why both recovery gestures are held right now, or `null` when neither is.
 *
 * One value, derived once, drives three things that used to be written three
 * times: whether the buttons are disabled, the sentence that says why, and the
 * early return in each handler. They cannot drift apart, which is the bug this
 * replaces -- both handlers returned on `runPhase !== "idle"` while both
 * buttons were `disabled={working}` alone, so a press during either window
 * produced no request, no message and no reason.
 */
type GeoKbRecoveryHold = "checking" | "driving" | "saving";

/** Written out for the same reason `runStatusText` is: a missing key renders as its path. */
function recoveryHoldText(hold: GeoKbRecoveryHold, t: ReturnType<typeof useTranslations>): string {
  switch (hold) {
    case "checking": return t("run.checking");
    case "driving": return t("run.driving");
    case "saving": return t("review.saving");
  }
}

function RecoveryPanel({ blockers, openRun, hold, state, onRebuild, onDiscard, onReload, t }: {
  readonly blockers: readonly GeoKbV3Blocker[];
  /**
   * This knowledge base has a run the server called `resumable`.
   *
   * That is the whole of what is known: `kb-run-handler.ts` answers
   * `resumable` for any row in state `running`, including one another tab is
   * driving this second. It is emphatically not "nothing is driving it" -- the
   * sentence rendered under it still says that, and `recovery.stuck` is copy
   * this file does not own. The destructive remedy is server-guarded
   * (`abandon` answers `run_busy` under a live lease), so the overclaim is
   * confined to the sentence.
   */
  readonly openRun: boolean;
  /** Held gestures, and the reason. See `GeoKbRecoveryHold`. */
  readonly hold: GeoKbRecoveryHold | null;
  readonly state: GeoKbRecoveryState;
  readonly onRebuild: () => void;
  readonly onDiscard: () => void;
  readonly onReload: () => void;
  readonly t: ReturnType<typeof useTranslations>;
}) {
  const blockerCopy = useTranslations("tools.geoKnowledgeBase.freeze.blockers");
  const working = state.kind === "working";
  const rebuilt = state.kind === "rebuilt";
  // A button the owner can press either works or says why it cannot. `working`
  // has its own sentence below; `hold` gets one beside the buttons.
  const held = working || hold !== null;
  if (blockers.length === 0 && !openRun && state.kind === "idle") return null;
  const discarded = rebuilt ? state.discarded : null;
  // Decisions and suppressions are counted together because they are one thing
  // to the owner -- what they recorded about individual items -- and because
  // nothing on this screen renders a suppression under a name of its own, so
  // giving it one here would invent a word for something never shown.
  const reviewLost = discarded === null ? 0 : discarded.decisions + discarded.suppressions;
  const lostNothing = discarded !== null && !discarded.knowledge && reviewLost === 0 && discarded.roles === 0;
  return <div data-kb-recovery="" className="min-w-0 space-y-3 rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3">
    {/* Dropped once a re-lock has landed: this list was read off the draft that
        was just replaced, so "add at least one category word" over a rebuild
        the owner made *after* adding one would be a stale instruction. What
        the rebuilt draft blocks on, if anything, is on the reload. */}
    {blockers.length === 0 || rebuilt ? null : <div data-kb-blockers="" className="min-w-0 space-y-1">
      <span className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.blockedTitle")}</span>
      <ul className="list-disc space-y-1 pl-5">
        {blockers.map((blocker) => <li key={blocker} data-kb-blocker={blocker} className="text-[13px] leading-relaxed text-text-dark-secondary">
          {blockerText(blocker, blockerCopy)}
        </li>)}
      </ul>
      <span data-kb-blocked-note="" className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.blockedNote")}</span>
    </div>}
    {/* Said whenever a run is pinned, and deliberately conditional: this page
        cannot tell a stale input from an outage, so it names the cause it
        cannot rule out rather than asserting either one. */}
    {openRun ? <span data-kb-stuck="" className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.stuck")}</span> : null}

    {rebuilt ? null : <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" data-kb-rebuild="" disabled={held} onClick={onRebuild}>
          {t("recovery.rebuild")}
        </Button>
        {openRun ? <Button type="button" variant="outline" size="sm" data-kb-discard-run="" disabled={held} onClick={onDiscard}>
          {t("recovery.discard")}
        </Button> : null}
      </div>
      {/* Not `role="status"`: the run panel above announces the same fact
          live, and this is the static reason a disabled control carries. */}
      {hold === null ? null : <span data-kb-recovery-hold={hold} className="block text-[12px] leading-relaxed text-text-dark-secondary">
        {recoveryHoldText(hold, t)}
      </span>}
      <span data-kb-rebuild-note="" className="block text-[12px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildNote")}</span>
      {openRun ? <span data-kb-discard-note="" className="block text-[12px] leading-relaxed text-text-dark-secondary">{t("recovery.discardNote")}</span> : null}
    </div>}

    {!working ? null : <span data-kb-recovery-status="working" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {state.gesture === "rebuild" ? t("recovery.rebuildWorking") : t("recovery.discardWorking")}
    </span>}
    {state.kind !== "current" ? null : <span data-kb-recovery-status="current" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {t("recovery.rebuildCurrent")}
    </span>}
    {state.kind !== "rebuildFailed" ? null : <span data-kb-recovery-status="rebuildFailed" role="alert" className="block text-[13px] leading-relaxed text-brand-error">
      {relockFailureText(RELOCK_FAILURE[state.code] ?? "unknown", t)}
    </span>}
    {state.kind !== "discarded" ? null : <span data-kb-recovery-status="discarded" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {state.gone ? t("recovery.discardGone") : t("recovery.discardDone")}
    </span>}
    {state.kind !== "discardBusy" ? null : <span data-kb-recovery-status="discardBusy" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {t("recovery.discardBusy")}
    </span>}
    {state.kind !== "discardFailed" ? null : <span data-kb-recovery-status="discardFailed" role="alert" className="block text-[13px] leading-relaxed text-brand-error">
      {t("recovery.discardFailed")}
    </span>}

    {!rebuilt ? null : <div data-kb-recovery-status="rebuilt" role="status" className="min-w-0 space-y-1">
      <span className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildDone")}</span>
      {/* What it cost, item by item, so that "you will be charged for this
          knowledge again" is on the screen rather than in a release note.
          `discarded.released` is not among them: it names which run reference
          ids were freed, which is plumbing the owner never saw. */}
      {discarded?.knowledge === true ? <span data-kb-discarded="knowledge" className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildDiscardedKnowledge")}</span> : null}
      {reviewLost === 0 ? null : <span data-kb-discarded="review" className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildDiscardedReview", { count: reviewLost })}</span>}
      {discarded === null || discarded.roles === 0 ? null : <span data-kb-discarded="roles" className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildDiscardedRoles", { count: discarded.roles })}</span>}
      {!lostNothing ? null : <span data-kb-discarded="none" className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildKeptAll")}</span>}
      {state.cleared === "none" ? null : <span data-kb-run-cleared={state.cleared} className="block text-[13px] leading-relaxed text-text-dark-secondary">
        {state.cleared === "cleared" ? t("recovery.rebuildCleared") : state.cleared === "busy" ? t("recovery.rebuildClearBusy") : t("recovery.rebuildClearFailed")}
      </span>}
      <span className="block text-[13px] leading-relaxed text-text-dark-secondary">{t("recovery.rebuildReload")}</span>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" data-kb-reload="" onClick={onReload}>{t("recovery.reload")}</Button>
      </div>
    </div>}
  </div>;
}

/**
 * Redraw everything from the server.
 *
 * A whole-page reload rather than a refetch, because this component is handed
 * its draft as a prop and has no way to ask for a newer one; `gsc-disconnect.tsx`
 * reloads for the same reason. `onReload` is the seam: the website GEO editor
 * that renders this card already holds a `reload` that refetches just this
 * card, and passing it through would make this a redraw rather than a
 * navigation.
 */
function reloadThisPage(): void {
  window.location.reload();
}

/**
 * How long the free "is a run still open?" read may take before the card stops
 * waiting on it.
 *
 * Exported so the test that proves the deadline names the same number the
 * component does rather than a copy of it. It is a ceiling on a wait, not a
 * cap on a value, so a test may drive the clock past it without asserting
 * anything derived from it.
 */
export const GEO_KB_RUN_CHECK_MS = 15_000;
/**
 * Consecutive `busy` answers before the run line stops saying "Updating…".
 *
 * Five answers is about fifteen seconds at the loop's own backoff -- long
 * enough that an ordinary hand-off between invocations never reaches it, short
 * enough that nobody watches a false word for a minute. It bounds NOTHING: the
 * loop's length is set by `maxCalls`, and the lease it is waiting out expires
 * on its own.
 */
export const GEO_KB_RUN_BUSY_VOICE = 5;

/**
 * The key one update gesture is remembered by, so a second press resumes the
 * run the first one opened instead of opening a second run over the same site.
 * It is dropped once the run closes: a closed run's key can only ever be
 * answered `finished`.
 */
function geoKbRunKey(): string {
  const source: { readonly randomUUID?: () => string } | undefined = globalThis.crypto;
  return source?.randomUUID?.() ?? `kb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function Note({ children }: { readonly children: ReactNode }) {
  return <div
    data-knowledge-copy="compact"
    className="min-w-0 whitespace-pre-wrap break-words rounded-[10px] border border-brand-border-card bg-brand-bg px-4 py-3 text-[13px] leading-relaxed text-text-dark-secondary [overflow-wrap:anywhere]"
  >{children}</div>;
}

export interface GeoKnowledgeBaseV3Props {
  readonly view: GeoKbEditorViewV3;
  readonly locale: string;
  readonly inline?: boolean;
  /**
   * The Profile revision confirmed right now, which the locked generation input
   * is compared against.
   *
   * Section 12 says the two are never synced automatically: confirming a new
   * Profile revision changes nothing about a published knowledge base. What it
   * does do is make an update worth running, and this is how the card knows to
   * say so. Optional because a caller that does not know the current revision
   * must say nothing rather than guess -- an absent number is not a match.
   */
  readonly confirmedProfileRevision?: number;
  /**
   * An override for the update gesture.
   *
   * The card now drives the run route itself, so this is no longer what makes
   * the button work -- it is the seam left for a parent that owns the gesture
   * for some other reason. When it is absent, which is every caller today, the
   * button starts a run here.
   */
  readonly onUpdate?: () => void;
  /**
   * Redraw this knowledge base from the server.
   *
   * Used after a re-lock, which replaces the stored draft: the card is then
   * holding knowledge the server has discarded, and showing it as current is
   * the one thing this surface must not do. Absent for every caller today, so
   * the default is a whole-page reload -- see `reloadThisPage`.
   */
  readonly onReload?: () => void;
}

export function GeoKnowledgeBaseV3({ view, locale, inline = false, confirmedProfileRevision, onUpdate, onReload }: GeoKnowledgeBaseV3Props) {
  const editor = useGeoKbV3Editor({ initialView: view });
  const copy = useGeoKbCopy();
  const t = useTranslations("tools.geoKnowledgeBase.card");
  const packCopy = geoKnowledgePackCopy(locale);
  const [editing, setEditing] = useState<{ readonly itemKey: string; readonly draft: Draft } | null>(null);
  const [runPhase, setRunPhase] = useState<GeoKbRunPhase>("idle");
  const [runView, setRunView] = useState<GeoKbRunView | null>(null);
  /**
   * How many times in a row the server has answered `busy`.
   *
   * Kept in both a ref and state on purpose: the ref is what `onView` reads and
   * writes without waiting for a render, and the state is the render-observable
   * image the run line needs. Only the wording depends on it.
   */
  const [busyStreak, setBusyStreak] = useState(0);
  const [resume, setResume] = useState<{ readonly runId: string; readonly operations: readonly GeoKbRunOperationView[] } | null>(null);
  /** Held across gestures: the run to continue, and the key that opened it. */
  const runId = useRef<string | null>(null);
  const runKey = useRef<string | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  const busyStreakRef = useRef(0);
  const [recovery, setRecovery] = useState<GeoKbRecoveryState>({ kind: "idle" });
  /**
   * One server-changing gesture at a time, in a ref rather than in `runPhase`
   * or `recovery`.
   *
   * Two clicks inside one task run the same handler closure, so a guard that
   * reads this render's state still reads "idle" in the second one -- the
   * re-render that would have disabled the button has not happened yet.
   * Measured on the start card next door: with a state guard in place, two
   * `click()` calls in one `act` sent two create requests. Here the three
   * gestures are mutually exclusive anyway -- driving a run, rebuilding the
   * draft under it, and dropping it -- so one latch covers all three.
   */
  const gesture = useRef(false);
  const kbId = view.kbId;
  /**
   * Why the two recovery gestures are held, or `null` when neither is.
   *
   * Derived once and read by three places -- both handlers' early return and
   * the panel's `disabled` -- so the gate the owner sees and the gate the
   * handler applies are the same expression. When they were written twice they
   * disagreed: the buttons were disabled only while a recovery request was in
   * flight, and a press during the mount check or during a driving run ran a
   * handler that returned before doing anything at all.
   *
   * `editor.busy` is in here because `rebuild` already refused during a save
   * or a publish, silently. Discarding a run touches nothing the editor
   * writes, so holding it too is stricter than it has to be -- it is the same
   * one-gesture-at-a-time rule the `gesture` latch states, and being told to
   * wait for a save is cheaper than a button that does nothing.
   */
  const recoveryHold: GeoKbRecoveryHold | null = runPhase === "checking"
    ? "checking"
    : runPhase === "driving"
      ? "driving"
      : editor.busy ? "saving" : null;

  useEffect(() => {
    let live = true;
    setRunPhase("checking");
    // `defaultGeoKbRunPost` passes no `AbortSignal` and `fetch` has no deadline
    // of its own, so without this a read that never answers would leave the
    // card in `checking` for the life of the tab -- and with it both recovery
    // gestures held, under a sentence with an ellipsis promising an answer
    // that is not coming. Giving up says only what a refused read already
    // says: this page does not know of a run to continue. The run route still
    // refuses a second run on its own, so the worst outcome is a wrong
    // sentence, never a second charge.
    const timer = setTimeout(() => { if (live) releaseCheck(); }, GEO_KB_RUN_CHECK_MS);
    void (async () => {
      // Free: it asks what run, if any, this knowledge base can continue. A
      // read that cannot answer leaves the affordance hidden rather than
      // guessing -- the run route refuses a second run on its own, so a wrong
      // guess here would only ever be a wrong sentence on the screen.
      const state = await readGeoKbRunState(kbId);
      if (!live) return;
      clearTimeout(timer);
      releaseCheck();
      if (state.status !== "resumable" || state.runId === null) return;
      // A read that answers after the deadline describes the world before
      // whatever the owner started in the meantime. The run this tab opened is
      // the newer fact, and overwriting its id here would point the next
      // continuation at the wrong run.
      if (runId.current !== null || runKey.current !== null) return;
      runId.current = state.runId;
      setResume({ runId: state.runId, operations: state.operations });
    })();
    return () => { live = false; clearTimeout(timer); };
  }, [kbId]);

  /**
   * Leave `checking`, and only `checking`.
   *
   * A plain `setRunPhase("idle")` would also cancel a drive: after the
   * deadline above hands the card back, the owner can press Update, and the
   * late read then landing would report the run as idle while its loop is
   * still calling.
   */
  function releaseCheck(): void {
    setRunPhase((current) => (current === "checking" ? "idle" : current));
  }

  // The loop survives this card only as long as the tab is showing it.
  useEffect(() => () => runAbort.current?.abort(), []);

  async function drive(continueExisting: boolean): Promise<void> {
    if (gesture.current || runPhase !== "idle") return;
    if (continueExisting && runId.current === null) return;
    gesture.current = true;
    try {
      await driveOnce();
    } finally {
      gesture.current = false;
    }
  }

  /**
   * The loop itself. Whether this is a start or a continuation is already
   * settled by `runId.current`, which `drive` checked above, so nothing below
   * needs to be told again.
   */
  async function driveOnce(): Promise<void> {
    const controller = new AbortController();
    runAbort.current = controller;
    busyStreakRef.current = 0;
    setBusyStreak(0);
    // Defensive, and deliberately not covered by a test: with the streak reset
    // on the line above, `phase` outranks the view again for every state this
    // component can currently reach, so a stale view cannot be seen. It is here
    // because the thing that hides it is a precedence rule two lines of code
    // away, and the next state that lets a view outrank the phase would put the
    // previous press's answer on screen as this press's.
    setRunView(null);
    setRunPhase("driving");
    // An open run is always resumed, never restarted: the server answers a
    // second run over the same site with `run_active`, and asking for one is
    // how a gesture turns into two ledgers.
    if (runId.current === null && runKey.current === null) runKey.current = geoKbRunKey();
    const result = await driveGeoKbRun(
      runId.current === null ? { kbId, idempotencyKey: runKey.current } : { kbId, runId: runId.current },
      {
        signal: controller.signal,
        onView: (next) => {
          if (controller.signal.aborted) return;
          runId.current = next.runId ?? runId.current;
          busyStreakRef.current = next.status === "busy" ? busyStreakRef.current + 1 : 0;
          setBusyStreak(busyStreakRef.current);
          setRunView(next);
        },
      },
    );
    if (controller.signal.aborted) return;
    runAbort.current = null;
    runId.current = result.runId ?? runId.current;
    busyStreakRef.current = result.status === "busy" ? busyStreakRef.current + 1 : 0;
    setBusyStreak(busyStreakRef.current);
    setRunView(result);
    setRunPhase("idle");
    if (result.status === "complete" || result.status === "finished") {
      runId.current = null;
      runKey.current = null;
      setResume(null);
      return;
    }
    // Anything else left the run open. Keeping the id is what turns the next
    // press into a continuation rather than a second charge.
    if (runId.current !== null) setResume({ runId: runId.current, operations: result.operations });
  }

  /** Forget the run this tab was holding, once the server says it holds nothing. */
  function forgetRun(): void {
    runId.current = null;
    runKey.current = null;
    busyStreakRef.current = 0;
    setBusyStreak(0);
    setResume(null);
    setRunView(null);
  }

  /**
   * Rebuild the draft's locked input from the confirmed Profile, and clear the
   * pinned run only if that actually rebuilt something.
   *
   * The order is the point. A re-lock over a draft that is already current
   * writes nothing and mints no version, so asking costs the owner nothing; a
   * run dropped first would forfeit its key -- and with it the knowledge step
   * the next update has to buy again -- over a draft that turned out to be
   * fine. Once the input *has* moved, the pinned run is bound to a generation
   * input that no longer exists (`bindGenerationInput` answers `conflict` and
   * the operation fails permanently), so dropping it forfeits nothing that
   * could still have been used.
   *
   * The `recoveryHold` half of the guard below is the same expression the
   * button's `disabled` is computed from, so it cannot be reached through the
   * DOM and removing it alone leaves the suite green -- measured. It stays as
   * the guard for any caller that is not a click: React refuses to fire
   * `onClick` on a disabled button, and nothing else may rely on that.
   */
  async function rebuild(): Promise<void> {
    if (gesture.current || recovery.kind === "working" || recovery.kind === "rebuilt" || recoveryHold !== null) return;
    gesture.current = true;
    try {
      await rebuildOnce();
    } finally {
      gesture.current = false;
    }
  }

  async function rebuildOnce(): Promise<void> {
    setRecovery({ kind: "working", gesture: "rebuild" });
    const result = await relockGeoKbV3Draft({
      kbId,
      baseVersion: editor.view.draftVersion,
      draftHash: editor.view.draftHash,
    });
    if (!result.ok) {
      setRecovery({ kind: "rebuildFailed", code: result.code });
      return;
    }
    if (!result.relock.relocked) {
      setRecovery({ kind: "current" });
      return;
    }
    const open = runId.current;
    let cleared: GeoKbRunClearOutcome = "none";
    if (open !== null) {
      const dropped = await abandonGeoKbRun({ kbId, runId: open });
      // `abandoned`, `finished` and `not_found` all leave nothing pinned, which
      // is the fact the owner needs and the only thing `recovery.rebuildCleared`
      // claims -- it says the run is no longer open, never that this call was
      // what closed it, because for two of the three it was not.
      cleared = dropped.outcome === "busy" ? "busy"
        : dropped.outcome === "failed" ? "failed"
          : "cleared";
      // Bookkeeping only, and knowingly unpinned: `rebuilt` is a terminal
      // state for this card -- nothing clears it but the reload -- and while
      // it holds, `resume`, `runView` and `runId` are read by nothing that
      // renders. Making this call unconditional was measured against the whole
      // suite and changed no assertion. It is kept because the day `rebuilt`
      // stops being terminal, forgetting a run the server still holds is how
      // the Update button comes back over a run the route answers
      // `run_active` for.
      if (cleared === "cleared") forgetRun();
    }
    setRecovery({ kind: "rebuilt", discarded: result.relock.discarded, cleared });
  }

  /** Drop a run that stopped, so a new one can be started. */
  async function discardRun(): Promise<void> {
    const open = runId.current;
    if (gesture.current || open === null || recovery.kind === "working" || recovery.kind === "rebuilt" || recoveryHold !== null) return;
    gesture.current = true;
    try {
      setRecovery({ kind: "working", gesture: "discard" });
      const dropped = await abandonGeoKbRun({ kbId, runId: open });
      if (dropped.outcome === "busy") { setRecovery({ kind: "discardBusy" }); return; }
      if (dropped.outcome === "failed") { setRecovery({ kind: "discardFailed" }); return; }
      forgetRun();
      // Only `abandoned` is something this call dropped. `finished` and
      // `not_found` both mean the run was already not open, and saying "the
      // stopped update was discarded" over either would claim a gesture that
      // did nothing had done something to the owner's work.
      setRecovery({ kind: "discarded", gone: dropped.outcome !== "abandoned" });
    } finally {
      gesture.current = false;
    }
  }

  /**
   * Section 4.1: once a version is published and the draft on screen is that
   * version, the whole card folds to a summary line, mirroring the Product
   * Profile's confirmed card above it. `Edit` opens it again for the rest of
   * the session.
   *
   * The condition is a hash comparison, not "publish just returned": a freeze
   * stores the draft's own `content_hash` on the snapshot, so equal hashes mean
   * the reviewed body and the published body are the same bytes. Autosaving one
   * correction moves the draft hash and the card opens itself, which is the
   * behaviour that matters -- a collapsed summary over unpublished edits would
   * be a card claiming the owner has nothing left to review.
   */
  const [expanded, setExpanded] = useState(false);
  const knowledge = editor.payload.knowledge;
  const sources: SourceIndex = new Map((knowledge?.sourceCatalogue ?? []).map((source) => [source.id, source as GeoKnowledgeSourceV2]));
  const context: RowContext = {
    editor, sources, t, card: copy,
    restated: new Set(editor.view.restated),
    editing: editing?.itemKey ?? null,
    draft: editing?.draft ?? null,
    open: (itemKey, draft) => setEditing({ itemKey, draft }),
    change: (draft) => setEditing((current) => (current === null ? current : { ...current, draft })),
    close: () => setEditing(null),
  };

  const published = editor.view.published;
  /**
   * Two things worth telling a published owner, and neither of them acts.
   *
   * Section 12: the Profile and the knowledge base are never synced for you.
   * Confirming a new Profile revision leaves the published version exactly as
   * it was; what changes is that an update would now derive from newer inputs.
   * The sentence for that already existed in the catalog and had no caller, so
   * an owner who confirmed a Profile change was told nothing at all until they
   * tried something that failed.
   *
   * D11: a fact carries the date it should be looked at again, ninety days out
   * from when it was observed. Passing that date prompts and nothing more --
   * re-running is a billed crawl plus a model call, and nothing here may spend
   * that on its own.
   */
  const profileMoved = confirmedProfileRevision !== undefined
    && Number(editor.payload.generationInput.profileRef.snapshotRevision) < confirmedProfileRevision;
  const reviewDue = (geoKbModuleValue(knowledge?.facts ?? { status: "unavailable", reason: "not_applicable" }) ?? [])
    .filter((fact) => fact.nextReviewAt !== null && fact.nextReviewAt <= new Date().toISOString()).length;
  /**
   * Why the update on this draft cannot work, derived from the locked input the
   * card is rendering rather than from the create route's one-shot answer --
   * which the start card throws away when it hands over here. See
   * `geoKbV3DraftBlockers`.
   */
  const blockers = geoKbV3DraftBlockers(editor.payload.generationInput);
  /**
   * A re-lock replaced the stored draft. Everything below it -- the knowledge,
   * the publish plan counted over it, the update that would run against it --
   * describes a draft that no longer exists, so none of it is drawn until the
   * page has been re-read.
   */
  const rebuilt = recovery.kind === "rebuilt";
  const state = rebuilt ? "rebuilt"
    : editor.busy ? "running"
      : blockers.length > 0 && published === null ? "blocked"
        : published === null ? "draft" : "published";
  /**
   * The status line, and the one sentence it must never be.
   *
   * `copy.status.draft` says "a draft is ready for you to publish". Over a
   * draft whose locked input carries a blocker that is false in a way the owner
   * cannot see: the billed update against it throws before it reaches a
   * provider, so there is nothing to publish and never will be until the
   * Profile is fixed and the draft rebuilt. A published version keeps its own
   * line -- the blocker is about updating, and erasing what is published to say
   * so would trade one wrong sentence for another.
   */
  const statusText = rebuilt
    ? t("recovery.rebuildReload")
    : editor.status.kind === "busy" && editor.status.operation === "publish"
      ? t("review.saving")
      : published === null
        ? blockers.length > 0 ? t("recovery.blockedStatus") : copy.status.draft
        : (profileMoved ? copy.status.publishedUpdatable : copy.status.published)(
          String(published.revision), geoKbFormatDate(published.frozenAt, locale));

  const sections: GeoKbCardSections | null = knowledge === null || rebuilt ? null : {
    identity: <div className="min-w-0 space-y-6">
      <EntityModule knowledge={knowledge} context={context} packCopy={packCopy} />
      <ScopeModule knowledge={knowledge} context={context} packCopy={packCopy} />
    </div>,
    facts: <div className="min-w-0 space-y-6">
      <FactsModule knowledge={knowledge} context={context} packCopy={packCopy} />
      <QaModule knowledge={knowledge} context={context} packCopy={packCopy} />
      <ComparisonsModule knowledge={knowledge} context={context} packCopy={packCopy} />
    </div>,
    /* Read-only, not hidden.
       D3 makes evidence, machine-readable status and coverage read-only: they
       report observations, so there is no decision to record against them. That
       was implemented as not drawing them at all, which is a different thing --
       an owner on a v3 knowledge base could never see what the run observed
       about their own site, and the two sections sat permanently empty under a
       sentence saying there was nothing to decide. The same renderers the
       published pack uses draw them here, so an uncollected evidence group
       still says "never looked" rather than vanishing.
       The note stays above them: it is true, and it is the reason these rows
       carry no accept/correct/exclude controls. */
    trust: <div className="min-w-0 space-y-6">
      <Note>{t("review.noDecisions")}</Note>
      <GeoEvidenceModuleView module={knowledge.evidence} sources={sources} heading={3} locale={locale} copy={packCopy} card={copy} presentation={READ_ONLY} />
    </div>,
    reachability: <div className="min-w-0 space-y-6">
      <Note>{t("review.noDecisions")}</Note>
      <GeoMachineModuleView module={knowledge.machine} sources={sources} heading={3} locale={locale} copy={packCopy} card={copy} presentation={READ_ONLY} />
      <GeoCoverageModuleView module={knowledge.coverage} sources={sources} heading={3} locale={locale} copy={packCopy} card={copy} presentation={READ_ONLY} />
    </div>,
    // The question set is a different absence: it is not in a draft at all,
    // because a set is made for a published version by a paid run.
    measurement: <Note>{t("review.measurementEmpty")}</Note>,
    // A draft has no question set of its own: the set is a paid run's separate
    // output and is bound to the version at publish time. That is an absence,
    // never a count of zero -- "0 questions" would say the set exists and is
    // empty, and the owner would go looking for the one that emptied it.
    measurementCount: null,
  };

  const hold = editor.autosaveHold;
  /**
   * Nothing is folded away while something still needs the owner: an open
   * update, a stopped one waiting to be continued, a blocker, a re-lock, or an
   * unsaved edit all keep the full surface on screen. Collapsing over any of
   * those hides the only controls that answer them.
   */
  const settled = published !== null
    && knowledge !== null
    /* A prompt is something to tell them, and the folded summary has nowhere
       to say it. Section 4.1 folds a card with nothing left on it; these two
       are exactly the case where there is. */
    && !profileMoved
    && reviewDue === 0
    /* A `partial` module carries a limitation sentence, and the folded summary
       has nowhere to put it. An `unavailable` one needs no such room: its
       clause is simply not said (see `publishedCounts`). */
    && ![knowledge.facts, knowledge.qa, knowledge.comparisons].some((module) => module.status === "partial")
    && editor.view.draftHash === published.contentHash
    && !rebuilt
    && blockers.length === 0
    && runPhase === "idle"
    && resume === null
    && hold === null
    && editor.status.kind !== "busy";
  const summary = settled && !expanded
    ? {
      version: String(published.revision),
      name: entityValue(geoKbModuleValue(knowledge.entity) ?? {}, "name") || editor.view.host,
      host: editor.view.host,
      publishedAt: published.frozenAt,
      counts: publishedCounts(knowledge, editor.states),
      onEdit: () => setExpanded(true),
    }
    : null;
  return <GeoKbCard
    data-geo-kb-v3={true}
    collapsed={summary !== null}
    summary={summary}
    host={editor.view.host}
    locale={locale}
    inline={inline}
    state={state}
    statusText={statusText}
    onUpdate={() => { if (onUpdate === undefined) void drive(false); else onUpdate(); }}
    /* A blocked draft disables the billed gesture rather than letting it be
       pressed: the run it would start cannot build its input, so every press
       would end in the same stopped update. The reason is on the screen
       underneath, which is what makes a disabled button honest rather than
       inert. */
    updateDisabled={editor.busy || runPhase !== "idle" || resume !== null || rebuilt || blockers.length > 0 || recovery.kind === "working"}
    /* Dropped entirely once a re-lock has landed, rather than disabled: the
       publish box states an item count over knowledge the server has just
       discarded, and a disabled button under a sentence that is no longer true
       is still a sentence that is no longer true. */
    publish={rebuilt ? null : {
      ...editor.publishPlan,
      onPublish: () => void editor.publish(),
      disabled: decisionsHeld(hold),
      busy: editor.busy,
    }}
    /* The competitor rows: the one part of the locked input the owner edits
       here. Drawn on every draft that has not just been replaced, knowledge
       or not, because the best moment to confirm a rival is before the first
       billed update. Held under the same conditions as the recovery gestures
       plus an unsaved decision: a confirmation moves the draft version, and a
       review write queued against the old one would be refused as stale. Held
       under every hold that says this tab's coordinates are behind (a conflict,
       a moved input) or that a run has the draft, because the write would be
       refused for the same reason a decision is. The write itself is the
       hook's, under the hook's lock, so a decision made while it is out waits
       for the re-locked version rather than racing it. */
    inputs={rebuilt ? null : <GeoKbCompetitors
      kbId={kbId}
      competitors={editor.payload.generationInput.competitors}
      disabled={editor.busy || editor.dirty || runPhase !== "idle" || resume !== null || recovery.kind === "working" || decisionsHeld(hold) || hold === "running"}
      write={editor.writeCompetitor}
    />}
    sections={sections}
  >
    {rebuilt ? null : <RunPanel
      phase={runPhase}
      run={runView}
      resume={resume}
      recovering={recovery.kind === "working"}
      busyStreak={busyStreak}
      onContinue={() => void drive(true)}
      onReload={onReload ?? reloadThisPage}
      t={t}
    />}
    <RecoveryPanel
      blockers={blockers}
      openRun={resume !== null}
      hold={recoveryHold}
      state={recovery}
      onRebuild={() => void rebuild()}
      onDiscard={() => void discardRun()}
      onReload={onReload ?? reloadThisPage}
      t={t}
    />
    {reviewDue === 0 ? null : <p data-review-due="" role="status" className="text-[13px] leading-relaxed text-text-dark-secondary">
      {t("review.reviewDue", { count: reviewDue })}
    </p>}
    <span data-review-status="" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {hold === "conflict" ? t("review.conflict")
        : hold === "inputChanged" ? t("review.inputChanged")
          : hold === "running" ? t("review.running")
            : hold === "failed" ? t("review.failed")
              : editor.status.kind === "busy" ? t("review.saving")
                : editor.status.kind === "saved" ? t("review.saved") : ""}
    </span>
    {/* A conflict stops every automatic write for the life of this card, and
        the buttons in every module go dead with it -- correctly, because
        nothing decided here can be saved any more. That makes the way out the
        only thing left on the screen that matters, so it is a control and not
        just the last clause of a grey sentence.

        Only for `conflict`. `inputChanged` asks for an update, not a reload,
        and the update button at the head of the card is still live. */}
    {hold !== "conflict" ? null : <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" data-kb-reload="" onClick={onReload ?? reloadThisPage}>{t("recovery.reload")}</Button>
    </div>}
    {editor.published === null ? null : <span data-publish-outcome="" role="status" className="block text-[13px] leading-relaxed text-text-dark-secondary">
      {editor.published.reusedExisting
        ? t("review.publishReused", { version: String(editor.published.revision) })
        : t("review.publishDone", { version: String(editor.published.revision) })}
      {editor.published.questionSet.status === "unavailable" ? ` ${t("review.publishNoQuestionSet")}` : ""}
    </span>}
  </GeoKbCard>;
}
