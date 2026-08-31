// @input  -- locale, one-time handoff, confirmed SEO v2/shared GEO v1.1/legacy SEO v1 JSON,
//            and authenticated draft APIs; legacy GEO reports and unconfirmed v2 get guidance
// @output -- version-specific intake/workflow, session-first generation and guarded sign-in recovery
// @pos    -- primary client surface for the Marketing Content Draft Writer; no v2-to-v1 coercion

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DRAFT_RESULT_SCHEMA,
  type DraftResult,
} from "@sf/public-tools/content-brief/contract";
import {
  DRAFT_REQUEST_MAX_BYTES,
  DRAFT_TOTAL_BUDGET_MS,
  SECTION_ENDPOINT_BUDGET_MS,
  SECTION_REQUEST_MAX_BYTES,
  SECTION_RERUN_SOFT_MAX,
} from "@sf/public-tools/content-brief/constants";
import {
  parseSharedContentBrief as parseContentBrief,
  parseSharedContentBriefHandoff as parseContentBriefHandoff,
} from "@sf/public-tools/content-brief/parse-geo-brief";
import type { SharedContentBrief as ContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { CONFIRMED_BRIEF_V2_SCHEMA, parseConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { CONTENT_BRIEF_V2_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";

import {
  clearMatchingContentBriefHandoff,
  peekContentBriefHandoff,
  takeContentBriefHandoff,
  writeContentBriefHandoff,
} from "../../lib/tools/content-brief-handoff";
import { parseConfirmedBriefHandoff, writeConfirmedBriefHandoff } from "../../lib/tools/content-brief-v2-handoff";
import { GEO_BRIEF_SCHEMA_VERSION } from "../../lib/geo-tools/brief-contract";
import { SignInDialog } from "../auth/sign-in-dialog";
import { trackMarketingEvent } from "../layout/google-analytics";
import {
  RETRY_AFTER_ERROR_CODES,
  isContentDraftErrorCode,
} from "./content-draft-codes";
import {
  ContentDraftIntake,
  type BriefSource,
  type IntakeState,
} from "./content-draft-intake";
import { ContentDraftResults } from "./content-draft-results";
import { ContentDraftV2Workflow } from "./content-draft-v2-workflow";
import {
  ContentDraftSettings,
  DEFAULT_DRAFT_SETTINGS,
  writableSections,
  type DraftSettings,
} from "./content-draft-settings";

const PANEL =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const BUTTON =
  "inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:opacity-60";

type Phase = "idle" | "running" | "rerunning" | "done";
type LoadedV2Intake = { readonly phase: "loaded_v2"; readonly confirmed: ConfirmedBriefV2; readonly source: BriefSource };
type ParsedIntake = IntakeState | LoadedV2Intake;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseErrorCode(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === "string" ? body.error.code : null;
}

/**
 * Shallow on purpose, like the brief tool's guard: the server assembled and
 * fingerprinted this result through the same functions the parser checks.
 * What this catches is a body from another route or contract version.
 */
function responseDraft(body: unknown): DraftResult | null {
  if (!isRecord(body) || body.schema !== DRAFT_RESULT_SCHEMA) return null;
  if (!isRecord(body.run) || !isRecord(body.run.reads)) return null;
  if (typeof body.run.mode !== "string" || typeof body.run.fingerprint !== "string") return null;
  if (!isRecord(body.brief_ref) || !isRecord(body.settings) || !isRecord(body.coverage)) return null;
  if (!Array.isArray(body.sections) || !Array.isArray(body.verify_before_publish)) return null;
  if (!isRecord(body.totals)) return null;
  return body as unknown as DraftResult;
}

/** Each document keeps its own parser; a confirmed v2 is never projected into a v1 Brief. */
async function parseIntake(raw: string, source: BriefSource): Promise<ParsedIntake> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { phase: "rejected", rejection: { code: "invalid_json", path: null } };
  }
  if (isRecord(json) && json.schemaVersion === GEO_BRIEF_SCHEMA_VERSION) {
    return { phase: "rejected", rejection: { code: "geo_document", path: null } };
  }
  if (source === "handoff") {
    if (isRecord(json) && json.version === 2) {
      const parsed = await parseConfirmedBriefHandoff(json);
      if (parsed.ok) return { phase: "loaded_v2", confirmed: parsed.value, source };
      const expired = parsed.code === "brief_reference_invalid" && (parsed.path === "expires_at" || parsed.path === "created_at");
      return { phase: "rejected", rejection: expired ? { code: "handoff_expired", path: null } : { code: parsed.code, path: parsed.path } };
    }
    const parsed = await parseContentBriefHandoff(json);
    if (parsed.ok) return { phase: "loaded", brief: parsed.value.brief, source };
    // The envelope's window is the one failure a visitor can do nothing about
    // except export the brief again, so it gets its own sentence.
    const expired =
      parsed.code === "brief_reference_invalid" &&
      (parsed.path === "expires_at" || parsed.path === "created_at");
    return {
      phase: "rejected",
      rejection: expired
        ? { code: "handoff_expired", path: null }
        : { code: parsed.code, path: parsed.path },
    };
  }
  if (isRecord(json) && json.schema === CONFIRMED_BRIEF_V2_SCHEMA) {
    const parsed = await parseConfirmedBriefV2(json);
    return parsed.ok ? { phase: "loaded_v2", confirmed: parsed.value, source } : { phase: "rejected", rejection: { code: parsed.code, path: parsed.path } };
  }
  if (isRecord(json) && json.schema === CONTENT_BRIEF_V2_SCHEMA) {
    return { phase: "rejected", rejection: { code: "confirmation_required", path: null } };
  }
  const parsed = await parseContentBrief(json);
  return parsed.ok
    ? { phase: "loaded", brief: parsed.value, source }
    : { phase: "rejected", rejection: { code: parsed.code, path: parsed.path } };
}

function allWritable(brief: ContentBrief): Set<string> {
  return new Set(writableSections(brief).map((section) => section.id));
}

function sameSettings(a: DraftSettings, b: DraftSettings): boolean {
  return a.tone === b.tone && a.person === b.person && a.product_mention === b.product_mention;
}

type SessionCheck = "signed_in" | "signed_out" | "unavailable";

/** What the error line needs besides the code: the Retry-After the server sent, and the cap the route enforces. */
interface ErrorDetail {
  readonly retryAfterSeconds: number | null;
  readonly limitKb: number;
}

const RUN_LIMIT_KB = Math.round(DRAFT_REQUEST_MAX_BYTES / 1024);
const SECTION_LIMIT_KB = Math.round(SECTION_REQUEST_MAX_BYTES / 1024);

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function hasRetryCopy(code: string): boolean {
  return (RETRY_AFTER_ERROR_CODES as readonly string[]).includes(code);
}

async function readSession(signal: AbortSignal): Promise<SessionCheck> {
  const response = await fetch("/api/auth/session", { cache: "no-store", signal });
  const body = (await response.json()) as { readonly signedIn?: unknown };
  if (!response.ok || typeof body.signedIn !== "boolean") return "unavailable";
  return body.signedIn ? "signed_in" : "signed_out";
}

/**
 * This tab's session storage, or null when the browser refuses it (a
 * sandboxed frame, a "block all cookies" setting): every handoff path then
 * degrades to "nothing waiting, nothing kept" instead of throwing.
 */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The opener's copy of a consumed handoff, if this tab still has an opener and it is ours. */
function openerStorage(): Storage | null {
  try {
    return window.opener?.sessionStorage ?? null;
  } catch {
    // A cross-origin opener throws on access; nothing of ours is there.
    return null;
  }
}

export interface ContentDraftToolProps {
  readonly locale: string;
  /**
   * The server's verdict on this request's cookie. A visitor it already
   * knows is signed out will sign in through the hero CTA, which reloads the
   * page; taking the handoff before that reload would lose it.
   */
  readonly authenticated: boolean;
}

export function ContentDraftTool({ locale, authenticated }: ContentDraftToolProps) {
  const t = useTranslations("tools.contentDraft");
  const [intake, setIntake] = useState<IntakeState>({ phase: "empty" });
  /**
   * The intake as of the last transition, written BEFORE the state update
   * is queued. A signed-in callback can run between a parser resolving and
   * React committing the result; reading the rendered value there would keep
   * a brief that is already being replaced.
   */
  const latestIntake = useRef<IntakeState>(intake);
  const [loadedV2, setLoadedV2] = useState<LoadedV2Intake | null>(null);
  const latestV2 = useRef<LoadedV2Intake | null>(null);
  const [settings, setSettings] = useState<DraftSettings>(DEFAULT_DRAFT_SETTINGS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [signInOpen, setSignInOpen] = useState(false);
  const [validationKey, setValidationKey] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail>({
    retryAfterSeconds: null,
    limitKb: RUN_LIMIT_KB,
  });
  const [result, setResult] = useState<DraftResult | null>(null);
  const [rerunsUsed, setRerunsUsed] = useState(0);
  const [handoffPending, setHandoffPending] = useState(false);
  const [keepFailed, setKeepFailed] = useState(false);
  const [runningSection, setRunningSection] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const submissionLocked = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  /**
   * Every brief entrance bumps this and lands its outcome only while it is
   * still current: a slow `file.text()` or parse from an earlier choice must
   * not overwrite the brief the visitor loaded after it.
   */
  const generation = useRef(0);
  /**
   * The handoff waiting for a visitor the server knows is signed out, kept
   * verbatim (not taken). It is cleared, exactly and only, when the visitor
   * loads another brief before signing in: that brief then takes its place.
   */
  const pendingRaw = useRef<string | null>(null);
  /**
   * The envelope this tab wrote so the loaded brief survives the reload a
   * sign-in causes. Replacing, pasting or uploading another brief clears it
   * exactly, so a stale brief cannot come back on the next load.
   */
  const writtenRaw = useRef<string | null>(null);
  const rerunsSpent = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      activeRequest.current?.abort();
      activeRequest.current = null;
      submissionLocked.current = false;
    };
  }, []);

  // The handoff is read once and removed in the same step (handoff §5.1):
  // a reload starts from the empty state, as item 32 requires. A visitor the
  // server knows is signed out only peeks: the hero sign-in reloads the page,
  // and the page after that reload is the one that consumes it.
  useEffect(() => {
    const storage = safeSessionStorage();
    if (storage === null) return;
    if (!authenticated) {
      pendingRaw.current = peekContentBriefHandoff(storage);
      setHandoffPending(pendingRaw.current !== null);
      return;
    }
    const raw = takeContentBriefHandoff(storage);
    if (raw === null) return;
    // This tab holds the envelope now, parsed or not; the opener's copy is
    // deleted at once, and only while it is still exactly this envelope.
    const opener = openerStorage();
    if (opener !== null) clearMatchingContentBriefHandoff(opener, raw);
    const gen = nextGeneration();
    setCurrentIntake({ phase: "parsing" });
    void parseIntake(raw, "handoff").then((next) => {
      if (mounted.current && gen === generation.current) loadIntake(next);
    });
  }, []);

  useEffect(() => {
    if (phase !== "running" && phase !== "rerunning") return;
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Scrolls only when a result actually arrives, never when a failed run
  // merely returns the page to its previous result.
  useEffect(() => {
    if (result === null) return;
    resultsRef.current?.scrollIntoView({ block: "start" });
  }, [result]);

  /** The only way the intake changes: the ref first, so a callback between now and the commit sees it. */
  function setCurrentIntake(next: ParsedIntake): void {
    latestV2.current = next.phase === "loaded_v2" ? next : null;
    setLoadedV2(latestV2.current);
    latestIntake.current = next.phase === "loaded_v2" ? { phase: "empty" } : next;
    setIntake(latestIntake.current);
  }

  /** Removes the envelope this tab wrote for a reload, if it is still exactly that envelope. */
  function discardWrittenHandoff(): void {
    if (writtenRaw.current === null) return;
    const storage = safeSessionStorage();
    if (storage !== null) clearMatchingContentBriefHandoff(storage, writtenRaw.current);
    writtenRaw.current = null;
  }

  /**
   * Writes the loaded brief as a fresh envelope so it survives the reload a
   * sign-in causes. Idempotent: a later write for the same brief replaces
   * the earlier one with a fresh TTL; a failed refresh leaves the earlier,
   * still-valid envelope in place. Returns whether the brief is now kept;
   * never throws, because a throw here would let the reload proceed and
   * lose the brief (gsi-client treats a throwing listener as "no veto").
   */
  function keepForReload(brief: ContentBrief): boolean {
    try {
      const written = writeContentBriefHandoff(window.sessionStorage, Date.now(), brief, {
        preserve: writtenRaw.current,
      });
      if (written.ok) {
        writtenRaw.current = written.raw;
        setKeepFailed(false);
        return true;
      }
    } catch {
      // A storage getter that throws (SecurityError) is the same outcome as
      // a store that refuses the write: the brief cannot be kept.
    }
    setKeepFailed(true);
    return false;
  }

  /** The sign-in callback may keep only the revision still current at this exact transition. */
  function keepConfirmedForReload(current: LoadedV2Intake): boolean {
    if (!mounted.current || latestV2.current !== current) return false;
    try {
      const written = writeConfirmedBriefHandoff(window.sessionStorage, Date.now(), current.confirmed, { preserve: writtenRaw.current });
      if (written.ok) { writtenRaw.current = written.raw; return true; }
    } catch { /* A storage getter that throws must also veto the reload. */ }
    return false;
  }

  function nextGeneration(): number {
    generation.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    submissionLocked.current = false;
    discardWrittenHandoff();
    setKeepFailed(false);
    return generation.current;
  }

  function loadIntake(next: ParsedIntake): void {
    if ((next.phase === "loaded" || next.phase === "loaded_v2") && next.source !== "handoff" && pendingRaw.current !== null) {
      // A brief loaded before sign-in takes the waiting handoff's place: the
      // waiting one is cleared (only while it is still exactly what was
      // peeked). Nothing is written yet -- a plain refresh must start empty
      // and a cancelled sign-in must leave nothing behind; the brief is
      // written only by onSignedIn, once a credential became a session.
      const storage = safeSessionStorage();
      if (storage !== null) clearMatchingContentBriefHandoff(storage, pendingRaw.current);
      pendingRaw.current = null;
      setHandoffPending(false);
    }
    setCurrentIntake(next);
    setResult(null);
    setRerunsUsed(0);
    rerunsSpent.current = 0;
    setErrorCode(null);
    setValidationKey(null);
    setPhase("idle");
    setRunningSection(null);
    setElapsedSeconds(0);
    setSelected(next.phase === "loaded" ? allWritable(next.brief) : new Set());
  }

  function parseAt(gen: number, raw: string, source: BriefSource): void {
    setCurrentIntake({ phase: "parsing" });
    void parseIntake(raw, source).then((next) => {
      if (mounted.current && gen === generation.current) loadIntake(next);
    });
  }

  function submitBrief(raw: string, source: BriefSource): void {
    parseAt(nextGeneration(), raw, source);
  }

  function uploadBrief(file: File): void {
    const gen = nextGeneration();
    setCurrentIntake({ phase: "parsing" });
    void file.text().then(
      (text) => {
        if (mounted.current && gen === generation.current) parseAt(gen, text, "upload");
      },
      () => {
        if (mounted.current && gen === generation.current) {
          loadIntake({ phase: "rejected", rejection: { code: "invalid_json", path: null } });
        }
      },
    );
  }

  function isCurrent(controller: AbortController, gen: number): boolean {
    return (
      mounted.current &&
      gen === generation.current &&
      activeRequest.current === controller &&
      !controller.signal.aborted
    );
  }

  function toggleSection(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setValidationKey(null);
  }

  function beginRequest(nextPhase: Phase): AbortController {
    submissionLocked.current = true;
    setErrorCode(null);
    setKeepFailed(false);
    const controller = new AbortController();
    activeRequest.current = controller;
    setPhase(nextPhase);
    return controller;
  }

  function endRequest(controller: AbortController): void {
    if (activeRequest.current === controller) {
      activeRequest.current = null;
      submissionLocked.current = false;
    }
  }

  function openSignIn(): void {
    setSignInOpen(true);
  }

  /**
   * Sign-in reloads the page. The loaded brief is written as a fresh
   * envelope only once a credential has become a session, immediately
   * before that reload — never earlier, so closing the dialog, replacing the
   * brief or a plain refresh can neither lose it nor resurrect it. A plain
   * refresh still starts empty: nothing is written on that path.
   */
  const onSignedIn = useCallback((): boolean | void => {
    const confirmed = latestV2.current;
    if (confirmed !== null) return keepConfirmedForReload(confirmed);
    const current = latestIntake.current;
    if (current.phase !== "loaded") return;
    // A brief that could not be kept vetoes the reload: the session exists,
    // the page stays with the brief and the notice, and the visitor can run.
    return keepForReload(current.brief);
  }, []);

  /** Session first, always: a signed-out visitor gets the dialog and no paid POST is sent. */
  async function signedIn(controller: AbortController, gen: number, fallback: Phase): Promise<boolean> {
    let session: SessionCheck;
    try {
      session = await readSession(controller.signal);
    } catch {
      session = "unavailable";
    }
    if (!isCurrent(controller, gen)) return false;
    if (session === "signed_in") return true;
    if (session === "signed_out") openSignIn();
    else setErrorCode("auth_unavailable");
    setPhase(fallback);
    return false;
  }

  async function post(
    controller: AbortController,
    gen: number,
    brief: ContentBrief,
    path: string,
    limitKb: number,
    body: unknown,
    fallback: Phase,
  ): Promise<DraftResult | null> {
    let payload: unknown;
    let ok = false;
    let detail: ErrorDetail = { retryAfterSeconds: null, limitKb };
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      ok = response.ok;
      detail = { retryAfterSeconds: retryAfterSeconds(response), limitKb };
      payload = await response.json();
    } catch {
      if (!isCurrent(controller, gen)) return null;
      setErrorCode("unknown");
      setPhase(fallback);
      return null;
    }
    if (!isCurrent(controller, gen)) return null;
    const next = responseDraft(payload);
    // A result written against another brief is refused before it renders,
    // whatever route it came from.
    if (!ok || next === null || next.brief_ref.fingerprint !== brief.run.fingerprint) {
      const code = responseErrorCode(payload);
      setErrorDetail(detail);
      setErrorCode(code !== null && isContentDraftErrorCode(code) ? code : "unknown");
      if (code === "auth_required") openSignIn();
      setPhase(fallback);
      return null;
    }
    return next;
  }

  async function run(): Promise<void> {
    if (submissionLocked.current || intake.phase !== "loaded") return;
    const brief = intake.brief;
    const sectionIds = writableSections(brief)
      .map((section) => section.id)
      .filter((id) => selected.has(id));
    if (sectionIds.length === 0) {
      setValidationKey("validation.sectionsRequired");
      return;
    }
    setValidationKey(null);
    // The last good result stays on screen until a new one has passed the
    // shape check; a refused or failed run leaves it exactly as it was and
    // returns the page to idle, so nothing is announced or scrolled to again.
    const fallback: Phase = "idle";
    const gen = generation.current;
    const controller = beginRequest("running");
    try {
      if (!(await signedIn(controller, gen, fallback))) return;
      trackMarketingEvent("tool_start", { tool_name: "content_draft" });
      const next = await post(
        controller,
        gen,
        brief,
        "/api/tools/content-draft/run",
        RUN_LIMIT_KB,
        { brief, settings, section_ids: sectionIds },
        fallback,
      );
      if (next === null) return;
      setResult(next);
      setRerunsUsed(0);
      rerunsSpent.current = 0;
      setPhase("done");
      trackMarketingEvent("tool_complete", { tool_name: "content_draft" });
    } finally {
      endRequest(controller);
    }
  }

  async function rerun(sectionId: string): Promise<void> {
    if (submissionLocked.current || intake.phase !== "loaded" || result === null) return;
    if (rerunsSpent.current >= SECTION_RERUN_SOFT_MAX) return;
    const brief = intake.brief;
    const gen = generation.current;
    const controller = beginRequest("rerunning");
    setRunningSection(sectionId);
    try {
      if (!(await signedIn(controller, gen, "idle"))) return;
      // Counted the moment the POST goes out, whatever comes back: the soft
      // cap bounds attempts, and a refused attempt still spent one.
      rerunsSpent.current += 1;
      setRerunsUsed(rerunsSpent.current);
      // The whole previous result travels, and the server takes settings,
      // sections and the run id from it after its own exact parse; the page
      // swaps in the whole reply rather than patching one section in. A rerun
      // therefore always runs under the draft's own settings, never the
      // form's current ones.
      const next = await post(
        controller,
        gen,
        brief,
        "/api/tools/content-draft/section",
        SECTION_LIMIT_KB,
        { brief, section_id: sectionId, previous: result },
        "idle",
      );
      if (next === null) return;
      setResult(next);
      setPhase("done");
    } finally {
      if (mounted.current) setRunningSection(null);
      endRequest(controller);
    }
  }

  const busy = phase === "running" || phase === "rerunning";
  const brief = intake.phase === "loaded" ? intake.brief : null;
  const canGenerate = brief !== null && writableSections(brief).length > 0;
  const settingsChanged = result !== null && !sameSettings(result.settings, settings);
  // Belt and braces with the check in `post`: nothing renders against a brief
  // it was not written for.
  const shownResult =
    result !== null && brief !== null && result.brief_ref.fingerprint === brief.run.fingerprint
      ? result
      : null;

  if (loadedV2 !== null) return <ContentDraftV2Workflow
    key={loadedV2.confirmed.fingerprint}
    confirmed={loadedV2.confirmed}
    source={loadedV2.source}
    locale={locale}
    authenticated={authenticated}
    onReplace={() => { nextGeneration(); loadIntake({ phase: "empty" }); }}
    onKeepForSignIn={() => keepConfirmedForReload(loadedV2)}
  />;

  return (
    <section id="content-draft-tool" data-locale={locale} aria-busy={busy} className="min-w-0 space-y-4">
      {handoffPending && intake.phase === "empty" ? (
        <p data-handoff-pending role="status" className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("intake.handoffPending")}
        </p>
      ) : null}
      {keepFailed ? (
        <p data-handoff-keep-failed role="alert" className="text-[12.5px] leading-[1.6] text-brand-error">
          {t("intake.handoffKeepFailed")}
        </p>
      ) : null}
      <ContentDraftIntake
        intake={intake}
        onSubmit={submitBrief}
        onUpload={uploadBrief}
        onReplace={() => {
          nextGeneration();
          loadIntake({ phase: "empty" });
        }}
        disabled={busy}
        locale={locale}
        t={t}
      />

      {brief !== null ? (
        <form
          data-content-draft-form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
          className={PANEL}
        >
          <ContentDraftSettings
            brief={brief}
            settings={settings}
            onSettings={setSettings}
            selected={selected}
            onToggleSection={toggleSection}
            disabled={busy || !canGenerate}
            locale={locale}
            t={t}
          />

          {settingsChanged ? (
            <p data-settings-changed role="status" className="mt-4 text-[12.5px] text-brand-warning">
              {t("settings.changed")}
            </p>
          ) : null}

          {validationKey !== null ? (
            <p id="content-draft-validation" role="alert" className="mt-4 text-[12.5px] text-brand-error">
              {t(validationKey as Parameters<typeof t>[0])}
            </p>
          ) : null}

          {errorCode !== null ? (
            <div
              role="alert"
              data-error-code={errorCode}
              className="mt-4 rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[12.5px] text-brand-error"
            >
              {t(
                `${
                  errorDetail.retryAfterSeconds !== null && hasRetryCopy(errorCode)
                    ? "errorsWithRetry"
                    : "errors"
                }.${isContentDraftErrorCode(errorCode) ? errorCode : "unknown"}` as Parameters<typeof t>[0],
                { seconds: errorDetail.retryAfterSeconds ?? 0, kb: errorDetail.limitKb },
              )}
            </div>
          ) : null}

          {phase === "running" ? (
            <p role="status" aria-live="polite" className="mt-4 text-[12.5px] text-text-dark-secondary">
              {t("running.elapsed", {
                seconds: elapsedSeconds,
                budget: Math.round(DRAFT_TOTAL_BUDGET_MS / 1000),
              })}
            </p>
          ) : phase === "rerunning" ? (
            <p role="status" aria-live="polite" className="mt-4 text-[12.5px] text-text-dark-secondary">
              {t("running.rerunElapsed", {
                seconds: elapsedSeconds,
                budget: Math.round(SECTION_ENDPOINT_BUDGET_MS / 1000),
              })}
            </p>
          ) : phase === "done" && shownResult !== null ? (
            <p role="status" aria-live="polite" className="sr-only">
              {t("running.complete")}
            </p>
          ) : null}

          <button
            type="submit"
            data-run-draft
            disabled={busy || !canGenerate}
            className={`${BUTTON} mt-6`}
          >
            {phase === "running" ? t("actions.running") : t("actions.run")}
          </button>
        </form>
      ) : null}

      {shownResult !== null && brief !== null ? (
        <div ref={resultsRef} data-content-draft-result className="min-w-0 scroll-mt-24">
          <ContentDraftResults
            result={shownResult}
            brief={brief}
            rerun={{
              used: rerunsUsed,
              running: runningSection,
              writable: new Set(brief.draft_readiness.writable),
              disabled: busy,
              onRerun: (id) => void rerun(id),
            }}
            locale={locale}
          />
        </div>
      ) : null}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} onSignedIn={onSignedIn} />
    </section>
  );
}
