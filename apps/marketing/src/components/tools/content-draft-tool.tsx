// @input  -- locale, the one-time brief handoff in sessionStorage, pasted or uploaded brief JSON,
//            and the authenticated draft APIs
// @output -- the brief intake, the draft settings form, the session-first run and per-section
//            rerun flows, and the result surface
// @pos    -- primary client surface for the Marketing Content Draft Writer

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DRAFT_RESULT_SCHEMA,
  type ContentBrief,
  type DraftResult,
} from "@sf/public-tools/content-brief/contract";
import {
  DRAFT_TOTAL_BUDGET_MS,
  SECTION_ENDPOINT_BUDGET_MS,
  SECTION_RERUN_SOFT_MAX,
} from "@sf/public-tools/content-brief/constants";
import {
  parseContentBrief,
  parseContentBriefHandoff,
} from "@sf/public-tools/content-brief/parse-brief";

import { takeContentBriefHandoff } from "../../lib/tools/content-brief-handoff";
import { SignInDialog } from "../auth/sign-in-dialog";
import { trackMarketingEvent } from "../layout/google-analytics";
import { isContentDraftErrorCode } from "./content-draft-codes";
import {
  ContentDraftIntake,
  type BriefSource,
  type IntakeState,
} from "./content-draft-intake";
import { ContentDraftResults } from "./content-draft-results";
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
  if (
    typeof body.run.mode !== "string" ||
    typeof body.run.fingerprint !== "string"
  )
    return null;
  if (
    !isRecord(body.brief_ref) ||
    !isRecord(body.settings) ||
    !isRecord(body.coverage)
  )
    return null;
  if (
    !Array.isArray(body.sections) ||
    !Array.isArray(body.verify_before_publish)
  )
    return null;
  if (!isRecord(body.totals)) return null;
  return body as unknown as DraftResult;
}

/** The parser's failure, or the two states only the intake knows about. */
async function parseIntake(
  raw: string,
  source: BriefSource,
): Promise<IntakeState> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      phase: "rejected",
      rejection: { code: "invalid_json", path: null },
    };
  }
  if (source === "handoff") {
    const parsed = await parseContentBriefHandoff(json);
    if (parsed.ok)
      return { phase: "loaded", brief: parsed.value.brief, source };
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
  const parsed = await parseContentBrief(json);
  return parsed.ok
    ? { phase: "loaded", brief: parsed.value, source }
    : {
        phase: "rejected",
        rejection: { code: parsed.code, path: parsed.path },
      };
}

function allWritable(brief: ContentBrief): Set<string> {
  return new Set(writableSections(brief).map((section) => section.id));
}

type SessionCheck = "signed_in" | "signed_out" | "unavailable";

async function readSession(signal: AbortSignal): Promise<SessionCheck> {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    signal,
  });
  const body = (await response.json()) as { readonly signedIn?: unknown };
  if (!response.ok || typeof body.signedIn !== "boolean") return "unavailable";
  return body.signedIn ? "signed_in" : "signed_out";
}

export interface ContentDraftToolProps {
  readonly locale: string;
}

