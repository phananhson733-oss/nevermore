// @input  -- exact Agent identity, local Profile, session/audit endpoints, and intent handoff
// @output -- isolated four-stage Agent state with purpose-safe sign-in resume
// @pos    -- primary client workbench for independent /agents/seo and /agents/tech routes

"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import { isAgentAuditSuccessEnvelope } from "../../lib/agents/audit-contract";
import {
  isAgentProfileSearchEnvelope,
  type AgentProfileSearchData,
} from "../../lib/agents/profile-search-contract";
import { SignInDialog } from "../auth/sign-in-dialog";
import { supportsAgentDisplayVocabulary } from "./agent-display-contract";
import { AgentProfilePanel } from "./agent-profile-panel";
import {
  createAgentProfileDraft,
  type AgentProfileDraft,
} from "./agent-profile";
import { AgentResults } from "./agent-results";
import {
  clearPendingAgentIntent,
  getSessionIntentStorage,
  isRunnablePendingAgentIntent,
  readPendingAgentIntent,
  restorePendingAgentIntent,
  schedulePendingAgentIntentExpiry,
  storeConfirmedAgentRunIntent,
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
type SignInPurpose = "audit" | "profile_search";

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
  const [profile, setProfile] = useState<AgentProfileDraft>(() =>
    createAgentProfileDraft(agent, "", locale),
  );
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [data, setData] = useState<AgentAuditSuccessData | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInPurpose, setSignInPurpose] =
    useState<SignInPurpose | null>(null);
  const [profileSearchLoading, setProfileSearchLoading] = useState(false);
  const [profileSearchData, setProfileSearchData] =
    useState<AgentProfileSearchData | null>(null);
  const [profileSearchErrorCode, setProfileSearchErrorCode] = useState<
    string | null
  >(null);
  const mounted = useRef(true);
  const operationId = useRef(0);
  const busy = useRef(false);
  const resumeIntent = useRef<PendingAgentIntent | null>(null);
  const activeOperationController = useRef<AbortController | null>(null);
  const profileSearchController = useRef<AbortController | null>(null);
  const profileSearchBusy = useRef(false);

  const runAudit = useCallback(
    async (
      confirmedProfile: AgentProfileDraft,
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
          body: JSON.stringify({ url: confirmedProfile.targetUrl }),
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
                : storeConfirmedAgentRunIntent(storage, confirmedProfile)
              : null;
            if (!stored) {
              setErrorCode("intent_unavailable");
              return;
            }
            if (storage) schedulePendingAgentIntentExpiry(storage, stored);
            resumeIntent.current = stored;
            setSignInPurpose("audit");
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
      confirmedProfile: AgentProfileDraft,
      signal?: AbortSignal,
      replaceInterruptedResume = false,
      pendingIntent?: PendingAgentIntent,
      silentSignedOut = false,
    ): Promise<void> => {
      if (busy.current && !replaceInterruptedResume) return;
      const currentOperation = operationId.current + 1;
      operationId.current = currentOperation;
      busy.current = true;
      if (!silentSignedOut) {
        setLoading(true);
        setErrorCode(null);
        setData(null);
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
          setSignInPurpose(null);
          setErrorCode("auth_unavailable");
          return;
        }
        const signedIn = sessionStatus === "signed_in";

        if (silentSignedOut) {
          if (!signedIn) return;
          setLoading(true);
          setErrorCode(null);
          setData(null);
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
            setSignInPurpose(null);
            setErrorCode("intent_unavailable");
            return;
          }
          const existing = readPendingAgentIntent(storage, agent);
          const stored = pendingIntent
            ? existing && isRunnablePendingAgentIntent(existing)
              ? existing
              : null
            : storeConfirmedAgentRunIntent(storage, confirmedProfile);
          if (!stored) {
            setSignInOpen(false);
            setSignInPurpose(null);
            setErrorCode(pendingIntent ? "intent_expired" : "intent_unavailable");
            return;
          }
          schedulePendingAgentIntentExpiry(storage, stored);
          resumeIntent.current = stored;
          setSignInPurpose("audit");
          setSignInOpen(true);
          return;
        }

        setSignInOpen(false);
        setSignInPurpose(null);
        const storage = getSessionIntentStorage();
        if (storage) clearPendingAgentIntent(storage, agent);
        await runAudit(confirmedProfile, currentOperation, signal, pendingIntent);
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
      confirmedProfile: AgentProfileDraft,
      replaceInterruptedResume = false,
      pendingIntent?: PendingAgentIntent,
      silentSignedOut = false,
    ) => {
      if (busy.current && !replaceInterruptedResume) return null;
      activeOperationController.current?.abort();
      const controller = new AbortController();
      activeOperationController.current = controller;
      const completion = gateAndRun(
        confirmedProfile,
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
      profileSearchController.current?.abort();
      profileSearchController.current = null;
    };
  }, []);

  const handleProfileSearch = useCallback(
    async (resumeAfterSignIn = false): Promise<void> => {
      if (
        profileSearchBusy.current ||
        !profile.targetUrl.trim() ||
        !/^[A-Z]{2}$/.test(profile.country) ||
        !profile.locale.trim()
      ) {
        return;
      }

      profileSearchController.current?.abort();
      const controller = new AbortController();
      profileSearchController.current = controller;
      profileSearchBusy.current = true;
      setProfileSearchLoading(true);
      setProfileSearchErrorCode(null);
      setProfileSearchData(null);

      try {
        const response = await fetch(`/api/agents/${agent}/profile-search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            url: profile.targetUrl,
            marketCode: profile.country,
            languageTag: profile.locale,
            targetQuery: profile.targetQuery,
          }),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (!mounted.current || controller.signal.aborted) return;

        if (!response.ok) {
          const code = errorCodeOf(body) ?? "unknown";
          setProfileSearchErrorCode(code);
          if (code === "auth_required") {
            setSignInPurpose("profile_search");
            setSignInOpen(true);
          } else if (resumeAfterSignIn) {
            setSignInOpen(false);
            setSignInPurpose(null);
          }
          return;
        }

        if (
          !isAgentProfileSearchEnvelope(body) ||
          body.data.agent !== agent ||
          body.data.targetHost !== profile.host
        ) {
          setProfileSearchErrorCode("audit_response_invalid");
          if (resumeAfterSignIn) {
            setSignInOpen(false);
            setSignInPurpose(null);
          }
          return;
        }
        setProfileSearchData(body.data);
        if (resumeAfterSignIn) {
          setSignInOpen(false);
          setSignInPurpose(null);
        }
      } catch {
        if (mounted.current && !controller.signal.aborted) {
          setProfileSearchErrorCode("unknown");
          if (resumeAfterSignIn) {
            setSignInOpen(false);
            setSignInPurpose(null);
          }
        }
      } finally {
        if (profileSearchController.current === controller) {
          profileSearchController.current = null;
          profileSearchBusy.current = false;
          if (mounted.current) setProfileSearchLoading(false);
        }
      }
    },
    [agent, profile],
  );

  useEffect(() => {
    const storage = getSessionIntentStorage();
    const pending =
      (storage ? readPendingAgentIntent(storage, agent) : null) ??
      resumeIntent.current;
    if (!pending) return;

    if (pending.purpose === "prepare_profile") {
      setProfile(createAgentProfileDraft(agent, pending.url, locale));
      if (storage) clearPendingAgentIntent(storage, agent);
      return;
    }

    if (!isRunnablePendingAgentIntent(pending) || !pending.confirmedProfile) {
      if (storage) clearPendingAgentIntent(storage, agent);
      return;
    }
    resumeIntent.current = pending;
    setProfile(pending.confirmedProfile);
    const started = startOperation(
      pending.confirmedProfile,
      true,
      pending,
    );
    if (!started) return;
    void started.completion.finally(() => {
      if (!started.controller.signal.aborted) resumeIntent.current = null;
    });
    return () => started.controller.abort();
  }, [agent, locale, startOperation]);

  useEffect(() => {
    if (!signInOpen) return;

    if (signInPurpose === "profile_search") {
      function resumeSearchAfterSignIn(): void {
        void handleProfileSearch(true);
      }
      window.addEventListener("focus", resumeSearchAfterSignIn);
      return () =>
        window.removeEventListener("focus", resumeSearchAfterSignIn);
    }

    if (signInPurpose !== "audit") return;

    function resumeAfterAppSignIn(): void {
      const storage = getSessionIntentStorage();
      const pending =
        (storage ? readPendingAgentIntent(storage, agent) : null) ??
        resumeIntent.current;
      if (
        !pending ||
        !isRunnablePendingAgentIntent(pending) ||
        !pending.confirmedProfile
      ) {
        return;
      }
      startOperation(pending.confirmedProfile, false, pending, true);
    }

    window.addEventListener("focus", resumeAfterAppSignIn);
    return () => window.removeEventListener("focus", resumeAfterAppSignIn);
  }, [agent, handleProfileSearch, signInOpen, signInPurpose, startOperation]);

  function handleProfileChange(next: AgentProfileDraft): void {
    activeOperationController.current?.abort();
    activeOperationController.current = null;
    operationId.current += 1;
    busy.current = false;
    setLoading(false);
    setErrorCode(null);
    setData(null);
    profileSearchController.current?.abort();
    profileSearchController.current = null;
    profileSearchBusy.current = false;
    setProfileSearchLoading(false);
    setProfileSearchData(null);
    setProfileSearchErrorCode(null);
    setProfile(next);
  }

  function handleProfileConfirm(confirmedProfile: AgentProfileDraft): void {
    if (confirmedProfile.agent !== agent || busy.current) return;
    setProfile(confirmedProfile);
    startOperation(confirmedProfile);
  }

  function handleDialogChange(open: boolean): void {
    setSignInOpen(open);
    if (!open) {
      const closingPurpose = signInPurpose;
      setSignInPurpose(null);
      if (closingPurpose !== "audit") return;
      activeOperationController.current?.abort();
      activeOperationController.current = null;
      operationId.current += 1;
      busy.current = false;
      setLoading(false);
      const storage = getSessionIntentStorage();
      if (storage) clearPendingAgentIntent(storage, agent);
      resumeIntent.current = null;
      if (errorCode === "auth_required") setErrorCode(null);
    }
  }

  const auditErrorKey =
    errorCode && EXISTING_AUDIT_ERROR_CODES.has(errorCode)
      ? (`errors.${errorCode}` as const)
      : null;
  const urlIsInvalid =
    errorCode !== null && URL_INPUT_ERROR_CODES.has(errorCode);

  return (
    <section
      id={`${agent}-agent-workbench`}
      data-agent={agent}
      className="scroll-mt-24"
      aria-busy={loading}
    >
      <AgentProfilePanel
        agent={agent}
        locale={locale}
        profile={profile}
        disabled={loading}
        onChange={handleProfileChange}
        onConfirm={handleProfileConfirm}
        errorId={errorCode ? `${agent}-agent-error` : undefined}
        urlInvalid={urlIsInvalid}
        profileSearch={{
          loading: profileSearchLoading,
          data: profileSearchData,
          errorCode: profileSearchErrorCode,
          onDiscover: () => {
            void handleProfileSearch();
          },
        }}
      />

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

      {data ? (
        <AgentResults
          key={`${agent}:${data.result.targetUrl}:${data.run.source.completedAt}`}
          agent={agent}
          locale={locale}
          data={data}
          profile={profile}
        />
      ) : null}

      <SignInDialog open={signInOpen} onOpenChange={handleDialogChange} />
    </section>
  );
}
