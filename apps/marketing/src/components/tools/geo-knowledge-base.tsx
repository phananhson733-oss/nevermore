"use client";

// @input  -- the signed-in visitor's knowledge base for one site
// @output -- an editor, a freeze control that states what still blocks it, and the questions a frozen version produces
// @pos    -- the only client surface of /tools/geo-knowledge-base; it edits and renders, it never decides

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  GEO_KB_LIMITS,
  GEO_KB_SCHEMA_VERSION,
  geoKbBlockers,
  type GeoKbBlocker,
  type GeoKbCompetitor,
  type GeoKbFact,
  type GeoKbPayload,
  type GeoKbRejection,
  type GeoKbRole,
} from "../../lib/geo-tools/kb-contract.ts";
import {
  geoKbRowIssues,
  geoKbSubmission,
  hasGeoKbRowIssues,
  type GeoKbRowIssues,
} from "./geo-kb-editor-payload.ts";
import {
  isGeoKbBlockers,
  isGeoKbFreezeResponse,
  isGeoKbImportResponse,
  isGeoKbSaveResponse,
  isGeoKbView,
  type GeoKbQuestionPreview,
  type GeoKbView,
} from "./geo-kb-wire.ts";
import { GeoKbInheritedProfile } from "./geo-kb-profile.tsx";
import { GeoKbEnrichment } from "./geo-kb-enrichment.tsx";
import { pendingGeoProfileFact } from "./geo-kb-feature-candidates.ts";
import { isSupportedGeoQuestionLanguage } from "../../lib/geo-tools/asset-context.ts";
import { createGeoProfileCopy, type GeoProfileCopy } from "../../lib/geo-tools/kb-profile-copy.ts";
import { GeoKbMeasurementReview } from "./geo-kb-measurement-review.tsx";
import { GeoProfileCopyReview } from "./geo-kb-profile-copy-review.tsx";
import { GeoKbFrozenCopy } from "./geo-kb-frozen-copy.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { consumeGeoKnowledgeRepair, GEO_BRIEF_RETURN_KEY, writeGeoBriefReturn, type GeoKnowledgeRepair } from "../../lib/geo-tools/brief-knowledge-handoff.ts";
import { localePath } from "../../lib/locale-path.ts";

const ENDPOINTS = {
  load: "/api/tools/geo-knowledge-base/load",
  draft: "/api/tools/geo-knowledge-base/draft",
  freeze: "/api/tools/geo-knowledge-base/freeze",
  import: "/api/tools/geo-knowledge-base/import",
} as const;

const FACT_REASONS = [
  "notPublished",
  "fetchFailed",
  "lowConfidence",
  "conflicting",
] as const;

/** Two of the markets the sampling provider is calibrated for. */
const COUNTRIES = ["US", "GB"] as const;
const QUESTION_LANGUAGES = ["en", "en-US", "en-GB"] as const;

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | {
      readonly kind: "error";
      readonly code: string;
      readonly reason?: string;
      /** Blockers from the server or an unsaved repair form. */
      readonly blockers?: readonly GeoKbBlocker[];
    }
  | { readonly kind: "saved"; readonly at: string }
  | { readonly kind: "frozen"; readonly revision: number; readonly reused: boolean };

/**
 * Every code this page has a sentence for.
 *
 * `t()` renders an unknown key as its own path, so a code from outside this set
 * would print `errors.something` where the explanation belongs. That is how
 * `not_ready` reached production: it was unreachable by accident, and the
 * accident ended.
 */
const ERROR_CODES: ReadonlySet<string> = new Set([
  "auth_required",
  "auth_unavailable",
  "cross_origin",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "invalid_url",
  "invalid_payload",
  "conflict",
  "conflict_unknown",
  "context_stale",
  "profile_copy_required",
  "website_required",
  "hash_mismatch",
  "not_found",
  "no_draft",
  "not_ready",
  "store_unavailable",
  "network",
  "bad_response",
  "schema_mismatch",
  "form_invalid",
]);

/** The write contract's rejection codes, each with a sentence of its own. */
const REJECTION_REASONS: ReadonlySet<string> = new Set<GeoKbRejection>([
  "not_an_object",
  "schema_version",
  "target_url",
  "official_name",
  "aliases",
  "category_terms",
  "market",
  "roles",
  "competitors",
  "facts",
  "imported_from",
  "profile_copy",
  "too_large",
  "control_characters",
]);

const NO_ROW_ISSUES: GeoKbRowIssues = {
  competitors: new Map(),
  facts: new Map(),
};

type Translate = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One error, in words, or the one sentence that admits we have none.
 *
 * `reason` used to be printed raw, so a refused save put the identifier
 * `competitors` on the page - the name of a field in a language the visitor
 * never chose.
 */
function errorMessage(t: Translate, status: Extract<Status, { kind: "error" }>) {
  if (status.code === "invalid_payload") {
    const reason = status.reason ?? "";
    return REJECTION_REASONS.has(reason)
      ? t("errors.invalid_payload", { reason: t(`errors.reasons.${reason}`) })
      : t("errors.unknown");
  }
  return ERROR_CODES.has(status.code)
    ? t(`errors.${status.code}`)
    : t("errors.unknown");
}