export function ContentDraftTool({ locale }: ContentDraftToolProps) {
  const t = useTranslations("tools.contentDraft");
  const [intake, setIntake] = useState<IntakeState>({ phase: "empty" });
  const [settings, setSettings] = useState<DraftSettings>(
    DEFAULT_DRAFT_SETTINGS,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [signInOpen, setSignInOpen] = useState(false);
  const [validationKey, setValidationKey] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [rerunsUsed, setRerunsUsed] = useState(0);
  const [runningSection, setRunningSection] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const submissionLocked = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

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
  // a reload starts from the empty state, as item 32 requires.
  useEffect(() => {
    const raw = takeContentBriefHandoff(window.sessionStorage);
    if (raw === null) return;
    setIntake({ phase: "parsing" });
    void parseIntake(raw, "handoff").then((next) => {
      if (mounted.current) loadIntake(next);
    });
  }, []);

  useEffect(() => {
    if (phase !== "running" && phase !== "rerunning") return;
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (result === null || phase !== "done") return;
    resultsRef.current?.scrollIntoView({ block: "start" });
  }, [result, phase]);

  function loadIntake(next: IntakeState): void {
    setIntake(next);
    setResult(null);
    setRerunsUsed(0);
    setErrorCode(null);
    setValidationKey(null);
    setSelected(next.phase === "loaded" ? allWritable(next.brief) : new Set());
  }

  function submitBrief(raw: string, source: BriefSource): void {
    setIntake({ phase: "parsing" });
    void parseIntake(raw, source).then((next) => {
      if (mounted.current) loadIntake(next);
    });
  }

  function isCurrent(controller: AbortController): boolean {
    return (
      mounted.current &&
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

  /** Session first, always: a signed-out visitor gets the dialog and no paid POST is sent. */
  async function signedIn(
    controller: AbortController,
    fallback: Phase,
  ): Promise<boolean> {
    let session: SessionCheck;
    try {
      session = await readSession(controller.signal);
    } catch {
      session = "unavailable";
    }
    if (!isCurrent(controller)) return false;
    if (session === "signed_in") return true;
    if (session === "signed_out") setSignInOpen(true);
    else setErrorCode("auth_unavailable");
    setPhase(fallback);
    return false;
  }

  async function post(
    controller: AbortController,
    path: string,
    body: unknown,
    fallback: Phase,
  ): Promise<DraftResult | null> {
    let payload: unknown;
    let ok = false;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      ok = response.ok;
      payload = await response.json();
    } catch {
      if (!isCurrent(controller)) return null;
      setErrorCode("unknown");
      setPhase(fallback);
      return null;
    }
    if (!isCurrent(controller)) return null;
    const next = responseDraft(payload);
    if (!ok || next === null) {
      const code = responseErrorCode(payload);
      setErrorCode(
        code !== null && isContentDraftErrorCode(code) ? code : "unknown",
      );
      if (code === "auth_required") setSignInOpen(true);
      setPhase(fallback);
      return null;
    }
    return next;
  }

  async function run(): Promise<void> {
    if (submissionLocked.current || intake.phase !== "loaded") return;
    const sectionIds = writableSections(intake.brief)
      .map((section) => section.id)
      .filter((id) => selected.has(id));
    if (sectionIds.length === 0) {
      setValidationKey("validation.sectionsRequired");
      return;
    }
    setValidationKey(null);
    setResult(null);
    setRerunsUsed(0);
    const controller = beginRequest("running");
    try {
      if (!(await signedIn(controller, "idle"))) return;
      trackMarketingEvent("tool_start", { tool_name: "content_draft" });
      const next = await post(
        controller,
        "/api/tools/content-draft/run",
        { brief: intake.brief, settings, section_ids: sectionIds },
        "idle",
      );
      if (next === null) return;
      setResult(next);
      setPhase("done");
      trackMarketingEvent("tool_complete", { tool_name: "content_draft" });
    } finally {
      endRequest(controller);
    }
  }

  async function rerun(sectionId: string): Promise<void> {
    if (
      submissionLocked.current ||
      intake.phase !== "loaded" ||
      result === null
    )
      return;
    if (rerunsUsed >= SECTION_RERUN_SOFT_MAX) return;
    const controller = beginRequest("rerunning");
    setRunningSection(sectionId);
    try {
      if (!(await signedIn(controller, "done"))) return;
      // The server replaces the section and re-derives everything else; the
      // page swaps the whole result rather than patching one section in.
      const next = await post(
        controller,
        "/api/tools/content-draft/section",
        {
          brief: intake.brief,
          settings,
          section_id: sectionId,
          sections: result.sections,
        },
        "done",
      );
      if (next === null) return;
      setResult(next);
      setRerunsUsed((used) => used + 1);
      setPhase("done");
    } finally {
      if (mounted.current) setRunningSection(null);
      endRequest(controller);
    }
  }

  const busy = phase === "running" || phase === "rerunning";
  const brief = intake.phase === "loaded" ? intake.brief : null;
  const canGenerate = brief !== null && writableSections(brief).length > 0;

  return (
    <section
      id="content-draft-tool"
      data-locale={locale}
      aria-busy={busy}
      className="min-w-0 space-y-4"
    >
      <ContentDraftIntake
        intake={intake}
        onSubmit={submitBrief}
        onReplace={() => loadIntake({ phase: "empty" })}
        disabled={busy}
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

          {validationKey !== null ? (
            <p
              id="content-draft-validation"
              role="alert"
              className="mt-4 text-[12.5px] text-brand-error"
            >
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
                `errors.${isContentDraftErrorCode(errorCode) ? errorCode : "unknown"}` as Parameters<
                  typeof t
                >[0],
              )}
            </div>
          ) : null}

          {phase === "running" ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-4 text-[12.5px] text-text-dark-secondary"
            >
              {t("running.elapsed", {
                seconds: elapsedSeconds,
                budget: Math.round(DRAFT_TOTAL_BUDGET_MS / 1000),
              })}
            </p>
          ) : phase === "rerunning" ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-4 text-[12.5px] text-text-dark-secondary"
            >
              {t("running.rerunElapsed", {
                seconds: elapsedSeconds,
                budget: Math.round(SECTION_ENDPOINT_BUDGET_MS / 1000),
              })}
            </p>
          ) : phase === "done" ? (
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

      {result !== null && brief !== null ? (
        <div
          ref={resultsRef}
          data-content-draft-result
          className="min-w-0 scroll-mt-24"
        >
          <ContentDraftResults
            result={result}
            brief={brief}
            rerun={{
              used: rerunsUsed,
              running: runningSection,
              onRerun: (id) => void rerun(id),
            }}
            locale={locale}
          />
        </div>
      ) : null}
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </section>
  );
}
