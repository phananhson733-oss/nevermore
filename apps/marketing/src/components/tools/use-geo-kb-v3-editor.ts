"use client";
// @input  -- a v3 draft off the wire, the owner's gestures on it, and the id of a knowledge base with no draft yet
// @output -- the parsed review view, the decision state to render, a debounced compare-and-swap save, the publish action, the create, re-lock and competitor calls, and the blockers read off a locked input
// @pos    -- the hook can change `review` and nothing else on its own; create writes only where no draft exists, re-lock replaces a draft, and a competitor gesture is a named server write the hook only takes the answer of
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * The review half of a v3 draft, and only that half.
 *
 * A v3 draft is split by what changes it: `generationInput` and `knowledge` are
 * what a billed run produced, and `review` is what the owner decides. This hook
 * holds the second one. It never sends the first: the request it makes carries
 * gestures and the version they were made against, so there is no field in
 * which an edit could change the identity of a paid generation -- which is the
 * property that lets an owner correct a price in the afternoon and still publish
 * the knowledge generated that morning without paying for it again.
 *
 * Three things it deliberately does not do:
 *
 *  - it does not hash anything. A decision record carries the content hash of
 *    the item it was made against, and the browser has no sha256. The server
 *    computes it from the item it holds, under compare-and-swap on the draft
 *    version -- so the item it hashes is provably the item this hook rendered.
 *  - it does not re-read the draft. A conflict is surfaced with the version that
 *    won and the automatic writes stop; the remedy is to reload, because a run
 *    may have replaced the knowledge under the review.
 *  - it does not decide what an acceptance is called. `acceptAll` sends one
 *    action and the server writes the decision; since 2026-09-09 that is
 *    `accepted`, the same label the per-item button produces.
 */
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { ACCOUNT_AUTOSAVE_DELAY_MS } from "../account/autosave-delay.ts";
import {
  applyGeoV3ReviewAction,
  applyGeoV3ReviewActions,
  geoV3ChangedKeys,
  geoV3DecisionStates,
  geoV3PendingKeys,
  geoV3ReviewCounts,
  GEO_V3_UNDECIDED,
  type GeoV3DecisionState,
  type GeoV3DecisionStates,
  type GeoV3ReviewAction,
} from "../../lib/geo-tools/kb-v3-review.ts";
import {
  GEO_KB_V3_LIMITS,
  geoDecisionSchema,
  geoV3ItemKeys,
  parseGeoKbPayloadV3,
  type GeoDecision,
  type GeoGenerationInputV3,
  type GeoKbPayloadV3,
  type GeoOverrideV3,
} from "../../lib/geo-tools/kb-v3-contract.ts";
import {
  parseGeoKbCompetitorIdentifyV3,
  parseGeoKbCompetitorsSaveV3,
  parseGeoKbPublishV3,
  parseGeoKbReviewSaveV3,
  type GeoKbCompetitorIdentityV3,
  type GeoKbCompetitorsSaveV3,
  type GeoKbEditorViewV3,
  type GeoKbPublishV3,
} from "./geo-kb-v3-wire.ts";

export const GEO_KB_V3_API = "/api/tools/geo-knowledge-base/v3/";
export const GEO_KB_V3_AUTOSAVE_MS = ACCOUNT_AUTOSAVE_DELAY_MS;
/** Retry cadence while a run holds the draft; this tab cannot see the run end. */
export const GEO_KB_V3_AUTOSAVE_RETRY_MS = 5_000;

/** Why an automatic write is being held back, so the card can say so. */
export type GeoKbV3AutosaveHold =
  | "conflict"
  | "inputChanged"
  | "running"
  | "busy"
  | "failed";

export type GeoKbV3Status =
  | { readonly kind: "idle" | "saved" }
  | { readonly kind: "busy"; readonly operation: "save" | "publish" }
  | { readonly kind: "error"; readonly code: string };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type PostResult =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly code: string;
      readonly draftVersion?: number;
    };