function ChipsField({
  label,
  help,
  values,
  max,
  onChange,
}: {
  readonly label: string;
  readonly help: string;
  readonly values: readonly string[];
  readonly max: number;
  readonly onChange: (next: readonly string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const commit = useCallback(() => {
    const cleaned = text.trim();
    if (cleaned.length === 0 || values.includes(cleaned)) return;
    if (values.length >= max) return;
    onChange([...values, cleaned]);
    setText("");
  }, [max, onChange, text, values]);

  return (
    <div>
      <Label htmlFor={id} className="text-[14px] text-text-dark-primary">{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-border-card bg-brand-bg px-2.5 py-1 text-[13px] text-text-dark-primary"
            key={value}
          >
            {value}
            <Button variant="outline"
              aria-label={`${label}: ${value}`}
              className="text-text-dark-secondary"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              type="button"
            >
              x
            </Button>
          </span>
        ))}
      </div>
      <Input
        id={id} name={id} autoComplete="off" aria-describedby={`${id}-help`} className="mt-3"
        maxLength={GEO_KB_LIMITS.listItem}
        // Committing on comma would empty the box under the cursor mid-word.
        // Enter and blur are both deliberate acts; typing is not.
        onBlur={commit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
        value={text}
      />
      <p id={`${id}-help`} className="mt-2 text-[13px] leading-relaxed text-text-dark-secondary">
        {help}
      </p>
    </div>
  );
}

function TextField({
  label,
  help,
  placeholder,
  value,
  onChange,
  readOnly = false,
  maxLength = GEO_KB_LIMITS.text,
}: {
  readonly label: string;
  readonly help?: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly readOnly?: boolean;
  readonly maxLength?: number;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="text-[14px] text-text-dark-primary">{label}</Label>
      <Input
        id={id} name={id} autoComplete="off" readOnly={readOnly} className="mt-3"
        aria-describedby={help === undefined ? undefined : `${id}-help`}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {help === undefined ? null : (
        <p id={`${id}-help`} className="mt-2 text-[13px] leading-relaxed text-text-dark-secondary">
          {help}
        </p>
      )}
    </div>
  );
}

export function GeoKnowledgeBase({
  locale,
  signedIn,
  initialView,
  initialUrl,
  canonicalWebsiteId,
  profileState,
  inline = false,
  confirmedProfileRevision,
}: {
  readonly locale: string;
  readonly signedIn: boolean;
  readonly initialView?: GeoKbView;
  readonly initialUrl?: string;
  readonly canonicalWebsiteId?: string;
  readonly profileState?: string;
  readonly inline?: boolean;
  readonly confirmedProfileRevision?: number;
}) {
  const t = useTranslations("tools.geoKnowledgeBase");
  // Initial data is adopted only on mount, never synchronized over unsaved edits.
  const [siteUrl, setSiteUrl] = useState(initialUrl ?? "");
  const [view, setView] = useState<GeoKbView | null>(initialView ?? null);
  const [payload, setPayload] = useState<GeoKbPayload | null>(initialView?.payload ?? null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [questions, setQuestions] = useState<
    readonly GeoKbQuestionPreview[] | null
  >(initialView?.frozen?.questions ?? null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copyProposal, setCopyProposal] = useState<GeoProfileCopy | null>(null);
  const [parentSourceSignal, setParentSourceSignal] = useState({ revision: confirmedProfileRevision, sequence: 0 });
  const [reviewedParentSequence, setReviewedParentSequence] = useState(0);
  if (parentSourceSignal.revision !== confirmedProfileRevision) {
    // Track observed transitions, including returning to an older deduplicated
    // snapshot. Comparing only revision values would lose an A → B → A change.
    setParentSourceSignal({ revision: confirmedProfileRevision, sequence: parentSourceSignal.sequence + 1 });
  }
  const editRevision = useRef(0);
  const copyRequired = (canonicalWebsiteId !== undefined || view?.profile != null) && payload?.profileCopy === undefined;
  const sourceCopy = payload?.profileCopy;
  const copyStale = sourceCopy !== undefined && (
    // The upper editor is a source-change signal, not a permanent authority
    // over a newer version explicitly read from the server in another tab.
    parentSourceSignal.sequence !== reviewedParentSequence ||
    (view?.profile != null && (sourceCopy.snapshotId !== view.profile.reference.snapshotId || sourceCopy.profileHash !== view.profile.reference.profileHash))
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const repairInitialized = useRef(false);
  const [repair, setRepair] = useState<GeoKnowledgeRepair | null>(null);
  const [repairInvalid, setRepairInvalid] = useState(false);
  const [repairFrozen, setRepairFrozen] = useState<{ snapshotId: string; draftVersion: number } | null>(null);
  const [repairQuestionId, setRepairQuestionId] = useState<string | null>(null);
  const [returnStorageError, setReturnStorageError] = useState(false);
  /**
   * Whether a save has been attempted since this knowledge base was loaded.
   *
   * Row problems appear after the visitor asks to save, not while they are
   * still typing the row: a half-written fact is not a mistake yet.
   */
  const [showRowIssues, setShowRowIssues] = useState(false);

  /**
   * What actually goes on the wire, and what the freeze gate is computed from.
   *
   * Trimmed and with untouched rows dropped. Both are derived rather than
   * stored, so neither can be left over from the previous site.
   */
  const submission = useMemo(
    () => (payload === null ? null : geoKbSubmission(payload)),
    [payload],
  );
  const rowIssues = useMemo(
    () => (payload === null ? NO_ROW_ISSUES : geoKbRowIssues(payload)),
    [payload],
  );
  const missingRepairPrimaryCategory = repair !== null && payload !== null &&
    (payload.categoryTerms[0]?.trim().length ?? 0) === 0;
  /**
   * One judgement of what still blocks a freeze, computed by the function the
   * server freezes with.
   *
   * This page used to keep its own copy of the list. The two agreed by
   * coincidence and stopped agreeing the moment a sixth blocker was added
   * server-side: the button stayed live, the freeze came back 422, and the code
   * had no sentence on this side.
   */
  const blockers = useMemo<readonly GeoKbBlocker[]>(
    () => {
      const current = submission === null ? [] : geoKbBlockers(submission, {
        roleLayersSkipped: view?.context?.skippedLayers.includes("problem") === true &&
          view.context.skippedLayers.includes("evaluation"),
        ...(view?.context?.activeRoleIds === undefined ? {} : { activeRoleIds: view.context.activeRoleIds }),
      });
      return missingRepairPrimaryCategory && !current.includes("category_terms_missing")
        ? ["category_terms_missing", ...current] : current;
    },
    [missingRepairPrimaryCategory, submission, view?.context],
  );

  const post = useCallback(
    async (
      url: string,
      body: unknown,
    ): Promise<
      | { readonly ok: true; readonly data: unknown }
      | {
          readonly ok: false;
          readonly code: string;
          readonly reason?: string;
          readonly blockers?: readonly GeoKbBlocker[];
          /** The version the server says is current, when it named one. */
          readonly draftVersion?: number;
        }
    > => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        return { ok: false, code: "network" };
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        // A gateway timeout answers in HTML. Folded into `network` it reads as
        // "the request did not reach the tool", which sends the visitor to
        // check a connection that is working - and hides that a 502 may have
        // arrived after the write, not before it.
        return { ok: false, code: "bad_response" };
      }
      const record = isRecord(parsed) ? parsed : {};
      if (response.ok) {
        return record["data"] === undefined
          ? { ok: false, code: "schema_mismatch" }
          : { ok: true, data: record["data"] };
      }
      const error = record["error"];
      const code =
        isRecord(error) && typeof error["code"] === "string"
          ? error["code"]
          : "schema_mismatch";
      const reason =
        typeof record["reason"] === "string" ? record["reason"] : undefined;
      const blockers = isGeoKbBlockers(record["blockers"])
        ? record["blockers"]
        : undefined;
      const draftVersion =
        typeof record["draftVersion"] === "number" &&
        Number.isSafeInteger(record["draftVersion"])
          ? record["draftVersion"]
          : undefined;
      return {
        ok: false,
        code,
        ...(reason === undefined ? {} : { reason }),
        ...(blockers === undefined ? {} : { blockers }),
        ...(draftVersion === undefined ? {} : { draftVersion }),
      };
    },
    [],
  );

  /**
   * Take the version the server says is current, so the next attempt can win.
   *
   * Without this one line a single 409 is permanent: the page keeps sending the
   * version it loaded with, the server keeps refusing it, and the only control
   * that refreshes the number is "switch site", which throws away every unsaved
   * edit. The edits stay exactly where they are; only the version moves.
   *
   * A negative marker is not a version. The store sends one when its RPC did
   * not report a current draft, and sending it back is a 400, so that case gets
   * its own sentence rather than a second identical failure.
   */
  const adoptConflictVersion = useCallback(
    (draftVersion: number | undefined): "adopted" | "unknown" => {
      if (draftVersion === undefined || draftVersion < 0) return "unknown";
      setView((current) =>
        current === null ? current : { ...current, draftVersion },
      );
      return "adopted";
    },
    [],
  );

  const adoptLoaded = useCallback((next: GeoKbView) => {
    // Everything reset here belongs to a site rather than to the page. A value
    // carried across meant the previous site's blockers stayed on screen with
    // the freeze button live beside them; the list is derived now, and the rest
    // of the set is reset together because that is how it goes wrong.
    setView(next);
    setPayload(next.payload);
    setQuestions(next.frozen?.questions ?? null);
    setShowQuestions(false);
    setShowRowIssues(false);
    setDirty(false);
    setStatus({ kind: "idle" });
  }, []);

  const load = useCallback(async () => {
    const url = siteUrl.trim();
    if (url.length === 0) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.load, { url });
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    if (!isGeoKbView(result.data)) {
      setStatus({ kind: "error", code: "schema_mismatch" });
      return;
    }
    adoptLoaded(result.data);
  }, [adoptLoaded, post, siteUrl]);

  const loadRepair = useCallback(async (context: GeoKnowledgeRepair) => {
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.load, { kbId: context.kbId });
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    if (!isGeoKbView(result.data) || result.data.kbId !== context.kbId) {
      setStatus({ kind: "error", code: "schema_mismatch" });
      return;
    }
    setSiteUrl(result.data.origin);
    adoptLoaded(result.data);
  }, [adoptLoaded, post]);

  useEffect(() => {
    if (!signedIn || initialView !== undefined || canonicalWebsiteId !== undefined || repairInitialized.current) return;
    repairInitialized.current = true;
    try {
      const context = consumeGeoKnowledgeRepair(window.sessionStorage);
      if (context === null) {
        setRepairInvalid(new URLSearchParams(window.location.search).get("repair") === "brief");
        return;
      }
      setRepair(context);
      void loadRepair(context);
    } catch {
      setRepairInvalid(true);
    }
  }, [canonicalWebsiteId, initialView, loadRepair, signedIn]);

  useEffect(() => {
    if (repair === null || (!dirty && status.kind !== "busy")) return;
    if (dirty) setRepairQuestionId(null);
    try { window.sessionStorage.removeItem(GEO_BRIEF_RETURN_KEY); } catch { /* A new return still requires a successful storage write. */ }
  }, [dirty, repair, status.kind]);

  const save = useCallback(async () => {
    if (view === null || submission === null) return;
    if (missingRepairPrimaryCategory) {
      setStatus({ kind: "error", code: "not_ready", blockers: ["category_terms_missing"] });
      return;
    }
    if (hasGeoKbRowIssues(rowIssues)) {
      // Nothing is sent, so nothing else in this save is lost. The rows the
      // write contract would refuse are marked where they are, instead of the
      // whole payload coming back 400 with one field name on it.
      setShowRowIssues(true);
      setStatus({ kind: "error", code: "form_invalid" });
      return;
    }
    const savedEditRevision = editRevision.current;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.draft, {
      kbId: view.kbId,
      payload: submission,
      baseVersion: view.draftVersion,
      ...(view.profile === undefined ? {} : { expectedProfileReference: view.profile?.reference ?? null }),
    });
    if (!result.ok) {
      if (result.code === "conflict") {
        const outcome = adoptConflictVersion(result.draftVersion);
        setStatus({
          kind: "error",
          code: outcome === "adopted" ? "conflict" : "conflict_unknown",
        });
        return;
      }
      setStatus({
        kind: "error",
        code: result.code,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
      return;
    }
    if (!isGeoKbSaveResponse(result.data)) {
      setStatus({ kind: "error", code: "schema_mismatch" });
      return;
    }
    const data = result.data;
    // The saved copy is what was sent, not what is in the boxes: an untouched
    // row is still on screen and is deliberately not in the draft.
    setView({ ...view, draftVersion: data.draftVersion, payload: submission,
      ...(data.context === undefined ? {} : { context: data.context }),
    });
    // The response acknowledges only the submitted edit, not later typing.
    setDirty(editRevision.current !== savedEditRevision);
    setStatus({ kind: "saved", at: data.updatedAt });
  }, [adoptConflictVersion, missingRepairPrimaryCategory, post, rowIssues, submission, view]);

  const freeze = useCallback(async () => {
    if (view === null) return;
    if (missingRepairPrimaryCategory) {
      setStatus({ kind: "error", code: "not_ready", blockers: ["category_terms_missing"] });
      return;
    }
    const frozenEditRevision = editRevision.current;
    setRepairFrozen(null);
    setRepairQuestionId(null);
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.freeze, {
      kbId: view.kbId,
      baseVersion: view.draftVersion,
      ...(view.context === undefined ? {} : { contextHash: view.context.contentHash }),
    });
    if (!result.ok) {
      if (result.code === "conflict") {
        const outcome = adoptConflictVersion(result.draftVersion);
        // Someone else's draft is now the stored one, so freezing next would
        // freeze their text under this page's heading. Marking the editor
        // unsaved forces the save that makes the two the same thing again.
        setDirty(true);
        setStatus({
          kind: "error",
          code: outcome === "adopted" ? "conflict" : "conflict_unknown",
        });
        return;
      }
      setStatus({
        kind: "error",
        code: result.code,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.blockers === undefined ? {} : { blockers: result.blockers }),
      });
      return;
    }
    if (!isGeoKbFreezeResponse(result.data)) {
      setStatus({ kind: "error", code: "schema_mismatch" });
      return;
    }
    const data = result.data;
    setView({
      ...view,
      frozen: {
        snapshotId: data.snapshotId,
        revision: data.revision,
        frozenAt: data.frozenAt,
        contentHash: data.contentHash,
        questionCount: data.questionCount,
        retrievalCount: data.retrievalCount,
        ...(data.payload === undefined ? {} : { payload: data.payload }),
        ...(data.questionSetHash === undefined ? {} : { questionSetHash: data.questionSetHash }),
        ...(data.registryVersion === undefined ? {} : { registryVersion: data.registryVersion }),
        ...(data.skippedLayers === undefined ? {} : { skippedLayers: data.skippedLayers }),
        questions: data.questions,
      },
      ...(data.context === undefined ? {} : { context: data.context }),
    });
    setQuestions(data.questions);
    if (repair !== null && view.kbId === repair.kbId && data.snapshotId !== repair.snapshotId && editRevision.current === frozenEditRevision) {
      setRepairFrozen({ snapshotId: data.snapshotId, draftVersion: view.draftVersion });
    }
    setStatus({
      kind: "frozen",
      revision: data.revision,
      reused: data.reusedExisting,
    });
  }, [adoptConflictVersion, missingRepairPrimaryCategory, post, repair, view]);

  const prefill = useCallback(async () => {
    if (view === null) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.import, { kbId: view.kbId });
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    if (!isGeoKbImportResponse(result.data)) {
      setStatus({ kind: "error", code: "schema_mismatch" });
      return;
    }
    setPayload(result.data.payload);
    setDirty(true);
    setStatus({ kind: "idle" });
  }, [post, view]);

  const update = useCallback((next: Partial<GeoKbPayload>) => {
    editRevision.current += 1;
    setRepairFrozen(null);
    setRepairQuestionId(null);
    setReturnStorageError(false);
    setPayload((current) =>
      current === null ? current : { ...current, ...next },
    );
    setDirty(true);
  }, []);

  const genericCategory = useMemo(() => {
    const first = payload?.categoryTerms[0]?.toLowerCase().trim() ?? "";
    return ["tool", "tools", "software", "platform", "platforms", "app", "apps"].includes(
      first,
    );
  }, [payload]);

  const reloadSources = useCallback(async () => {
    if (view === null) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.load, repair === null ? { url: view.origin } : { kbId: repair.kbId });
    if (!result.ok) { setStatus({ kind: "error", code: result.code }); return; }
    if (!isGeoKbView(result.data) || result.data.kbId !== view.kbId) {
      setStatus({ kind: "error", code: "schema_mismatch" }); return;
    }
    setView(result.data);
    setQuestions(result.data.frozen?.questions ?? null);
    // Refresh references only; keep local edits for an explicit save/review.
    setDirty(true);
    setStatus({ kind: "idle" });
  }, [post, repair, view]);

  const canReturnVersion = repair !== null && view?.kbId === repair.kbId && repairFrozen !== null &&
    view.frozen?.snapshotId === repairFrozen.snapshotId && view.draftVersion === repairFrozen.draftVersion &&
    !dirty && status.kind !== "busy" && status.kind !== "error";
  const retainedQuestionId = questions?.find((question) => question.id === repair?.questionId)?.id ?? null;
  const returnQuestionId = retainedQuestionId ?? questions?.find((question) => question.id === repairQuestionId)?.id ?? null;
  const needsReplacementQuestion = repair !== null && repair.questionId !== null && retainedQuestionId === null;
  const canReturn = canReturnVersion && (repair?.questionId === null || returnQuestionId !== null);
  const originalQuestion = repair?.manualQuestion ?? (view?.frozen?.snapshotId === repair?.snapshotId
    ? view?.frozen?.questions?.find((question) => question.id === repair?.questionId)?.text : undefined);

  const reviewProfileCopy = useCallback(async () => {
    if (view === null) return;
    setStatus({ kind: "busy" });
    const result = await post(ENDPOINTS.load, { url: view.origin });
    if (!result.ok) { setStatus({ kind: "error", code: result.code }); return; }
    if (!isGeoKbView(result.data) || result.data.kbId !== view.kbId ||
        result.data.profile?.fullProfile === undefined ||
        (canonicalWebsiteId !== undefined && result.data.profile.reference.websiteId !== canonicalWebsiteId)) {
      setStatus({ kind: "error", code: "schema_mismatch" }); return;
    }
    try {
      const sourceProfile = result.data.profile;
      const proposal = createGeoProfileCopy(sourceProfile.reference, sourceProfile.fullProfile!);
      // Only source metadata changes. The draft and its CAS version are not a live mirror.
      setView(current => current === null ? null : { ...current, profile: sourceProfile });
      setReviewedParentSequence(parentSourceSignal.sequence);
      setCopyProposal(proposal);
      setStatus({ kind: "idle" });
    } catch { setStatus({ kind: "error", code: "schema_mismatch" }); }
  }, [canonicalWebsiteId, parentSourceSignal.sequence, post, view]);

  /**
   * One error line, and the list that belongs to it.
   *
   * The blockers arrive with a refused freeze rather than being read off this
   * page's own state, so a 422 states which items the server was looking at
   * even if this page would have computed a different list.
   */
  const errorLine =
    status.kind !== "error" ? null : (
      <div className="mt-4 grid gap-2" role="alert">
        <p className="text-[13.5px] text-brand-error">
          {errorMessage(t, status)}
        </p>
        {status.code !== "context_stale" || view === null ? null : <Button variant="outline"
          className="justify-self-start rounded-lg border border-brand-border-card px-3 py-2 text-sm text-brand-accent-text"
          type="button" onClick={() => void reloadSources()}>{t("asset.reloadSources")}</Button>}
        {status.code !== "website_required" ? null : <a
          className="justify-self-start text-sm text-brand-accent-text underline"
          href={`/${locale}/account/websites`}>{t("asset.backToWebsites")}</a>}
        {status.blockers === undefined || status.blockers.length === 0 ? null : (
          <ul className="grid gap-1.5">
            {status.blockers.map((blocker) => (
              <li
                className="text-[13px] text-text-dark-secondary"
                key={blocker}
              >
                {t(`freeze.blockers.${blocker}`)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  if (!signedIn) {
    return (
      <section className="mt-10 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
        <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
          {t("signIn.title")}
        </h2>
        <p className="mt-3 max-w-[640px] text-[14px] leading-[1.7] text-text-dark-secondary">
          {t("signIn.body")}
        </p>
      </section>
    );
  }

  return (
    <div className={inline ? "grid gap-8" : "mt-10 grid gap-8"} data-confirmed-profile-revision={confirmedProfileRevision}>
      <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
        <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">{t(repair !== null || repairInvalid ? "repair.title" : "site.title")}</h2>
        {repairInvalid ? <div className="mt-4 grid gap-3">
          <p role="alert" className="text-sm text-brand-error">{t("repair.invalid")}</p>
          <a className="justify-self-start text-sm text-brand-accent-text underline" href={localePath(locale, "/tools/geo-brief")}>{t("repair.backToBrief")}</a>
        </div> : null}
        {repair === null ? null : <div className="mt-4 grid gap-3 text-sm text-text-dark-secondary" data-geo-knowledge-repair>
          {view === null ? <>
            <p>{t(status.kind === "busy" ? "repair.loading" : "repair.loadError")}</p>
            <div className="flex flex-wrap gap-4">
              <button className="rounded-lg border border-brand-border-card px-3 py-2 text-brand-accent-text disabled:opacity-60"
                type="button" disabled={status.kind === "busy"} onClick={() => void loadRepair(repair)}>{t("repair.retry")}</button>
              <a className="self-center text-brand-accent-text underline" href={localePath(locale, "/tools/geo-brief")}>{t("repair.backToBrief")}</a>
            </div>
          </> : <>
            <p>{t("repair.intro", { host: view.host })}</p>
            <p>{t(`repair.reason.${repair.reason}`)}</p>
            <p>{originalQuestion ? t("repair.question", { question: originalQuestion }) : t("repair.questionChanged")}</p>
            <ol className="grid gap-2 text-brand-accent-text">
              <li><a className="underline" href="#kb-repair-category">{t("repair.steps.category")}</a></li>
              <li><a className="underline" href="#kb-repair-facts">{t("repair.steps.facts")}</a>{view.profile === undefined ? null : <>{" · "}<a className="underline" href="#kb-repair-profile">{t("asset.profileTitle")}</a></>}</li>
              <li><a className="underline" href="#kb-repair-freeze">{t("repair.steps.freeze")}</a></li>
            </ol>
            <p>{t("repair.profileHelp")}</p>
          </>}
        </div>}
        {canonicalWebsiteId === undefined && repair === null && !repairInvalid ? <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
          <div>
            <label
              className="block text-[13px] text-text-dark-secondary"
              htmlFor="kb-site-url"
            >
              {t("site.urlLabel")}
            </label>
            <Input
              className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
              id="kb-site-url"
              inputMode="url"
              maxLength={2_048}
              onChange={(event) => setSiteUrl(event.target.value)}
              placeholder={t("site.urlPlaceholder")}
              value={siteUrl}
            />
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {t("site.urlHelp")}
            </p>
          </div>
          <Button variant="outline"
            className="mt-6 rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60"
            disabled={status.kind === "busy"}
            onClick={() => {
              void load();
            }}
            type="button"
          >
            {view === null ? t("site.start") : t("site.switch")}
          </Button>
        </div>
        : null}
        {view === null ? null : (
          <p className="mt-4 text-[13px] leading-[1.7] text-text-dark-secondary">
            {t("site.loaded", { host: view.host, origin: view.origin })}
          </p>
        )}
        {errorLine}
      </section>

      {view !== null && payload !== null ? (
        // Keyed on the knowledge base, so switching sites remounts the editor.
        // The state that belongs to a site is not all held here: `ChipsField`
        // keeps the half-typed chip in the box, and without this the alias
        // someone was in the middle of writing for one site reappears under
        // the next one.
        <Fragment key={view.kbId}>
          {view.profile !== undefined || canonicalWebsiteId !== undefined ? (
            <div id="kb-repair-profile" className="scroll-mt-24"><GeoKbInheritedProfile profile={view.profile ?? null} locale={locale}
              {...(payload.profileCopy === undefined ? {} : { copy: payload.profileCopy })} inline={inline} repairMode={repair !== null}
              facts={payload.facts} onAddFact={(key, value) => {
                const candidate = pendingGeoProfileFact(key, value, payload.facts);
                if (candidate.status === "ready") {
                  update({ facts: [...payload.facts, candidate.fact] });
                  window.requestAnimationFrame?.(() => document.getElementById("kb-repair-facts")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
                }
              }}
              {...(canonicalWebsiteId === undefined ? {} : { websiteId: canonicalWebsiteId })}
              {...(profileState === undefined ? {} : { profileState })} /></div>
          ) : <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
            <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
              {t("site.importTitle")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("site.importBody")}
            </p>
            {view.importAvailable ? (
              <Button variant="outline"
                className="mt-4 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary"
                disabled={status.kind === "busy"}
                onClick={() => {
                  void prefill();
                }}
                type="button"
              >
                {t("site.importAction")}
              </Button>
            ) : (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("site.importUnavailable")}
              </p>
            )}
            {payload.importedFrom !== null ? (
              <p className="mt-3 text-[13px] text-text-dark-secondary">
                {t("site.importedFrom", {
                  revision: payload.importedFrom.snapshotRevision,
                })}
              </p>
            ) : null}
          </section>}

          {canonicalWebsiteId !== undefined || view.profile != null ? <section className="rounded-card border border-brand-border-card bg-brand-panel px-5 py-5 sm:px-7">
            {copyRequired || copyStale || view.draftVersion === 0 ? <p role="status" className="mb-4 text-[13px] leading-relaxed text-text-dark-secondary">{t(copyRequired ? "asset.copyMissing" : copyStale ? "asset.copyStale" : "asset.copyPending")}</p> : null}
            <Button type="button" variant="outline" disabled={status.kind === "busy"} onClick={() => void reviewProfileCopy()}>{t("asset.reviewCopy")}</Button>
          </section> : null}
          {copyProposal === null ? null : <GeoProfileCopyReview current={payload.profileCopy} proposal={copyProposal}
            disabled={status.kind === "busy"} onDismiss={() => setCopyProposal(null)} onApply={() => {
              update({ profileCopy: copyProposal });
              setCopyProposal(null);
            }} />}

          {payload.profileCopy === undefined ? null : <GeoKbMeasurementReview key={`${payload.profileCopy.snapshotId}:${payload.profileCopy.profileHash}`} profile={payload.profileCopy.profile} payload={payload} disabled={status.kind === "busy"} onApply={next => update(next)} />}

          <GeoKbEnrichment kbId={view.kbId} targetHost={view.host.replace(/^www\./u, "")}
            draftVersion={view.draftVersion} payload={payload} dirty={dirty || status.kind === "busy"}
            onApply={(next) => update(next)} />

          <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
            <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
              {t("brand.title")}
            </h2>
            <div className="mt-5 grid gap-5">
              <TextField
                help={t(payload.profileCopy?.profile.productName === payload.officialName ? "asset.baseNameReadOnly" : view.profile == null ? "brand.officialNameHelp" : "asset.officialNameHelp")}
                label={t(payload.profileCopy !== undefined && payload.profileCopy.profile.productName !== payload.officialName ? "asset.matchingOverride" : "brand.officialNameLabel")}
                readOnly={payload.profileCopy?.profile.productName === payload.officialName}
                onChange={(value) => update({ officialName: value })}
                placeholder={t("brand.officialNamePlaceholder")}
                value={payload.officialName}
              />
              <ChipsField
                help={t("brand.aliasesHelp")}
                label={t("brand.aliasesLabel")}
                max={GEO_KB_LIMITS.aliases}
                onChange={(values) => update({ aliases: values })}
                values={payload.aliases}
              />
              <div id="kb-repair-category" className="scroll-mt-24">
                {repair === null ? null : <div className="mb-5">
                  <TextField label={t("repair.primaryCategory")} help={t("repair.primaryCategoryHelp")}
                    maxLength={GEO_KB_LIMITS.listItem}
                    value={payload.categoryTerms[0] ?? ""}
                    onChange={(value) => update({ categoryTerms: [value, ...payload.categoryTerms.slice(1)] })} />
                </div>}
                <ChipsField
                  help={t("brand.categoryLanguageHelp")}
                  label={t("brand.categoryLabel")}
                  max={GEO_KB_LIMITS.categoryTerms}
                  onChange={(values) => update({ categoryTerms: values })}
                  values={payload.categoryTerms}
                />
                {genericCategory ? (
                  <p className="mt-2 text-[13px] leading-[1.7] text-brand-error">
                    {t("brand.categoryWarning")}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    className="block text-[13px] text-text-dark-secondary"
                    htmlFor="kb-country"
                  >
                    {t("brand.countryLabel")}
                  </label>
                  <select
                    className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                    id="kb-country"
                    onChange={(event) =>
                      update({
                        market: {
                          country: event.target.value,
                          language: payload.market.language,
                        },
                      })
                    }
                    value={payload.market.country}
                  >
                    {(COUNTRIES.some((country) => country === payload.market.country)
                      ? COUNTRIES
                      : [payload.market.country, ...COUNTRIES]).map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] text-text-dark-secondary" htmlFor="kb-language">
                    {t("brand.languageLabel")}
                  </label>
                  <select
                    className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                    id="kb-language"
                    aria-describedby="kb-language-help kb-language-support"
                    value={payload.market.language}
                    onChange={(event) => update({ market: { ...payload.market, language: event.target.value } })}
                  >
                    {(QUESTION_LANGUAGES.some((language) => language === payload.market.language)
                      ? QUESTION_LANGUAGES
                      : [payload.market.language, ...QUESTION_LANGUAGES]).map((language) => (
                      <option key={language} value={language}>{language}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary" id="kb-language-help">
                    {t("brand.languageHelp")}
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary" id="kb-language-support">
                    {isSupportedGeoQuestionLanguage(payload.market.language)
                      ? t("brand.languageNote")
                      : t("asset.unsupportedLanguage", { language: payload.market.language })}
                  </p>
                </div>
              </div>
              {payload.profileCopy === undefined ? null : <p className="text-[13px] leading-relaxed text-text-dark-secondary">{t("asset.scopeHelp")}</p>}
            </div>
          </section>

          <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
            <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
              {t("roles.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("roles.intro")}
            </p>
            {payload.roles.length === 0 ? (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("roles.empty")}
              </p>
            ) : null}
            <div className="mt-5 grid gap-5">
              {payload.roles.map((role, index) => (
                <div
                  className="grid gap-4 rounded-lg border border-brand-border-card p-4"
                  key={role.id}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      label={t("roles.labelLabel")}
                      onChange={(value) =>
                        update({
                          roles: payload.roles.map((entry, position) =>
                            position === index
                              ? { ...entry, label: value }
                              : entry,
                          ),
                        })
                      }
                      placeholder={t("roles.labelPlaceholder")}
                      value={role.label}
                    />
                    <TextField
                      label={t("roles.segmentLabel")}
                      onChange={(value) =>
                        update({
                          roles: payload.roles.map((entry, position) =>
                            position === index
                              ? { ...entry, segment: value }
                              : entry,
                          ),
                        })
                      }
                      placeholder={t("roles.segmentPlaceholder")}
                      value={role.segment}
                    />
                  </div>
                  {(
                    [
                      ["painPoints", t("roles.painLabel")],
                      ["decisionCriteria", t("roles.criteriaLabel")],
                      ["vocabulary", t("roles.vocabularyLabel")],
                    ] as const
                  ).map(([field, label]) => (
                    <ChipsField
                      help=""
                      key={field}
                      label={label}
                      max={12}
                      onChange={(values) =>
                        update({
                          roles: payload.roles.map((entry, position) =>
                            position === index
                              ? ({ ...entry, [field]: values } as GeoKbRole)
                              : entry,
                          ),
                        })
                      }
                      values={role[field]}
                    />
                  ))}
                  <Button variant="outline"
                    className="justify-self-start text-[13px] text-text-dark-secondary underline"
                    onClick={() =>
                      update({
                        roles: payload.roles.filter(
                          (_entry, position) => position !== index,
                        ),
                      })
                    }
                    type="button"
                  >
                    {t("roles.remove")}
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline"
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
              disabled={payload.roles.length >= GEO_KB_LIMITS.roles}
              onClick={() =>
                update({
                  roles: [
                    ...payload.roles,
                    {
                      id: `role-${String(payload.roles.length + 1)}-${String(
                        Date.now(),
                      )}`,
                      label: "",
                      segment: "",
                      painPoints: [],
                      decisionCriteria: [],
                      vocabulary: [],
                    },
                  ],
                })
              }
              type="button"
            >
              {t("roles.add")}
            </Button>
          </section>

          <section className="overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
            <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
              {t("competitors.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("competitors.intro")}
            </p>
            {payload.competitors.length === 0 ? (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("competitors.empty")}
              </p>
            ) : null}
            <div className="mt-5 grid gap-4">
              {payload.competitors.map((competitor, index) => {
                const patch = (next: Partial<GeoKbCompetitor>) =>
                  update({
                    competitors: payload.competitors.map((entry, position) =>
                      position === index ? { ...entry, ...next } : entry,
                    ),
                  });
                const issue = showRowIssues
                  ? rowIssues.competitors.get(index)
                  : undefined;
                return (
                  <div
                    className={`grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end ${
                      issue === undefined
                        ? "border-brand-border-card"
                        : "border-brand-error"
                    }`}
                    // The position, not the contents. Keyed on the text being
                    // typed, every keystroke unmounted the row and took the
                    // cursor out of the box with it.
                    key={`competitor-${String(index)}`}
                  >
                    <TextField
                      label={t("competitors.domainLabel")}
                      onChange={(value) => patch({ domain: value })}
                      value={competitor.domain}
                    />
                    <TextField
                      label={t("competitors.brandLabel")}
                      onChange={(value) =>
                        patch(
                          value.trim().length === 0
                            ? // The confirmation is about the name. Clearing
                              // the name has to clear it, or the row travels as
                              // "confirmed, unnamed" and the contract refuses
                              // the whole payload over it.
                              { brandName: value, confirmed: false }
                            : { brandName: value },
                        )
                      }
                      value={competitor.brandName}
                    />
                    <label className="flex items-center gap-2 text-[13px] text-text-dark-secondary">
                      <input
                        checked={competitor.confirmed}
                        disabled={competitor.brandName.trim().length === 0}
                        onChange={(event) =>
                          patch({ confirmed: event.target.checked })
                        }
                        type="checkbox"
                      />
                      {t("competitors.confirmLabel")}
                    </label>
                    <Button variant="outline"
                      className="text-[13px] text-text-dark-secondary underline"
                      onClick={() =>
                        update({
                          competitors: payload.competitors.filter(
                            (_entry, position) => position !== index,
                          ),
                        })
                      }
                      type="button"
                    >
                    {t("competitors.remove")}
                    </Button>
                    <div className="md:col-span-4">
                      <ChipsField label={t("competitors.aliasesLabel")} help={t("competitors.aliasesHelp")}
                        values={competitor.aliases ?? []} max={10}
                        onChange={(aliases) => patch({ aliases, confirmed: false })} />
                    </div>
                    {competitor.confirmed ? null : (
                      <p className="text-[12.5px] text-text-dark-secondary md:col-span-4">
                        {t("competitors.unconfirmed")}
                      </p>
                    )}
                    {issue === undefined ? null : (
                      <p
                        className="text-[12.5px] text-brand-error md:col-span-4"
                        role="alert"
                      >
                        {t(`competitors.issues.${issue}`)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <Button variant="outline"
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
              disabled={payload.competitors.length >= GEO_KB_LIMITS.competitors}
              onClick={() =>
                update({
                  competitors: [
                    ...payload.competitors,
                    { domain: "", brandName: "", confirmed: false },
                  ],
                })
              }
              type="button"
            >
              {t("competitors.add")}
            </Button>
          </section>

          <section id="kb-repair-facts" className="scroll-mt-24 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
            <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
              {t("facts.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("facts.intro")}
            </p>
            {payload.facts.length === 0 ? (
              <p className="mt-4 text-[13px] text-text-dark-secondary">
                {t("facts.empty")}
              </p>
            ) : null}
            <div className="mt-5 grid gap-4">
              {payload.facts.map((fact, index) => {
                const patch = (next: Partial<GeoKbFact>) =>
                  update({
                    facts: payload.facts.map((entry, position) =>
                      position === index ? { ...entry, ...next } : entry,
                    ),
                  });
                const issue = showRowIssues
                  ? rowIssues.facts.get(index)
                  : undefined;
                return (
                  <div
                    className={`grid gap-3 rounded-lg border p-4 md:grid-cols-2 ${
                      issue === undefined
                        ? "border-brand-border-card"
                        : "border-brand-error"
                    }`}
                    // The position, not the fact's name: keyed on the name, the
                    // row was replaced on every keystroke.
                    key={`fact-${String(index)}`}
                  >
                    <TextField
                      label={t("facts.keyLabel")}
                      onChange={(value) => patch({ key: value })}
                      placeholder={t("facts.keyPlaceholder")}
                      value={fact.key}
                    />
                    <TextField
                      label={t("facts.valueLabel")}
                      onChange={(value) => patch({ value })}
                      value={fact.value}
                    />
                    <TextField
                      label={t("facts.sourceLabel")}
                      onChange={(value) => patch({ sourceUrl: value })}
                      value={fact.sourceUrl}
                    />
                    <TextField
                      label={t("facts.observedLabel")}
                      onChange={(value) => patch({ observedAt: value })}
                      value={fact.observedAt}
                    />
                    {fact.value.trim().length === 0 ? (
                      <div>
                        <label
                          className="block text-[13px] text-text-dark-secondary"
                          htmlFor={`kb-fact-reason-${String(index)}`}
                        >
                          {t("facts.reasonLabel")}
                        </label>
                        <select
                          aria-invalid={issue === "reasonMissing"}
                          className="mt-1.5 w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-[14.5px] text-text-dark-primary"
                          id={`kb-fact-reason-${String(index)}`}
                          onChange={(event) =>
                            patch({
                              reason: event.target.value as GeoKbFact["reason"],
                            })
                          }
                          value={fact.reason}
                        >
                          {/*
                            Named rather than "-": the empty option is the
                            state the write contract refuses, and a dash does
                            not say that choosing one is required.
                          */}
                          <option value="">
                            {t("facts.reasonPlaceholder")}
                          </option>
                          {FACT_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {t(`facts.reasons.${reason}`)}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                          {t("facts.reasonHelp")}
                        </p>
                      </div>
                    ) : null}
                    {issue === undefined ? null : (
                      <p
                        className="text-[12.5px] text-brand-error md:col-span-2"
                        role="alert"
                      >
                        {t(`facts.issues.${issue}`)}
                      </p>
                    )}
                    <Button variant="outline"
                      className="justify-self-start text-[13px] text-text-dark-secondary underline"
                      onClick={() =>
                        update({
                          facts: payload.facts.filter(
                            (_entry, position) => position !== index,
                          ),
                        })
                      }
                      type="button"
                    >
                      {t("facts.remove")}
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button variant="outline"
              className="mt-5 rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
              disabled={payload.facts.length >= GEO_KB_LIMITS.facts}
              onClick={() =>
                update({
                  facts: [
                    ...payload.facts,
                    {
                      key: "",
                      value: "",
                      reason: "",
                      sourceUrl: "",
                      observedAt: "",
                    },
                  ],
                })
              }
              type="button"
            >
              {t("facts.add")}
            </Button>
          </section>

          <section id="kb-repair-freeze" className="scroll-mt-24 overflow-hidden rounded-card border border-brand-border-strong bg-brand-panel px-5 py-5 sm:px-7">
            <h2 className="-mx-5 -mt-5 mb-5 border-b border-brand-border-card bg-brand-panel-raised px-5 py-5 text-[17px] font-semibold text-text-dark-primary sm:-mx-7 sm:px-7">
              {t("freeze.title")}
            </h2>
            <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.7] text-text-dark-secondary">
              {t("freeze.intro")}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="outline"
                className="rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary disabled:opacity-60"
                disabled={status.kind === "busy"}
                onClick={() => {
                  void save();
                }}
                type="button"
              >
                {status.kind === "busy" ? t("draft.saving") : t("draft.save")}
              </Button>
              <Button variant="outline"
                className="rounded-lg bg-brand-accent px-4 py-2 text-[14px] font-medium text-brand-on-accent disabled:opacity-60"
                disabled={
                  status.kind === "busy" || blockers.length > 0 || dirty || copyRequired || copyStale || view.draftVersion === 0
                }
                onClick={() => {
                  void freeze();
                }}
                type="button"
              >
                {t("freeze.action")}
              </Button>
              {dirty ? (
                <span className="text-[13px] text-text-dark-secondary">
                  {t("draft.unsaved")}
                </span>
              ) : null}
              {status.kind === "saved" && !dirty ? (
                <span className="text-[13px] text-text-dark-secondary">
                  {t("draft.saved", {
                    time: new Intl.DateTimeFormat(
                      locale === "zh" ? "zh-CN" : "en-GB",
                      { timeStyle: "short", timeZone: "UTC" },
                    ).format(new Date(status.at)),
                  })}
                </span>
              ) : null}
            </div>

            {repair === null ? null : <div className="mt-5 grid gap-2 border-t border-brand-border-card pt-5">
              {repairFrozen === null || !needsReplacementQuestion ? null : <div className="grid gap-2">
                <p id="kb-repair-question-missing" className="text-sm text-text-dark-secondary">{t("repair.questionRemoved")}</p>
                <label htmlFor="kb-repair-question" className="text-sm text-text-dark-primary">{t("repair.chooseQuestion")}</label>
                <select id="kb-repair-question" aria-describedby="kb-repair-question-missing" required
                  className="w-full rounded-lg border border-brand-border-card bg-brand-bg px-3 py-2 text-sm text-text-dark-primary"
                  disabled={!canReturnVersion} value={repairQuestionId ?? ""}
                  onChange={(event) => {
                    setRepairQuestionId(event.target.value || null);
                    setReturnStorageError(false);
                    try { window.sessionStorage.removeItem(GEO_BRIEF_RETURN_KEY); } catch { /* Returning requires a fresh successful write. */ }
                  }}>
                  <option value="">{t("repair.chooseQuestionPlaceholder")}</option>
                  {(questions ?? []).map((question) => <option key={question.id} value={question.id}>{question.text}</option>)}
                </select>
              </div>}
              <a data-geo-brief-return aria-disabled={!canReturn} tabIndex={canReturn ? undefined : -1}
                href={canReturn ? `${localePath(locale, "/tools/geo-brief")}?resume=knowledge` : undefined}
                className={`justify-self-start rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-brand-on-accent ${canReturn ? "" : "cursor-not-allowed opacity-60"}`}
                onClick={(event) => {
                  if (!canReturn || view.frozen === null) { event.preventDefault(); return; }
                  const questionId = repair.questionId === null ? null : returnQuestionId;
                  let written = false;
                  try {
                    written = writeGeoBriefReturn(window.sessionStorage, { kbId: view.kbId, snapshotId: view.frozen.snapshotId,
                      questionId, manualQuestion: repair.questionId === null ? repair.manualQuestion : null });
                  } catch { /* Access to sessionStorage itself may be denied. */ }
                  if (!written) { event.preventDefault(); setReturnStorageError(true); }
                }}>{t("repair.return")}</a>
              <p className="text-sm text-text-dark-secondary">{t(canReturnVersion ? "repair.returnHelp" : repairFrozen === null ? "repair.beforeFreeze" : "repair.returnBlocked")}</p>
              {returnStorageError ? <p role="alert" className="text-sm text-brand-error">{t("repair.storageError")}</p> : null}
            </div>}

            {blockers.length > 0 ? (
              <div className="mt-4">
                <p className="text-[13.5px] text-text-dark-primary">
                  {t("freeze.blocked")}
                </p>
                <ul className="mt-2 grid gap-1.5">
                  {blockers.map((blocker) => (
                    <li
                      className="text-[13px] text-text-dark-secondary"
                      key={blocker}
                    >
                      {t(`freeze.blockers.${blocker}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {view.context === undefined ? null : <p className="mt-4 text-[13px] text-text-dark-secondary">
              {view.context.skippedLayers.length === 0 ? t("freeze.draftPolicyComplete") : t("freeze.draftPolicy", {
                layers: view.context.skippedLayers.map((layer) => t(`questions.layers.${layer}`)).join(", "),
              })}
            </p>}

            {errorLine}

            <div className="mt-5 grid gap-2 text-[13px] text-text-dark-secondary">
              {view.frozen === null ? (
                <p>{t("freeze.none")}</p>
              ) : (
                <>
                  <p>
                    {t("freeze.current", {
                      revision: view.frozen.revision,
                      time: new Intl.DateTimeFormat(
                        locale === "zh" ? "zh-CN" : "en-GB",
                        { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" },
                      ).format(new Date(view.frozen.frozenAt)),
                    })}
                  </p>
                  <p>
                    {t("freeze.questions", {
                      count: view.frozen.questionCount,
                      retrieval: view.frozen.retrievalCount,
                    })}
                  </p>
                  <p className="break-all font-mono text-xs">{t("freeze.contentHash", { hash: view.frozen.contentHash })}</p>
                  {view.frozen.questionSetHash === undefined ? null : <p className="break-all font-mono text-xs">{t("freeze.questionSetHash", { hash: view.frozen.questionSetHash })}</p>}
                  {view.frozen.registryVersion === undefined ? null : <p>{t("freeze.registry", { version: view.frozen.registryVersion })}</p>}
                  {view.frozen.skippedLayers === undefined || view.frozen.skippedLayers.length === 0 ? null : <p>{t("freeze.frozenSkipped", {
                    layers: view.frozen.skippedLayers.map((layer) => t(`questions.layers.${layer}`)).join(", "),
                  })}</p>}
                </>
              )}
              {status.kind === "frozen" && status.reused ? (
                <p>{t("freeze.reused", { revision: status.revision })}</p>
              ) : null}
            </div>
            {view.frozen === null ? null : <GeoKbFrozenCopy payload={view.frozen.payload} locale={locale} revision={view.frozen.revision} />}

            {questions !== null ? (
              <div className="mt-5">
                <Button variant="outline"
                  className="rounded-lg border border-brand-border-card px-3 py-1.5 text-[13px] text-text-dark-primary"
                  onClick={() => setShowQuestions((current) => !current)}
                  type="button"
                >
                  {showQuestions ? t("freeze.hidePreview") : t("freeze.preview")}
                </Button>
                {showQuestions ? (
                  <div className="mt-4">
                    <p className="text-[12.5px] leading-[1.7] text-text-dark-secondary">
                      {t("questions.modeNote")}
                    </p>
                    <ul className="mt-3 grid gap-3">
                      {questions.map((question) => (
                        <li
                          className="grid gap-1 border-b border-brand-border-card pb-3 last:border-b-0"
                          key={question.id}
                        >
                          <span className="text-[14px] text-text-dark-primary">
                            {question.text}
                          </span>
                          <span className="text-[12.5px] text-text-dark-secondary">
                            {t(`questions.layers.${question.layer}`)} ·{" "}
                            {t(`questions.modes.${question.mode}`)}
                            {question.calibrated
                              ? ""
                              : ` · ${t("questions.uncalibrated")}`}
                          </span>
                          {question.roleId == null ? null : (
                            <span className="text-[12.5px] text-text-dark-secondary">
                              {t("questions.role", { role: question.roleId })}
                            </span>
                          )}
                          {question.requiredEntities === undefined ? null : (
                            <span className="text-[12.5px] text-text-dark-secondary">
                              {t("questions.entities", { entities: question.requiredEntities.join(", ") })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </Fragment>
      ) : null}

      <p className="sr-only">{GEO_KB_SCHEMA_VERSION}</p>
    </div>
  );
}
