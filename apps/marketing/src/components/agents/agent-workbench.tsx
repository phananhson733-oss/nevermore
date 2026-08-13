// @input  -- exact Agent identity, session/audit endpoints, sign-in dialog, window focus
// @output -- isolated Agent state plus one-shot pending-intent resume after sign-in
// @pos    -- primary client workbench for /agents/seo and /agents/tech

"use client";

import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  Radar,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import type {
  AgentAuditSuccessData,
} from "../../lib/agents/audit-contract";
import { isAgentAuditSuccessEnvelope } from "../../lib/agents/audit-contract";
import { SignInDialog } from "../auth/sign-in-dialog";
import { supportsAgentDisplayVocabulary } from "./agent-display-contract";
import { AgentResults } from "./agent-results";
import {
  clearPendingAgentIntent,
  getSessionIntentStorage,
  readPendingAgentIntent,
  restorePendingAgentIntent,
  storePendingAgentIntent,
  type PendingAgentIntent,
} from "./agent-intent";
import { AGENT_ENDPOINT, type AgentKind } from "./agent-types";

const EXISTING_AUDIT_ERROR_CODES = new Set([
  "invalid_url",
  "invalid_request",
  "payload_too_large",
  "unsupported_media_type",
  "scan_failed",
  "scan_timeout",
  "scan_in_progress",
  "rate_limited",
  "target_busy",
  "quota_unavailable",
  "robots_disallowed",
  "robots_unreachable",
]);

const URL_INPUT_ERROR_CODES = new Set([
  "invalid_url",
  "invalid_request",
  "payload_too_large",
]);