async function post(path: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(`${GEO_KB_V3_API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const value: unknown = await response.json();
    if (!record(value)) return { ok: false, code: "bad_response" };
    if (response.ok)
      return Object.hasOwn(value, "data")
        ? { ok: true, data: value.data }
        : { ok: false, code: "bad_response" };
    return {
      ok: false,
      code:
        record(value.error) && typeof value.error.code === "string"
          ? value.error.code
          : "bad_response",
      ...(typeof value.draftVersion === "number" &&
      Number.isSafeInteger(value.draftVersion)
        ? { draftVersion: value.draftVersion }
        : {}),
    };
  } catch {
    return { ok: false, code: "network" };
  }
}

/* ------------------------------------------------------------------ */
/* Reading a loaded v3 draft off the wire                               */
/* ------------------------------------------------------------------ */

const v3Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const v3Hash = z.string().regex(/^[a-f0-9]{64}$/u);

/**
 * A loaded v3 draft as the website GEO response carries it.
 *
 * `GeoKbEditorViewV3` is what the card consumes; the two extra fields belong to
 * the transport. `schemaVersion` is how a response is told apart from the v2
 * editor view and the v1 view that share the same field, and `origin` is what
 * the page re-derives the canonical site key from before it agrees this
 * knowledge base is about the website it asked for.
 */
export interface GeoKbEditorViewV3Wire extends GeoKbEditorViewV3 {
  readonly schemaVersion: "marketing-geo-kb-editor.v3";
  readonly origin: string;
}

export const GEO_KB_EDITOR_V3_SCHEMA_VERSION = "marketing-geo-kb-editor.v3";

const editorViewV3Schema = z
  .object({
    schemaVersion: z.literal(GEO_KB_EDITOR_V3_SCHEMA_VERSION),
    kbId: v3Uuid,
    origin: z.string().min(1).max(2048),
    host: z.string().min(1).max(255),
    /**
     * Positive, never zero. Zero is what the v2 editor view uses for "no draft
     * has ever been saved", and a v3 review card with no stored draft has
     * nothing to compare-and-swap against -- every save it made would be
     * refused, and the card would sit there offering gestures that cannot land.
     */
    draftVersion: z.number().int().positive().refine(Number.isSafeInteger),
    draftHash: v3Hash,
    payload: z.unknown(),
    /** Section 4.4's "has a new observation" flag; see `GeoKbEditorViewV3`. */
    restated: z.array(v3Hash).max(GEO_KB_V3_LIMITS.decisions),
    published: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("comparable"),
          revision: z.number().int().positive().refine(Number.isSafeInteger),
          frozenAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Expected a timestamp"),
          contentHash: v3Hash,
          decisions: z.record(v3Hash, geoDecisionSchema),
        }).strict(),
        // No `decisions`, and not optional-and-empty: a v1/v2 version records
        // none, and a field that could be present-and-empty invites a reader to
        // treat "cannot be measured" as "nothing changed".
        z.object({
          kind: z.literal("opaque"),
          revision: z.number().int().positive().refine(Number.isSafeInteger),
          frozenAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Expected a timestamp"),
          contentHash: v3Hash,
        }).strict(),
      ])
      .nullable(),
    runInProgress: z.boolean().optional(),
  })
  .strict();

/**
 * Read one v3 editor view, or refuse the whole response.
 *
 * The payload is parsed by the contract's own parser rather than by a looser
 * shape here: the card renders decisions against item keys, and a payload that
 * only half-parses would render rows whose keys no save could ever address.
 */
export function parseGeoKbEditorViewV3(value: unknown): GeoKbEditorViewV3Wire | null {
  const parsed = editorViewV3Schema.safeParse(value);
  if (!parsed.success) return null;
  let payload: GeoKbPayloadV3;
  try {
    payload = parseGeoKbPayloadV3(parsed.data.payload);
  } catch {
    return null;
  }
  // `draftHash` is carried, not verified: the browser has no sha256, and the
  // server checks it under compare-and-swap on every save. What this parser can
  // guarantee is narrower and worth stating -- the payload is a complete v3
  // payload, so every row the card draws has an item key a save can address.
  return { ...parsed.data, payload };
}

/* ------------------------------------------------------------------ */
/* Creating the first draft                                             */
/* ------------------------------------------------------------------ */

/**
 * What `POST /v3/draft` answers with, as this browser is willing to read it.
 *
 * It is a second, independent statement of the route's response contract rather
 * than an import of the server's own schema: importing that would pull the
 * route's digest and store chain into the client bundle. Two statements of one
 * shape is the cost of the boundary; a mismatch shows up here as a refusal to
 * read, not as a render of something nobody validated.
 */
const draftCreateSchema = z
  .object({
    // UUIDv8, so not `z.uuid()`.
    kbId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu),
    draftVersion: z.number().int().positive().refine(Number.isSafeInteger),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Expected a timestamp"),
    generationInputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    /**
     * Bounded, not enumerated. A blocker names a reason the created draft
     * cannot start a paid run yet; a client that only admitted the two the
     * server sends today would silently drop the third one added tomorrow and
     * report a draft as ready to run when it is not. Whoever renders these must
     * treat an unrecognised code as "blocked for a reason this build cannot
     * name", never as no blocker at all.
     */
    blockers: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export type GeoKbV3DraftCreated = z.infer<typeof draftCreateSchema>;

export type GeoKbV3DraftCreateResult =
  | { readonly ok: true; readonly draft: GeoKbV3DraftCreated }
  /**
   * `draft_exists` and `legacy_draft` both mean "this knowledge base already
   * has a draft, so there is nothing to create". They are kept apart because
   * the next step differs: one is already a v3 draft to load, the other is a
   * v1/v2 draft that no upgrade path exists for yet. `draftVersion` is the
   * version the server holds, present on exactly those refusals and on a
   * genuine compare-and-swap conflict.
   */
  | { readonly ok: false; readonly code: string; readonly draftVersion?: number };

/**
 * Create the first v3 draft for a knowledge base that has none.
 *
 * It is a plain function rather than part of the editor hook because the hook
 * needs a draft to already exist -- it is handed one as `initialView` -- and
 * this is the step that produces the first one. It makes no model call and
 * spends no crawl allowance -- `kb-v3-draft-create.ts` observes nothing, and
 * the run's collect step is what reads the site -- so nothing here is billed.
 * It still belongs behind a gesture rather than behind a render: it writes a
 * draft, and it spends one of the few creates an hour a knowledge base is
 * allowed, which a re-rendering page would burn without anyone asking for it.
 *
 * `baseVersion` is the literal zero the route requires. Sending the version the
 * caller happens to believe in would turn a create into an overwrite of
 * whatever another tab wrote in the meantime.
 */
export async function createGeoKbV3Draft(kbId: string): Promise<GeoKbV3DraftCreateResult> {
  const result = await post("draft", { kbId, baseVersion: 0 });
  if (!result.ok) {
    return result.draftVersion === undefined
      ? { ok: false, code: result.code }
      : { ok: false, code: result.code, draftVersion: result.draftVersion };
  }
  const parsed = draftCreateSchema.safeParse(result.data);
  // A draft reported under another knowledge base's id is not this one's, and
  // acting on it would point every later save at a knowledge base the caller
  // never asked about.
  if (!parsed.success || parsed.data.kbId !== kbId) return { ok: false, code: "bad_response" };
  return { ok: true, draft: parsed.data };
}

/* ------------------------------------------------------------------ */
/* Why a draft cannot start a run yet                                   */
/* ------------------------------------------------------------------ */

/**
 * The blockers a v3 draft can carry, in the order the create route reports
 * them (`GEO_KB_V3_DRAFT_BLOCKERS` in `kb-v3-draft-create.ts`).
 *
 * Stated here rather than imported because that module is the HTTP boundary --
 * importing it would pull the route's digest and store chain into the browser
 * bundle, the same reason `draftCreateSchema` above restates the response
 * shape instead of importing the server's schema.
 */
export const GEO_KB_V3_BLOCKERS = ["category_terms_missing"] as const;
export type GeoKbV3Blocker = (typeof GEO_KB_V3_BLOCKERS)[number];

/**
 * Why the update on this draft cannot build its input, read off the draft.
 *
 * The create route answers with this list once, at create time, and the card
 * that pressed the button throws the answer away when it hands over to the
 * review card. Rather than plumb a one-shot value through a reload, the same
 * two predicates are evaluated against the locked generation input the review
 * card is already rendering -- which is the artefact the run itself reads, not
 * a second copy of the route's answer:
 *
 *  - `category_terms_missing` is `identity.categoryTerms` being empty, and
 *    `buildGeoKnowledgeSynthesisInputV2` requires at least one
 *    (`kb-knowledge-synthesis-v2-contract.ts`, `.min(1)`). A draft locked with
 *    none can never produce a synthesis input, so its billed update throws
 *    before it reaches a provider -- and `categories` is not in
 *    `REQUIRED_PROFILE_FIELDS`, so an ordinary confirmed Profile reaches this.
 *
 * There is deliberately no language blocker. The English registry governs the
 * QUESTION SET, and a v3 draft has none to produce; D8 puts the knowledge body
 * in the site's own language, so a non-English site is not stopped here.
 *
 * The seam: this predicate is written twice now, here and in
 * `buildGeoKbV3Identity`. One client-safe module holding it, read by the route
 * and by this file, is the fix; it is reported rather than made here because
 * the route's copy is not this change's to move.
 */
export function geoKbV3DraftBlockers(
  generationInput: GeoGenerationInputV3,
): readonly GeoKbV3Blocker[] {
  const blockers: GeoKbV3Blocker[] = [];
  // No language blocker: D8 puts the knowledge body in the site's own language
  // and holds only the question set to the English registry. See the note on
  // `GEO_KB_V3_DRAFT_BLOCKERS`.
  if (generationInput.identity.categoryTerms.length === 0)
    blockers.push("category_terms_missing");
  return blockers;
}

/* ------------------------------------------------------------------ */
/* Re-locking a draft whose Profile revision moved                      */
/* ------------------------------------------------------------------ */

const relockShared = {
  kbId: v3Uuid,
  draftVersion: z.number().int().positive().refine(Number.isSafeInteger),
  contentHash: v3Hash,
  updatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Expected a timestamp"),
  generationInputHash: v3Hash,
  /** The Profile revision the draft names *after* the call, either way. */
  profileRef: z
    .object({ snapshotId: v3Uuid, snapshotRevision: z.string().regex(/^[1-9][0-9]{0,15}$/u) })
    .strict(),
};

/**
 * The two answers a re-lock has, as two shapes rather than one shape with
 * holes -- the discriminated union the route sends.
 *
 * `relocked: false` carries no `discarded` and no `blockers` on purpose: the
 * route wrote nothing, so a zeroed `discarded` would be indistinguishable from
 * a re-lock that happened to destroy nothing, and an empty `blockers` would
 * state that a rebuilt input had been checked and found clear when none was
 * built. Reading them as absent is what lets the card say "nothing was
 * changed" without guessing.
 */
const relockSchema = z.discriminatedUnion("relocked", [
  z.object({ ...relockShared, relocked: z.literal(false) }).strict(),
  z
    .object({
      ...relockShared,
      relocked: z.literal(true),
      /** Bounded, not enumerated, for the reason `draftCreateSchema.blockers` is. */
      blockers: z.array(z.string().min(1).max(64)).max(16),
      discarded: z
        .object({
          knowledge: z.boolean(),
          decisions: z.number().int().nonnegative().refine(Number.isSafeInteger),
          suppressions: z.number().int().nonnegative().refine(Number.isSafeInteger),
          roles: z.number().int().nonnegative().refine(Number.isSafeInteger),
          released: z.array(z.string().min(1).max(64)).max(16),
        })
        .strict(),
    })
    .strict(),
]);
export type GeoKbV3Relocked = z.infer<typeof relockSchema>;

export type GeoKbV3RelockResult =
  | { readonly ok: true; readonly relock: GeoKbV3Relocked }
  | { readonly ok: false; readonly code: string; readonly draftVersion?: number };

/**
 * Rebuild a draft's locked generation input from the confirmed Profile.
 *
 * This is the exit from the one state a knowledge base cannot leave on its own.
 * Confirming a new Profile revision makes `marketing_geo_generation_input_current`
 * false for the draft (`20260907143000_geo_kb_v3.sql`), every knowledge claim
 * the update makes answers `input_stale`, the ledger files that as retryable,
 * and `planGeoRun` re-starts it forever -- so the run never rests, the run row
 * stays `running`, the single-active index blocks every future run and the
 * Update button stays disabled behind the resume it produces.
 *
 * It is a gesture and never automatic, for three reasons that all point the
 * same way. The route destroys the knowledge a run was paid for, the decisions
 * made on it and the roles it proposed. The route demands the digest of the
 * exact draft being discarded as the acknowledgement, which only a caller that
 * was shown that draft can produce. And this browser cannot in fact detect a
 * stale input: a claim refused with `input_stale` reaches the ledger as reason
 * `store_unavailable` (`kb-run-runtime.ts`, whose reason vocabulary is a
 * database CHECK with no member for it), so a trigger that fired "on detecting
 * a stale input" would have to fire on every stalled update -- and would then
 * destroy paid work over a transient outage.
 *
 * Asking when nothing moved is safe and is what makes the gesture offerable
 * without a diagnosis: the route compares the draft's `profileRef` against the
 * confirmed one *before* building or writing anything and answers
 * `relocked: false`, having minted no version and discarded nothing.
 */
/**
 * Turn a v1/v2 draft into a first v3 draft. One way, and it discards what the
 * old draft held.
 *
 * The same shape as the re-lock below and for the same reason: the intent is
 * named rather than inferred, and `draftHash` is the acknowledgement -- a
 * caller cannot produce the digest of the draft it is about to discard without
 * having been shown that draft.
 *
 * Section 4.4's blocker table asks for this path by name ("astrologywiki 现有
 * v2 草稿升不到 v3；S1 要允许 v2 → v3 升级路径"). The database half has been open
 * since `20260907143000_geo_kb_v3.sql:266`; this is the side that asks.
 */
export async function upgradeGeoKbToV3(input: {
  readonly kbId: string;
  readonly baseVersion: number;
  readonly draftHash: string;
}): Promise<GeoKbV3DraftCreateResult> {
  const result = await post("draft", {
    kbId: input.kbId,
    intent: "upgrade",
    baseVersion: input.baseVersion,
    draftHash: input.draftHash,
  });
  if (!result.ok) {
    return result.draftVersion === undefined
      ? { ok: false, code: result.code }
      : { ok: false, code: result.code, draftVersion: result.draftVersion };
  }
  const parsed = draftCreateSchema.safeParse(result.data);
  // Same check, same reason, as the create above: a draft reported under
  // another knowledge base's id is not this one's.
  if (!parsed.success || parsed.data.kbId !== input.kbId) return { ok: false, code: "bad_response" };
  return { ok: true, draft: parsed.data };
}

export async function relockGeoKbV3Draft(input: {
  readonly kbId: string;
  readonly baseVersion: number;
  readonly draftHash: string;
}): Promise<GeoKbV3RelockResult> {
  const result = await post("draft", {
    kbId: input.kbId,
    intent: "relock",
    baseVersion: input.baseVersion,
    draftHash: input.draftHash,
  });
  if (!result.ok) {
    return result.draftVersion === undefined
      ? { ok: false, code: result.code }
      : { ok: false, code: result.code, draftVersion: result.draftVersion };
  }
  const parsed = relockSchema.safeParse(result.data);
  // A re-lock reported under another knowledge base's id is not this one's, and
  // acting on it would tell an owner their draft was rebuilt when a different
  // one was. Same check, same reason, as the create above.
  if (!parsed.success || parsed.data.kbId !== input.kbId) return { ok: false, code: "bad_response" };
  return { ok: true, relock: parsed.data };
}

/* ------------------------------------------------------------------ */
/* The competitor gestures                                              */
/* ------------------------------------------------------------------ */

export type GeoKbV3CompetitorGestureWire =
  | { readonly kind: "confirm"; readonly domain: string; readonly brandName: string; readonly aliases: readonly string[] }
  | { readonly kind: "unconfirm"; readonly domain: string };

export type GeoKbV3CompetitorLookupResult =
  | { readonly ok: true; readonly identity: GeoKbCompetitorIdentityV3 }
  | { readonly ok: false; readonly code: string };

/**
 * Ask what a rival's own homepage calls it. Reads nothing into the draft: the
 * answer is a proposal the owner confirms, edits or ignores. It may spend one
 * of the owner's crawl admissions, so it sits behind a gesture, never a render.
 */
export async function lookupGeoKbV3Competitor(input: {
  readonly kbId: string;
  readonly domain: string;
}): Promise<GeoKbV3CompetitorLookupResult> {
  const result = await post("competitors", { kbId: input.kbId, intent: "identify", domain: input.domain });
  if (!result.ok) return { ok: false, code: result.code };
  const parsed = parseGeoKbCompetitorIdentifyV3(result.data);
  if (parsed === null || parsed.kbId !== input.kbId) return { ok: false, code: "bad_response" };
  return { ok: true, identity: parsed.identity };
}

export type GeoKbV3CompetitorWriteResult =
  | { readonly ok: true; readonly saved: GeoKbCompetitorsSaveV3 }
  | { readonly ok: false; readonly code: string; readonly draftVersion?: number };

/**
 * Confirm a rival, or withdraw that. The one write in the product that moves
 * the locked half of a draft outside a re-lock, and it moves one row of it;
 * the server decides the payload and re-locks the input, and the hook takes
 * the answer through `applyCompetitors` so every later write names the new
 * coordinates.
 */
export async function writeGeoKbV3Competitor(input: {
  readonly kbId: string;
  readonly baseVersion: number;
  readonly expectedGenerationInputHash: string;
  readonly gesture: GeoKbV3CompetitorGestureWire;
}): Promise<GeoKbV3CompetitorWriteResult> {
  const scope = { kbId: input.kbId, baseVersion: input.baseVersion, expectedGenerationInputHash: input.expectedGenerationInputHash };
  const result = await post("competitors", input.gesture.kind === "confirm"
    ? { ...scope, intent: "confirm", domain: input.gesture.domain, brandName: input.gesture.brandName, aliases: input.gesture.aliases }
    : { ...scope, intent: "unconfirm", domain: input.gesture.domain });
  if (!result.ok) {
    return result.draftVersion === undefined
      ? { ok: false, code: result.code }
      : { ok: false, code: result.code, draftVersion: result.draftVersion };
  }
  const parsed = parseGeoKbCompetitorsSaveV3(result.data);
  if (parsed === null || parsed.kbId !== input.kbId) return { ok: false, code: "bad_response" };
  return { ok: true, saved: parsed };
}

export interface GeoKbV3PublishPlan {
  readonly nextVersion: string;
  readonly previousVersion: string | null;
  /** Items whose decision differs from the published version's. */
  /**
   * How many items differ from the published version, or null when that version
   * records no per-item decisions and the question has no honest answer.
   */
  readonly changeCount: number | null;
  readonly itemCount: number;
  /** Items nobody has decided, which publishing would accept on the owner's behalf. */
  readonly pendingCount: number;
}

export interface UseGeoKbV3EditorProps {
  readonly initialView: GeoKbEditorViewV3;
}

/**
 * One decision, in the vocabulary the product uses today.
 *
 * `accepted_in_bulk` is retired (see `kb-v3-contract.ts`): nothing writes it,
 * and a stored draft or a published version from before 2026-09-09 that
 * carries it means `accepted`. Every comparison between a stored decision and
 * a current one goes through here so the two spellings of one answer never
 * read as a difference.
 */
function settledDecision(decision: GeoDecision): GeoDecision {
  return decision === "accepted_in_bulk" ? "accepted" : decision;
}

export function useGeoKbV3Editor({ initialView }: UseGeoKbV3EditorProps) {
  const itemKeys = geoV3ItemKeys(initialView.payload.knowledge);
  const [view, setView] = useState(initialView);
  const [saved, setSaved] = useState<GeoV3DecisionStates>(() =>
    geoV3DecisionStates(initialView.payload.review, itemKeys),
  );
  const [queued, setQueued] = useState<readonly GeoV3ReviewAction[]>([]);
  const [status, setStatus] = useState<GeoKbV3Status>({ kind: "idle" });
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [published, setPublished] = useState<GeoKbPublishV3 | null>(null);

  /**
   * The published decisions this draft is compared against, read from the
   * loaded view on every render rather than captured once at mount.
   *
   * `view.published` changes in exactly one place -- a successful publish,
   * which replaces it with the decisions that were just frozen -- so deriving
   * it keeps both halves of the publish box's sentence describing the same
   * version. A snapshot taken at mount does not: after publishing kb@v1 the box
   * named kb@v1 as the version to compare against while still counting against
   * the pre-publish map, so every item read as changed and the card announced
   * "N changes compared with kb@v1" the instant kb@v1 came into being.
   *
   * It does not hide later edits either, which was the worry the snapshot was
   * there for: a gesture made after publishing moves `states`, never
   * `view.published.decisions`, so the count climbs again from zero.
   */
  const baseline: Readonly<Record<string, GeoDecision>> | null =
    view.published === null || view.published === undefined ? {}
      : view.published.kind === "comparable" ? view.published.decisions
        // Null, not `{}`. An empty map means "nothing was decided over there",
        // and a v1/v2 version did not record decisions at all -- counting
        // against it would report every decided item as a change.
        : null;

  /**
   * Mirrors of the state, read by the timer and the flush. A closure over this
   * render's values addresses a version the server has already moved past --
   * the autosave timer is created one render before it fires.
   */
  const live = useRef({ view, saved, queued });
  live.current = { view, saved, queued };

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lock = useRef(false);
  /**
   * A conflict re-bases nothing: the knowledge itself may have been replaced by
   * a run, so the only safe next step is a reload. Automatic writes stop here
   * and stay stopped.
   */
  const conflictHold = useRef(false);
  const inputChangedHold = useRef(false);
  /**
   * A refusal the owner cannot see past -- a rate limit, a lost session -- must
   * not re-arm itself: autosave runs on a fixed cadence, so it would repeat for
   * as long as the tab stays open and spend the owner's own hourly budget.
   * Another gesture, or an explicit save, re-arms it.
   */
  const writeFailed = useRef(false);
  /** The server refused because a run is writing this draft; retried on a slower beat. */
  const runningElsewhere = useRef(false);

  const states = applyGeoV3ReviewActions(saved, queued);
  const counts = geoV3ReviewCounts(states);
  const pendingKeys = geoV3PendingKeys(states);
  const dirty = queued.length > 0;
  const busy = status.kind === "busy";

  function holdNow(): GeoKbV3AutosaveHold | null {
    if (conflictHold.current) return "conflict";
    if (inputChangedHold.current) return "inputChanged";
    if (lock.current) return "busy";
    if (runningElsewhere.current || live.current.view.runInProgress === true)
      return "running";
    return writeFailed.current ? "failed" : null;
  }
  const autosaveHold: GeoKbV3AutosaveHold | null = conflictHold.current
    ? "conflict"
    : inputChangedHold.current
      ? "inputChanged"
      : busy
        ? "busy"
        : runningElsewhere.current || view.runInProgress === true
          ? "running"
          : writeFailed.current
            ? "failed"
            : null;

  function schedule(delay = GEO_KB_V3_AUTOSAVE_MS) {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      // Only the server knows whether a run started elsewhere has ended, so
      // every firing asks it again rather than waiting to be told.
      runningElsewhere.current = false;
      if (live.current.queued.length === 0 || holdNow() !== null) return;
      void flush();
    }, delay);
  }

  function resume() {
    if (
      live.current.queued.length > 0 &&
      timer.current === null &&
      holdNow() === null
    )
      schedule();
  }

  function fail(result: {
    readonly code: string;
    readonly draftVersion?: number;
  }): void {
    if (result.code === "conflict") {
      conflictHold.current = true;
      if (result.draftVersion !== undefined)
        setConflictVersion(result.draftVersion);
    }
    if (result.code === "input_changed") inputChangedHold.current = true;
    setStatus({ kind: "error", code: result.code });
  }

  async function flush(): Promise<boolean> {
    if (lock.current) return false;
    const start = live.current;
    if (start.queued.length === 0) return true;
    lock.current = true;
    setStatus({ kind: "busy", operation: "save" });
    // The actions being sent, captured now: gestures made while the request is
    // in flight belong to the next write, not this one.
    const sending = start.queued;
    let failed = false;
    try {
      const result = await post("review", {
        kbId: start.view.kbId,
        baseVersion: start.view.draftVersion,
        expectedGenerationInputHash:
          start.view.payload.runRef.generationInputHash,
        actions: sending,
      });
      if (!result.ok && result.code === "generation_running") {
        // A hold, not a failure: the run ends on its own, so the retry is armed
        // rather than the write being marked failed (which would suppress it).
        runningElsewhere.current = true;
        setStatus({ kind: "idle" });
        schedule(GEO_KB_V3_AUTOSAVE_RETRY_MS);
        return false;
      }
      if (!result.ok) {
        failed = true;
        fail(result);
        return false;
      }
      const data = parseGeoKbReviewSaveV3(result.data);
      if (data === null) {
        failed = true;
        fail({ code: "schema_mismatch" });
        return false;
      }
      runningElsewhere.current = false;
      const nextView = {
        ...live.current.view,
        draftVersion: data.draftVersion,
        draftHash: data.contentHash,
        payload: { ...live.current.view.payload, review: data.review },
        // Recomputed by the server against the review it just wrote. Keeping
        // the loaded set here would leave a row saying "has a new observation"
        // after the owner had looked at it and decided again.
        restated: data.restated,
      };
      const nextSaved = geoV3DecisionStates(data.review, itemKeys);
      const remaining = live.current.queued.slice(sending.length);
      live.current = { view: nextView, saved: nextSaved, queued: remaining };
      setView(nextView);
      setSaved(nextSaved);
      setQueued(remaining);
      setStatus({ kind: remaining.length === 0 ? "saved" : "idle" });
      return true;
    } catch {
      failed = true;
      setStatus({ kind: "error", code: "bad_response" });
      return false;
    } finally {
      lock.current = false;
      writeFailed.current = failed;
      resume();
    }
  }

  function enqueue(action: GeoV3ReviewAction): void {
    // A gesture that changes nothing -- accepting an item that is already
    // accepted through its module button, say -- is not queued: it
    // would advance the draft version and stale a version about to be published.
    const before = applyGeoV3ReviewActions(
      live.current.saved,
      live.current.queued,
    );
    // `applyGeoV3ReviewAction` returns its input by reference when the gesture
    // reaches nothing, which is the only cheap way to tell a real change from a
    // click on an item that already holds that decision.
    if (applyGeoV3ReviewAction(before, action) === before) return;
    writeFailed.current = false;
    const queue = [...live.current.queued, action];
    live.current = { ...live.current, queued: queue };
    setQueued(queue);
    setStatus((previous) =>
      previous.kind === "saved" ? { kind: "idle" } : previous,
    );
    schedule();
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      // Leaving by client-side navigation skips `beforeunload`. Pending gestures
      // go out with a request the browser keeps alive after the page is gone; the
      // server's version check still refuses a stale write.
      //
      // Every hold but one applies here too, because the write it describes would
      // be refused. "failed" is the exception: it exists to stop a repeating
      // retry, and this is one fire-and-forget request on the way out, so
      // honouring it would discard the owner's last decisions over a transient
      // error they never saw.
      const hold = holdNow();
      if (
        live.current.queued.length === 0 ||
        (hold !== null && hold !== "failed")
      )
        return;
      const base = live.current;
      try {
        void Promise.resolve(
          fetch(`${GEO_KB_V3_API}review`, {
            method: "POST",
            keepalive: true,
            headers: { "content-type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              kbId: base.view.kbId,
              baseVersion: base.view.draftVersion,
              expectedGenerationInputHash:
                base.view.payload.runRef.generationInputHash,
              actions: base.queued,
            }),
          }),
        ).catch(() => undefined);
      } catch {
        /* unmount must never throw */
      }
      // Empty deps on purpose: this runs once, at unmount, and reads the
      // latest state through the ref rather than through a closure.
    },
    [],
  );

  const decisionFor = (itemKey: string): GeoV3DecisionState =>
    states.get(itemKey) ?? GEO_V3_UNDECIDED;

  const publishPlan: GeoKbV3PublishPlan = {
    nextVersion: String((view.published?.revision ?? 0) + 1),
    previousVersion:
      view.published === null || view.published === undefined
        ? null
        : String(view.published.revision),
    // Null when the previous version cannot be compared item by item. The card
    // then names the version without claiming a count for it.
    //
    // `settledDecision` is why the retired `accepted_in_bulk` cannot inflate
    // this: a version published before 2026-09-09 records it where a draft now
    // records `accepted`, and the two mean the same thing. Comparing the raw
    // strings would report every item of every such version as changed, on a
    // screen whose whole job is to say what actually differs.
    changeCount: baseline === null ? null : [...states].filter(
      ([itemKey, state]) =>
        settledDecision(baseline[itemKey] ?? "pending") !== settledDecision(state.decision),
    ).length,
    itemCount: itemKeys.length,
    pendingCount: pendingKeys.length,
  };

  /**
   * Publish: write the remaining pending items back as accepted, then
   * freeze. Unsaved gestures are flushed first, because a version assembled from
   * a draft the owner has since changed would publish decisions nobody made.
   */
  async function publish(): Promise<boolean> {
    if (lock.current) return false;
    if (live.current.queued.length > 0) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (!(await flush())) return false;
    }
    if (holdNow() !== null && holdNow() !== "failed") return false;
    lock.current = true;
    setStatus({ kind: "busy", operation: "publish" });
    try {
      const base = live.current.view;
      const result = await post("publish", {
        kbId: base.kbId,
        baseVersion: base.draftVersion,
        draftHash: base.draftHash,
      });
      if (!result.ok) {
        fail(result);
        return false;
      }
      const data = parseGeoKbPublishV3(result.data);
      if (data === null) {
        fail({ code: "schema_mismatch" });
        return false;
      }
      /**
       * The same sweep the server performed, replayed by the same pure function
       * so the card stops offering to publish what was just published. The
       * count is checked rather than assumed: if the two disagree, this view is
       * not what was published and the only honest state is "reload".
       */
      const stillPending = geoV3PendingKeys(live.current.saved);
      if (stillPending.length !== data.bulkAccepted) {
        conflictHold.current = true;
        setConflictVersion(data.draftVersion);
        setStatus({ kind: "error", code: "conflict" });
        return false;
      }
      const nextSaved =
        stillPending.length === 0
          ? live.current.saved
          : applyGeoV3ReviewAction(live.current.saved, {
              kind: "accept_all",
              itemKeys: stillPending,
            });
      const nextView: GeoKbEditorViewV3 = {
        ...live.current.view,
        draftVersion: data.draftVersion,
        draftHash: data.draftHash,
        published: {
          // A publish this card performed is a v3 version by construction, so
          // the draft it leaves behind is comparable item by item again -- even
          // when the version it superseded was not.
          kind: "comparable",
          revision: data.revision,
          frozenAt: data.frozenAt,
          contentHash: data.contentHash,
          decisions: Object.fromEntries(
            [...nextSaved].map(([key, state]) => [key, state.decision]),
          ),
        },
      };
      live.current = { ...live.current, view: nextView, saved: nextSaved };
      setSaved(nextSaved);
      setView(nextView);
      setPublished(data);
      setStatus({ kind: "saved" });
      return true;
    } catch {
      setStatus({ kind: "error", code: "bad_response" });
      return false;
    } finally {
      lock.current = false;
      resume();
    }
  }

  return {
    view,
    payload: view.payload,
    itemKeys,
    states,
    counts,
    decisionFor,
    dirty,
    busy,
    status,
    autosaveHold,
    /** The draft version that won a conflict, so the card can say what to reload to. */
    conflictVersion,
    publishPlan,
    published,
    changedKeys: geoV3ChangedKeys(saved, states),
    accept: (itemKey: string) => enqueue({ kind: "accept", itemKey }),
    correct: (itemKey: string, override: GeoOverrideV3) =>
      enqueue({ kind: "correct", itemKey, override }),
    exclude: (itemKey: string) => enqueue({ kind: "exclude", itemKey }),
    revert: (itemKey: string) => enqueue({ kind: "revert", itemKey }),
    /**
     * The module button. It names the keys of that module only, so it can never
     * reach an item in another module. What it writes is `accepted`, exactly
     * what the per-item button writes.
     */
    acceptAll: (keys: readonly string[]) => {
      const sweep = keys.filter((key) => {
        const state = states.get(key);
        return (
          state !== undefined &&
          state.decision === "pending" &&
          state.override === null
        );
      });
      if (sweep.length > 0) enqueue({ kind: "accept_all", itemKeys: sweep });
    },
    save: () => flush(),
    publish,
    /**
     * Take a competitor write's answer into the view. The server re-locked the
     * input and released the generation ids in that write; knowledge and
     * review are untouched, so nothing about the decision state moves -- only
     * the coordinates every later write has to name.
     */
    applyCompetitors: (saved: GeoKbCompetitorsSaveV3) => {
      if (!saved.changed) return;
      const nextView: GeoKbEditorViewV3 = {
        ...live.current.view,
        draftVersion: saved.draftVersion,
        draftHash: saved.contentHash,
        payload: {
          ...live.current.view.payload,
          generationInput: { ...live.current.view.payload.generationInput, competitors: saved.competitors },
          runRef: {
            runId: null,
            generationInputHash: saved.generationInputHash,
            rolesGenerationId: null,
            knowledgeGenerationId: null,
            questionsGenerationId: null,
          },
        },
      };
      live.current = { ...live.current, view: nextView };
      setView(nextView);
    },
  };
}