function errorCodeOf(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const error = (body as { readonly error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Validate the complete wire envelope again before rendering it in-browser. */
function successDataOf(
  body: unknown,
  expectedAgent: AgentKind,
): AgentAuditSuccessData | null {
  if (!isAgentAuditSuccessEnvelope(body)) return null;
  return supportsAgentDisplayVocabulary(body.data, expectedAgent)
    ? body.data
    : null;
}

type SessionStatus = "signed_in" | "signed_out" | "unavailable";

async function getSessionStatus(signal?: AbortSignal): Promise<SessionStatus> {
  const response = await fetch("/api/auth/session", {
    signal,
    cache: "no-store",
  });
  if (!response.ok) return "unavailable";
  const body = (await response.json()) as { readonly signedIn?: unknown };
  if (body.signedIn === true) return "signed_in";
  if (body.signedIn === false) return "signed_out";
  return "unavailable";
}

type AgentWorkbenchProps = {
  readonly agent: AgentKind;
  readonly locale: string;
};

export function AgentWorkbench(props: AgentWorkbenchProps) {
  return <AgentWorkbenchInstance key={props.agent} {...props} />;
}

function AgentWorkbenchInstance({ agent, locale }: AgentWorkbenchProps) {
  const t = useTranslations("agents.workbench");
  const auditT = useTranslations("tools.seoAudit");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [data, setData] = useState<AgentAuditSuccessData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const mounted = useRef(true);
  const operationId = useRef(0);
  const busy = useRef(false);
  const resumeIntent = useRef<PendingAgentIntent | null>(null);
  const activeOperationController = useRef<AbortController | null>(null);

  const runAudit = useCallback(
    async (
      submittedUrl: string,
      currentOperation: number,
      signal?: AbortSignal,
      pendingIntent?: PendingAgentIntent,
    ): Promise<void> => {
      try {
        const response = await fetch(AGENT_ENDPOINT[agent], {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ url: submittedUrl }),
          signal,
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (
          !mounted.current ||
          signal?.aborted ||
          currentOperation !== operationId.current
        ) {
          return;
        }

        if (!response.ok) {
          const code = errorCodeOf(body) ?? "unknown";
          if (code === "auth_required") {
            const storage = getSessionIntentStorage();
            const stored = storage
              ? pendingIntent
                ? restorePendingAgentIntent(storage, agent, pendingIntent)
                : storePendingAgentIntent(storage, agent, submittedUrl)
              : null;
            if (!stored) {
              setErrorCode("intent_unavailable");
              return;
            }
            setSignInOpen(true);
          }
          setErrorCode(code);
          return;
        }

        const success = successDataOf(body, agent);
        if (!success) {
          setErrorCode("audit_response_invalid");
          return;
        }
        setData(success);
        // A null selection lets AgentResults choose the first record after its
        // tested affected-count ordering, not whichever record arrived first.
        setSelectedId(null);
      } catch {
        if (
          mounted.current &&
          !signal?.aborted &&
          currentOperation === operationId.current
        ) {
          setErrorCode("unknown");
        }
      }
    },
    [agent],
  );

  const gateAndRun = useCallback(
    async (
      submittedUrl: string,
      signal?: AbortSignal,
      replaceInterruptedResume = false,
      pendingIntent?: PendingAgentIntent,
      silentSignedOut = false,
    ): Promise<void> => {
      // The ref closes the same-render double-click window before React has
      // committed `loading`. A Strict Effects resume is allowed to replace its
      // just-aborted predecessor; the operation id prevents stale completion.
      if (busy.current && !replaceInterruptedResume) return;
      const currentOperation = operationId.current + 1;
      operationId.current = currentOperation;
      busy.current = true;
      if (!silentSignedOut) {
        setLoading(true);
        setErrorCode(null);
        setData(null);
        setSelectedId(null);
      }
      let sessionStatus: SessionStatus;
      try {
        sessionStatus = await getSessionStatus(signal);
      } catch {
        if (signal?.aborted) {
          if (currentOperation === operationId.current) {
            busy.current = false;
            setLoading(false);
          }
          return;
        }
        sessionStatus = "unavailable";
      }
      if (
        !mounted.current ||
        signal?.aborted ||
        currentOperation !== operationId.current
      ) {
        return;
      }

      try {
        if (sessionStatus === "unavailable") {
          setSignInOpen(false);
          setErrorCode("auth_unavailable");
          return;
        }
        const signedIn = sessionStatus === "signed_in";

        // A focus probe is intentionally invisible while the app login tab has
        // not established a shared session yet.
        if (silentSignedOut) {
          if (!signedIn) return;
          setLoading(true);
          setErrorCode(null);
          setData(null);
          setSelectedId(null);
        }

        if (pendingIntent && pendingIntent.expiresAt <= Date.now()) {
          const storage = getSessionIntentStorage();
          if (storage) clearPendingAgentIntent(storage, agent);
          setErrorCode("intent_expired");
          return;
        }

        if (!signedIn) {
          const storage = getSessionIntentStorage();
          if (!storage) {
            setSignInOpen(false);
            setErrorCode("intent_unavailable");
            return;
          }
          const existing = readPendingAgentIntent(storage, agent);
          if (pendingIntent && !existing) {
            setErrorCode("intent_expired");
            return;
          }
          if (!pendingIntent && (!existing || existing.url !== submittedUrl)) {
            const stored = storePendingAgentIntent(
              storage,
              agent,
              submittedUrl,
            );
            if (!stored) {
              setSignInOpen(false);
              setErrorCode("intent_unavailable");
              return;
            }
          }
          setSignInOpen(true);
          return;
        }

        // Clear before POST. A reload after this point cannot replay a run the
        // visitor already authorized, and another Agent's slot is untouched.
        setSignInOpen(false);
        const storage = getSessionIntentStorage();
        if (storage) clearPendingAgentIntent(storage, agent);
        await runAudit(
          submittedUrl,
          currentOperation,
          signal,
          pendingIntent,
        );
      } finally {
        if (currentOperation === operationId.current) {
          busy.current = false;
          if (mounted.current) setLoading(false);
        }
      }
    },
    [agent, runAudit],
  );

  const startOperation = useCallback(
    (
      submittedUrl: string,
      replaceInterruptedResume = false,
      pendingIntent?: PendingAgentIntent,
      silentSignedOut = false,
    ) => {
      if (busy.current && !replaceInterruptedResume) return null;
      activeOperationController.current?.abort();
      const controller = new AbortController();
      activeOperationController.current = controller;
      const completion = gateAndRun(
        submittedUrl,
        controller.signal,
        replaceInterruptedResume,
        pendingIntent,
        silentSignedOut,
      ).finally(() => {
        if (activeOperationController.current === controller) {
          activeOperationController.current = null;
        }
      });
      return { controller, completion };
    },
    [gateAndRun],
  );

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      activeOperationController.current?.abort();
      activeOperationController.current = null;
    };
  }, []);

  useEffect(() => {
    const storage = getSessionIntentStorage();
    const pending =
      (storage ? readPendingAgentIntent(storage, agent) : null) ??
      resumeIntent.current;
    if (!pending) return;
    resumeIntent.current = pending;
    setUrl(pending.url);
    const started = startOperation(pending.url, true, pending);
    if (!started) return;
    void started.completion.finally(() => {
      if (!started.controller.signal.aborted) resumeIntent.current = null;
    });
    return () => started.controller.abort();
  }, [agent, startOperation]);

  useEffect(() => {
    if (!signInOpen) return;

    function resumeAfterAppSignIn(): void {
      const storage = getSessionIntentStorage();
      if (!storage) return;
      const pending = readPendingAgentIntent(storage, agent);
      if (!pending) return;
      startOperation(pending.url, false, pending, true);
    }

    window.addEventListener("focus", resumeAfterAppSignIn);
    return () => window.removeEventListener("focus", resumeAfterAppSignIn);
  }, [agent, signInOpen, startOperation]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!url.trim() || busy.current) return;
    // Preserve what the visitor entered (including a scheme-less host) across
    // sign-in. Normalization and validation remain server authority.
    startOperation(url);
  }

  function handleDialogChange(open: boolean): void {
    setSignInOpen(open);
    if (!open) {
      // Closing the dialog is an authoritative cancellation. A focus probe
      // that was already checking the shared session must not later start a
      // crawl after the visitor has dismissed the sign-in flow.
      activeOperationController.current?.abort();
      activeOperationController.current = null;
      operationId.current += 1;
      busy.current = false;
      setLoading(false);
      const storage = getSessionIntentStorage();
      if (storage) clearPendingAgentIntent(storage, agent);
      if (errorCode === "auth_required") setErrorCode(null);
    }
  }

  const auditErrorKey =
    errorCode && EXISTING_AUDIT_ERROR_CODES.has(errorCode)
      ? (`errors.${errorCode}` as const)
      : null;

  return (
    <section
      id={`${agent}-agent-workbench`}
      data-agent={agent}
      className="scroll-mt-24"
      aria-busy={loading}
    >
      <div className="relative overflow-hidden rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-7">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-brand-gradient opacity-80"
        />
        <div className="relative">
          <p className="font-mono text-[10px] tracking-[0.13em] text-brand-accent-text uppercase">
            {t("stage1")}
          </p>
          <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-text-dark-primary">
                {t(`${agent}.title`)}
              </h2>
              <p className="mt-2 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t(`${agent}.body`)}
              </p>
            </div>
            <p className="flex items-center gap-2 font-mono text-[9.5px] tracking-[0.04em] text-text-dark-faint">
              <LockKeyhole aria-hidden="true" className="size-3 text-brand-accent" />
              {t("accountGate")}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-6 grid gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
          >
            <label className="block">
              <span
                id={`${agent}-agent-url-label`}
                className="mb-2 block font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase"
              >
                {t("urlLabel")}
              </span>
              <span className="flex h-12.5 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70">
                <Radar
                  aria-hidden="true"
                  className="size-[15px] shrink-0 text-brand-accent"
                />
                <input
                  id={`${agent}-agent-url`}
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  required
                  maxLength={2_048}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  aria-invalid={
                    errorCode !== null && URL_INPUT_ERROR_CODES.has(errorCode)
                  }
                  aria-describedby={`${agent}-agent-scope${
                    errorCode ? ` ${agent}-agent-error` : ""
                  }`}
                  placeholder={t("placeholder")}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary"
                />
              </span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta disabled:cursor-wait disabled:opacity-70 disabled:shadow-none"
            >
              {loading ? t("running") : t("run")}
              {loading ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <ArrowRight aria-hidden="true" className="size-4" />
              )}
            </button>
          </form>

          <p
            id={`${agent}-agent-scope`}
            className="mt-3 text-[11.5px] leading-[1.6] text-text-dark-secondary"
          >
            {t(`${agent}.scope`)}
          </p>

          {loading ? (
            <div
              role="status"
              className="mt-5 flex items-start gap-3 rounded-row border border-brand-border bg-brand-panel-sunken p-4"
            >
              <LoaderCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 animate-spin text-brand-accent"
              />
              <div>
                <p className="text-[12.5px] font-semibold text-text-dark-primary">
                  {t("loadingTitle")}
                </p>
                <p className="mt-1 text-[11.5px] leading-[1.6] text-text-dark-secondary">
                  {t("loadingBody")}
                </p>
              </div>
            </div>
          ) : null}

          {errorCode ? (
            <p
              id={`${agent}-agent-error`}
              role="alert"
              className="mt-5 rounded-row border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[12.5px] leading-[1.55] text-brand-error"
            >
              {auditErrorKey
                ? auditT(auditErrorKey)
                : errorCode === "auth_required"
                  ? t("errors.auth_required")
                  : errorCode === "auth_unavailable"
                    ? t("errors.auth_unavailable")
                    : errorCode === "intent_expired"
                      ? t("errors.intent_expired")
                      : errorCode === "intent_unavailable"
                        ? t("errors.intent_unavailable")
                        : errorCode === "audit_response_invalid"
                          ? t("errors.audit_response_invalid")
                          : t("errors.unknown")}
            </p>
          ) : null}
        </div>
      </div>

      {data ? (
        <AgentResults
          agent={agent}
          locale={locale}
          data={data}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : null}

      <SignInDialog open={signInOpen} onOpenChange={handleDialogChange} />
    </section>
  );
}
