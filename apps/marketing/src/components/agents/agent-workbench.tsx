// @input  -- exact Agent identity, local Profile, session/audit endpoints, and intent handoff
// @output -- isolated four-stage Agent state with purpose-safe sign-in resume
// @pos    -- primary client workbench for independent /agents/seo and /agents/tech routes

"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  agentDraftToWebsiteProfile,
  importWebsiteProfile,
  referenceWebsiteProfile,
  type AgentWebsiteProfileRunContext,
} from "../../lib/account-websites/agent-profile-bridge.ts";
import {
  parseWebsiteDetails,
  type WebsiteDetails,
  type WebsiteProfileReferenceV1,
} from "../../lib/account-websites/contracts.ts";
import type { AgentAuditSuccessData } from "../../lib/agents/audit-contract";
import { isAgentAuditSuccessEnvelope } from "../../lib/agents/audit-contract";
import {
  defaultAgentRunOptions,
  parseAgentExtraKeyPages,
  type AgentRunOptions,
  type AgentRunTier,
} from "../../lib/agents/agent-run-options.ts";
import {
  isAgentProfileSearchEnvelope,
  type AgentProfileSearchData,
} from "../../lib/agents/profile-search-contract";
import {
  isAgentProfileRefreshEnvelope,
  type AgentProfileRefreshData,
  type AgentProfileRefreshMode,
} from "../../lib/agents/profile-refresh-contract";
import { SignInDialog } from "../auth/sign-in-dialog";
import { WebsiteProfilePicker } from "../account/website-profile-picker.tsx";
import { supportsAgentDisplayVocabulary } from "./agent-display-contract";
import { AgentProfilePanel } from "./agent-profile-panel";
import {
  applyAgentProfileRefresh,
  checkerHandoffEdits,
  createAgentProfileDraft,
  updateAgentProfile,
  type AgentProfileDraft,
} from "./agent-profile";
import {
  deriveProductProfileSearchSeeds,
  productProfileSearchSeedsIdentity,
} from "./agent-profile-search-seeds";
import { AgentResults } from "./agent-results";
import {
  clearPendingAgentIntent,
  getSessionIntentStorage,
  isProfileRefreshPendingAgentIntent,
  isProfileSearchPendingAgentIntent,
  isRunnablePendingAgentIntent,
  pendingAgentRunOptions,
  readPendingAgentIntent,
  restorePendingAgentIntent,
  schedulePendingAgentIntentExpiry,
  storeAgentProfileRefreshIntent,
  storeAgentProfileSearchIntent,
  storeConfirmedAgentRunIntent,
  type PendingAgentIntent,
} from "./agent-intent";
import { AGENT_ENDPOINT, type AgentKind } from "./agent-types";
import {
  clearOnPageDraft,
  readOnPageDraft,
} from "../../lib/on-page-checker/storage";

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

const PROFILE_SEARCH_CLIENT_TIMEOUT_MS = 35_000;
const PROFILE_REFRESH_CLIENT_TIMEOUT_MS = 110_000;

function canonicalLanguageTag(value: string): string | null {
  if (!value || value.length > 35) return null;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

function profileSearchRequestKey(
  profile: AgentProfileDraft,
  languageTag: string,
): string {
  const productProfileSearchSeeds = deriveProductProfileSearchSeeds(profile);
  return [
    profile.agent,
    profile.targetUrl,
    profile.host,
    profile.country,
    languageTag,
    profile.country === "CN" ? profile.targetQuery.trim() : "",
    productProfileSearchSeedsIdentity(productProfileSearchSeeds),
  ].join("\n");
}

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
type SignInPurpose = "audit" | "profile_search" | "profile_refresh";

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

type WebsiteProfileContextState = {
  readonly kind: "import" | "reference";
  readonly details: WebsiteDetails;
  readonly reference: WebsiteProfileReferenceV1 | null;
  readonly saveStatus: "idle" | "saving" | "saved" | "conflict" | "error";
};

async function websiteDetailsFromResponse(
  body: unknown,
  location: "data" | "conflict",
): Promise<WebsiteDetails | null> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const envelope = body as {
    readonly data?: { readonly website?: unknown };
    readonly error?: {
      readonly details?: { readonly website?: unknown };
    };
  };
  const website =
    location === "data"
      ? envelope.data?.website
      : envelope.error?.details?.website;
  try {
    return await parseWebsiteDetails(website);
  } catch {
    return null;
  }
}

/**
 * The queries this run should be judged against.
 *
 * A handoff from the page checker wins: the visitor chose those on the page
 * they came from. Otherwise the Profile's own confirmed query stands, which is
 * the whole point of asking for it.
 */
function targetQueriesFor(
  profile: AgentProfileDraft,
  handoff: readonly string[] | null,
): readonly string[] {
  if (handoff !== null && handoff.length > 0) return handoff;
  const confirmed = profile.targetQuery.trim();
  return confirmed === "" ? [] : [confirmed];
}

export function AgentWorkbench(props: AgentWorkbenchProps) {
  return <AgentWorkbenchInstance key={props.agent} {...props} />;
}

function AgentWorkbenchInstance({ agent, locale }: AgentWorkbenchProps) {
  const t = useTranslations("agents.workbench");
  const auditT = useTranslations("tools.seoAudit");
  /**
   * Target queries handed over by the page checker, if this visit came from it.
   *
   * Kept beside the profile rather than in it: the profile holds one
   * `targetQuery` for labelling, and the checker's question is up to five words
   * measured against one page. Only a handoff sets this, so an ordinary Agent
   * run keeps sending exactly what it sends today.
   */
  const [handoffQueries, setHandoffQueries] = useState<readonly string[] | null>(
    null,
  );
  const [profile, setProfile] = useState<AgentProfileDraft>(() =>
    createAgentProfileDraft(agent, "", locale),
  );
  const [runTier, setRunTier] = useState<AgentRunTier>(
    () => defaultAgentRunOptions(agent).tier,
  );
  const [extraKeyPagesInput, setExtraKeyPagesInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [data, setData] = useState<AgentAuditSuccessData | null>(null);
  /**
   * The Profile as confirmed for the captured run.
   *
   * A finished report survives later context edits, so the report has to keep
   * showing the context it was run under. Reading the live Profile here would
   * relabel a captured report with a market or query it never used.
   */
  const [runProfile, setRunProfile] = useState<AgentProfileDraft | null>(null);
  const [websiteProfileContext, setWebsiteProfileContext] =
    useState<WebsiteProfileContextState | null>(null);
  const [runWebsiteReference, setRunWebsiteReference] =
    useState<WebsiteProfileReferenceV1 | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInPurpose, setSignInPurpose] =
    useState<SignInPurpose | null>(null);
  const [profileSearchLoading, setProfileSearchLoading] = useState(false);
  const [profileSearchData, setProfileSearchData] =
    useState<AgentProfileSearchData | null>(null);
  const [profileSearchErrorCode, setProfileSearchErrorCode] = useState<
    string | null
  >(null);
  const [profileRefreshLoading, setProfileRefreshLoading] = useState(false);
  const [profileRefreshData, setProfileRefreshData] =
    useState<AgentProfileRefreshData | null>(null);
  const [profileRefreshErrorCode, setProfileRefreshErrorCode] = useState<
    string | null
  >(null);
  const mounted = useRef(true);
  const operationId = useRef(0);
  const busy = useRef(false);
  const resumeIntent = useRef<PendingAgentIntent | null>(null);
  const activeOperationController = useRef<AbortController | null>(null);
  const profileSearchController = useRef<AbortController | null>(null);
  const profileSearchBusy = useRef(false);
  const profileSearchDataRef = useRef<AgentProfileSearchData | null>(null);
  const profileSearchDataKey = useRef<string | null>(null);
  const pendingProfileSearch = useRef<{
    readonly profile: AgentProfileDraft;
    readonly requestKey: string;
  } | null>(null);
  const profileRefreshController = useRef<AbortController | null>(null);
  const profileRefreshBusy = useRef(false);
  const profileRefreshIntent = useRef<PendingAgentIntent | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const websiteProfileContextRef = useRef(websiteProfileContext);
  websiteProfileContextRef.current = websiteProfileContext;
  /**
   * The same value, reachable from `runAudit`.
   *
   * `runAudit` is memoized on `[agent]`, so it closes over the first render's
   * state and would read `null` here forever — the handoff restored the fields
   * and then sent a request without them, which is the entire feature missing
   * while every field-level assertion passed.
   */
  const handoffQueriesRef = useRef(handoffQueries);
  handoffQueriesRef.current = handoffQueries;

  const runAudit = useCallback(
    async (
      confirmedProfile: AgentProfileDraft,
      runOptions: AgentRunOptions,
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
          body: JSON.stringify({
            url: confirmedProfile.targetUrl,
            tier: runOptions.tier,
            ...(runOptions.extraKeyPages.length === 0
              ? {}
              : { extraKeyPages: runOptions.extraKeyPages }),
            /*
              The confirmed context, sent because it was confirmed.

              It used to travel only when the visit came from the page checker,
              so a run started from the Agent silently excluded every check about
              the target query or the page type -- eight of them -- while the
              surface went on showing the reviewed ranges for the page type it
              had just asked the visitor to confirm.

              The page type goes on its own: the endpoint validates it
              independently, and the page-shape checks need nothing else. The
              query list is omitted when empty rather than sent as `[]`, which
              the endpoint normalises to `empty_after_normalization` and refuses.
            */
            pageRole: confirmedProfile.pageType,
            ...(targetQueriesFor(confirmedProfile, handoffQueriesRef.current)
              .length === 0
              ? {}
              : {
                  targetQueries: targetQueriesFor(
                    confirmedProfile,
                    handoffQueriesRef.current,
                  ),
                }),
          }),
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
                : storeConfirmedAgentRunIntent(
                    storage,
                    confirmedProfile,
                    websiteProfileContextRef.current?.reference ?? null,
                    runOptions,
                  )
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
        setRunProfile(confirmedProfile);
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
      runOptions: AgentRunOptions,
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
        setRunProfile(null);
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
          setRunProfile(null);
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
            : storeConfirmedAgentRunIntent(
                storage,
                confirmedProfile,
                websiteProfileContextRef.current?.reference ?? null,
                runOptions,
              );
          if (!stored) {
            setSignInOpen(false);
            setSignInPurpose(null);
            setErrorCode(pendingIntent ? "intent_expired" : "intent_unavailable");
            return;
          }
          if (storage) schedulePendingAgentIntentExpiry(storage, stored);
          resumeIntent.current = stored;
          setSignInPurpose("audit");
          setSignInOpen(true);
          return;
        }

        setSignInOpen(false);
        setSignInPurpose(null);
        const storage = getSessionIntentStorage();
        if (storage) clearPendingAgentIntent(storage, agent);
        await runAudit(
          confirmedProfile,
          runOptions,
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
      confirmedProfile: AgentProfileDraft,
      runOptions: AgentRunOptions,
      replaceInterruptedResume = false,
      pendingIntent?: PendingAgentIntent,
      silentSignedOut = false,
    ) => {
      if (busy.current && !replaceInterruptedResume) return null;
      activeOperationController.current?.abort();
      setRunWebsiteReference(
        pendingIntent?.websiteProfileReference ??
          websiteProfileContextRef.current?.reference ??
          null,
      );
      const controller = new AbortController();
      activeOperationController.current = controller;
      const completion = gateAndRun(
        confirmedProfile,
        runOptions,
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
      profileRefreshController.current?.abort();
      profileRefreshController.current = null;
    };
  }, []);

  const runProfileSearch = useCallback(
    async (
      requestedProfile: AgentProfileDraft,
      {
        resumeAfterSignIn = false,
        reuseMatching = false,
      }: {
        readonly resumeAfterSignIn?: boolean;
        readonly reuseMatching?: boolean;
      } = {},
    ): Promise<void> => {
      const targetLanguageTag = canonicalLanguageTag(requestedProfile.locale);
      if (
        !mounted.current ||
        profileSearchBusy.current ||
        requestedProfile.agent !== agent ||
        !requestedProfile.targetUrl.trim() ||
        !/^[A-Z]{2}$/.test(requestedProfile.country) ||
        !targetLanguageTag ||
        (requestedProfile.country === "CN" &&
          !requestedProfile.targetQuery.trim())
      ) {
        return;
      }

      const requestKey = profileSearchRequestKey(
        requestedProfile,
        targetLanguageTag,
      );
      const productProfileSearchSeeds =
        deriveProductProfileSearchSeeds(requestedProfile);
      if (!resumeAfterSignIn) pendingProfileSearch.current = null;
      if (
        reuseMatching &&
        profileSearchDataRef.current !== null &&
        profileSearchDataKey.current === requestKey
      ) {
        return;
      }

      profileSearchController.current?.abort();
      const controller = new AbortController();
      profileSearchController.current = controller;
      profileSearchBusy.current = true;
      profileSearchDataRef.current = null;
      profileSearchDataKey.current = null;
      setProfileSearchLoading(true);
      setProfileSearchErrorCode(null);
      setProfileSearchData(null);

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let rejectAbort!: (reason?: unknown) => void;
      const abortRequest = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const rejectOnAbort = () =>
        rejectAbort(new DOMException("Profile search aborted", "AbortError"));
      controller.signal.addEventListener("abort", rejectOnAbort, {
        once: true,
      });

      try {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, PROFILE_SEARCH_CLIENT_TIMEOUT_MS);

        const response = await Promise.race([
          fetch(`/api/agents/${agent}/profile-search`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              url: requestedProfile.targetUrl,
              marketCode: requestedProfile.country,
              languageTag: targetLanguageTag,
              targetQuery: requestedProfile.targetQuery,
              productProfileSearchSeeds,
            }),
            signal: controller.signal,
          }),
          abortRequest,
        ]);
        const body = (await response.json().catch(() => null)) as unknown;
        if (
          !mounted.current ||
          controller.signal.aborted ||
          profileSearchController.current !== controller
        ) {
          return;
        }

        if (!response.ok) {
          const code = errorCodeOf(body) ?? "unknown";
          setProfileSearchErrorCode(code);
          if (code === "auth_required") {
            pendingProfileSearch.current = {
              profile: { ...requestedProfile },
              requestKey,
            };
            // Signing in reloads the page, so the draft has to outlive this tab
            // state or the visitor retypes everything they just entered.
            const storage = getSessionIntentStorage();
            if (storage) {
              const stored = storeAgentProfileSearchIntent(
                storage,
                requestedProfile,
              );
              if (stored) schedulePendingAgentIntentExpiry(storage, stored);
            }
            setSignInPurpose("profile_search");
            setSignInOpen(true);
          } else {
            pendingProfileSearch.current = null;
            if (resumeAfterSignIn) {
              setSignInOpen(false);
              setSignInPurpose(null);
            }
          }
          return;
        }

        if (
          !isAgentProfileSearchEnvelope(body) ||
          body.data.agent !== agent ||
          body.data.targetHost !== requestedProfile.host ||
          body.data.market.code !== requestedProfile.country
        ) {
          pendingProfileSearch.current = null;
          setProfileSearchErrorCode("audit_response_invalid");
          if (resumeAfterSignIn) {
            setSignInOpen(false);
            setSignInPurpose(null);
          }
          return;
        }
        profileSearchDataRef.current = body.data;
        profileSearchDataKey.current = requestKey;
        pendingProfileSearch.current = null;
        setProfileSearchData(body.data);
        if (resumeAfterSignIn) {
          setSignInOpen(false);
          setSignInPurpose(null);
        }
      } catch {
        if (
          timedOut &&
          mounted.current &&
          profileSearchController.current === controller
        ) {
          pendingProfileSearch.current = null;
          setProfileSearchErrorCode("search_timeout");
          if (resumeAfterSignIn) {
            setSignInOpen(false);
            setSignInPurpose(null);
          }
        } else if (mounted.current && !controller.signal.aborted) {
          pendingProfileSearch.current = null;
          setProfileSearchErrorCode("unknown");
          if (resumeAfterSignIn) {
            setSignInOpen(false);
            setSignInPurpose(null);
          }
        }
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", rejectOnAbort);
        if (profileSearchController.current === controller) {
          profileSearchController.current = null;
          profileSearchBusy.current = false;
          if (mounted.current) setProfileSearchLoading(false);
        }
      }
    },
    [agent],
  );

  const handleProfileRefresh = useCallback(
    async (
      mode: AgentProfileRefreshMode,
      requestedProfile: AgentProfileDraft,
    ): Promise<void> => {
      const targetLanguageTag = canonicalLanguageTag(requestedProfile.locale);
      if (
        !mounted.current ||
        profileRefreshBusy.current ||
        requestedProfile.agent !== agent ||
        !requestedProfile.targetUrl.trim() ||
        !/^[A-Z]{2}$/.test(requestedProfile.country) ||
        !targetLanguageTag
      ) {
        return;
      }

      profileRefreshController.current?.abort();
      const controller = new AbortController();
      profileRefreshController.current = controller;
      profileRefreshBusy.current = true;
      setProfileRefreshLoading(true);
      setProfileRefreshErrorCode(null);

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let rejectAbort!: (reason?: unknown) => void;
      const abortRequest = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const rejectOnAbort = () =>
        rejectAbort(new DOMException("Profile refresh aborted", "AbortError"));
      controller.signal.addEventListener("abort", rejectOnAbort, {
        once: true,
      });
      try {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, PROFILE_REFRESH_CLIENT_TIMEOUT_MS);

        let sessionStatus: SessionStatus;
        try {
          sessionStatus = await Promise.race([
            getSessionStatus(controller.signal),
            abortRequest,
          ]);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          sessionStatus = "unavailable";
        }
        if (!mounted.current || controller.signal.aborted) return;

        if (sessionStatus === "unavailable") {
          setProfileRefreshErrorCode("auth_unavailable");
          return;
        }
        if (sessionStatus === "signed_out") {
          const storage = getSessionIntentStorage();
          const stored = storage
            ? storeAgentProfileRefreshIntent(
                storage,
                requestedProfile,
                mode,
              )
            : null;
          if (!stored) {
            setProfileRefreshErrorCode("intent_unavailable");
            return;
          }
          if (storage) schedulePendingAgentIntentExpiry(storage, stored);
          profileRefreshIntent.current = stored;
          setSignInPurpose("profile_refresh");
          setSignInOpen(true);
          return;
        }

        const response = await Promise.race([
          fetch(`/api/agents/${agent}/profile-refresh`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              url: requestedProfile.targetUrl,
              marketCode: requestedProfile.country,
              languageTag: targetLanguageTag,
              outputLocale: locale,
              mode,
            }),
            signal: controller.signal,
          }),
          abortRequest,
        ]);
        const body = (await response.json().catch(() => null)) as unknown;
        if (
          !mounted.current ||
          controller.signal.aborted ||
          profileRefreshController.current !== controller
        ) {
          return;
        }
        if (!response.ok) {
          const code = errorCodeOf(body) ?? "unknown";
          setProfileRefreshErrorCode(code);
          if (code === "auth_required") {
            const storage = getSessionIntentStorage();
            const stored = storage
              ? storeAgentProfileRefreshIntent(
                  storage,
                  requestedProfile,
                  mode,
                )
              : null;
            if (!stored) {
              setProfileRefreshErrorCode("intent_unavailable");
              return;
            }
            if (storage) schedulePendingAgentIntentExpiry(storage, stored);
            profileRefreshIntent.current = stored;
            setSignInPurpose("profile_refresh");
            setSignInOpen(true);
          }
          return;
        }
        if (
          !isAgentProfileRefreshEnvelope(body) ||
          body.data.agent !== agent ||
          body.data.request.submittedUrl !== requestedProfile.targetUrl ||
          body.data.request.marketCode !== requestedProfile.country ||
          body.data.request.languageTag !== targetLanguageTag ||
          body.data.request.outputLocale !== locale
        ) {
          setProfileRefreshErrorCode("profile_response_invalid");
          return;
        }
        const currentProfile = profileRef.current;
        const mergeProfile =
          currentProfile.agent === requestedProfile.agent &&
          currentProfile.targetUrl === requestedProfile.targetUrl &&
          currentProfile.host === requestedProfile.host &&
          currentProfile.country === requestedProfile.country &&
          canonicalLanguageTag(currentProfile.locale) === targetLanguageTag
            ? currentProfile
            : requestedProfile;
        const mergedProfile = applyAgentProfileRefresh(
          mergeProfile,
          body.data,
        );
        if (mergedProfile === mergeProfile) {
          setProfileRefreshErrorCode("profile_response_invalid");
          return;
        }
        setProfile(mergedProfile);
        setProfileRefreshData(body.data);
        setSignInOpen(false);
        setSignInPurpose(null);
        profileRefreshIntent.current = null;
        const storage = getSessionIntentStorage();
        if (storage) clearPendingAgentIntent(storage, agent);
        void runProfileSearch(mergedProfile, { reuseMatching: true });
      } catch {
        if (
          timedOut &&
          mounted.current &&
          profileRefreshController.current === controller
        ) {
          setProfileRefreshErrorCode("profile_timeout");
        } else if (mounted.current && !controller.signal.aborted) {
          setProfileRefreshErrorCode("unknown");
        }
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", rejectOnAbort);
        if (profileRefreshController.current === controller) {
          profileRefreshController.current = null;
          profileRefreshBusy.current = false;
          if (mounted.current) setProfileRefreshLoading(false);
        }
      }
    },
    [agent, locale, runProfileSearch],
  );

  const handleProfileSearch = useCallback(
    async (resumeAfterSignIn = false): Promise<void> => {
      if (!resumeAfterSignIn) {
        await runProfileSearch(profileRef.current);
        return;
      }
      const pending = pendingProfileSearch.current;
      const currentLanguageTag = canonicalLanguageTag(
        profileRef.current.locale,
      );
      if (
        !pending ||
        !currentLanguageTag ||
        profileSearchRequestKey(profileRef.current, currentLanguageTag) !==
          pending.requestKey
      ) {
        pendingProfileSearch.current = null;
        setSignInPurpose(null);
        setSignInOpen(false);
        return;
      }
      await runProfileSearch(pending.profile, { resumeAfterSignIn: true });
    },
    [runProfileSearch],
  );

  useEffect(() => {
    const storage = getSessionIntentStorage();
    const pending =
      (storage ? readPendingAgentIntent(storage, agent) : null) ??
      resumeIntent.current;
    if (!pending) return;

    if (
      pending.purpose === "prepare_profile" ||
      pending.purpose === "page_focused_launch"
    ) {
      const base = createAgentProfileDraft(agent, pending.url, locale);
      // A visitor who came in asking about one page comes back asking about the
      // same page, with the same words. The checker leaves its own draft beside
      // the intent; reading only the URL out of the intent is what dropped the
      // queries, the market, the language and the page role on the way over.
      const checkerDraft =
        pending.purpose === "page_focused_launch" && storage
          ? readOnPageDraft(storage)
          : null;
      const scoped =
        pending.scope === "page"
          ? { ...base, auditScope: "page-only" as const }
          : base;
      /*
        Applied as an edit, not spread over the draft.
        
        Spreading set the values and left `fieldProvenance` saying `missing`,
        and readiness reads the provenance rather than the value — so the run
        button stayed disabled under a message naming market and language while
        both sat filled in and correct on screen. The only way out was to retype
        a value that was already right, which nobody would guess. The visitor
        did supply these, in the checker's own form, so the draft should say a
        person supplied them.
      */
      setProfile(
        checkerDraft
          ? updateAgentProfile(scoped, checkerHandoffEdits(checkerDraft))
          : scoped,
      );
      setHandoffQueries(checkerDraft ? checkerDraft.targetQueries : null);
      // Both slots are consumed: a draft that outlives its use is a stale URL
      // waiting to prefill someone else's form.
      if (storage) {
        clearPendingAgentIntent(storage, agent);
        clearOnPageDraft(storage);
      }
      return;
    }

    if (isProfileSearchPendingAgentIntent(pending)) {
      setProfile(pending.searchProfile);
      if (storage) clearPendingAgentIntent(storage, agent);
      return;
    }

    if (isProfileRefreshPendingAgentIntent(pending)) {
      profileRefreshIntent.current = pending;
      setProfile(pending.refreshProfile);
      void Promise.resolve().then(() =>
        handleProfileRefresh(
          pending.refreshMode,
          pending.refreshProfile,
        ),
      );
      return;
    }

    if (!isRunnablePendingAgentIntent(pending) || !pending.confirmedProfile) {
      if (storage) clearPendingAgentIntent(storage, agent);
      return;
    }
    resumeIntent.current = pending;
    setProfile(pending.confirmedProfile);
    const resumedRunOptions = pendingAgentRunOptions(pending);
    setRunTier(resumedRunOptions.tier);
    setExtraKeyPagesInput(resumedRunOptions.extraKeyPages.join("\n"));
    const started = startOperation(
      pending.confirmedProfile,
      resumedRunOptions,
      true,
      pending,
    );
    if (!started) return;
    void started.completion.finally(() => {
      if (!started.controller.signal.aborted) resumeIntent.current = null;
    });
    return () => started.controller.abort();
  }, [agent, handleProfileRefresh, locale, startOperation]);

  useEffect(() => {
    if (!signInOpen) return;

    if (signInPurpose === "profile_refresh") {
      function resumeRefreshAfterSignIn(): void {
        const storage = getSessionIntentStorage();
        const pending =
          (storage ? readPendingAgentIntent(storage, agent) : null) ??
          profileRefreshIntent.current;
        if (!pending || !isProfileRefreshPendingAgentIntent(pending)) return;
        void handleProfileRefresh(
          pending.refreshMode,
          pending.refreshProfile,
        );
      }
      window.addEventListener("focus", resumeRefreshAfterSignIn);
      return () =>
        window.removeEventListener("focus", resumeRefreshAfterSignIn);
    }

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
      const resumedRunOptions = pendingAgentRunOptions(pending);
      setRunTier(resumedRunOptions.tier);
      setExtraKeyPagesInput(resumedRunOptions.extraKeyPages.join("\n"));
      startOperation(
        pending.confirmedProfile,
        resumedRunOptions,
        false,
        pending,
        true,
      );
    }

    window.addEventListener("focus", resumeAfterAppSignIn);
    return () => window.removeEventListener("focus", resumeAfterAppSignIn);
  }, [
    agent,
    handleProfileRefresh,
    handleProfileSearch,
    signInOpen,
    signInPurpose,
    startOperation,
  ]);

  function websiteRunContext(
    current: AgentProfileDraft,
  ): AgentWebsiteProfileRunContext {
    return {
      agent,
      targetUrl: current.targetUrl,
      presentationLocale: locale,
      device: current.device,
      pageType: current.pageType,
      targetQuery: current.targetQuery,
      auditScope: current.auditScope,
    };
  }

  function websiteLabel(details: WebsiteDetails): string {
    return details.displayName ?? details.host;
  }

  function handleWebsiteProfileImport(details: WebsiteDetails): void {
    const source = details.currentConfirmedSnapshot?.profile ?? null;
    if (source === null) return;
    const imported = importWebsiteProfile(
      source,
      websiteRunContext(profileRef.current),
    );
    handleProfileChange(imported.draft);
    setWebsiteProfileContext({
      kind: "import",
      details,
      reference: null,
      saveStatus: "idle",
    });
  }

  async function handleWebsiteProfileReference(
    details: WebsiteDetails,
  ): Promise<void> {
    const snapshot = details.currentConfirmedSnapshot;
    if (snapshot === null) return;
    const requestedProfile = profileRef.current;
    const reference: WebsiteProfileReferenceV1 = {
      schemaVersion: snapshot.schemaVersion,
      websiteId: snapshot.websiteId,
      snapshotId: snapshot.snapshotId,
      snapshotRevision: snapshot.snapshotRevision,
      profileSchemaVersion: snapshot.profileSchemaVersion,
      profileHash: snapshot.profileHash,
    };
    try {
      const linked = await referenceWebsiteProfile(
        snapshot.profile,
        reference,
        websiteRunContext(requestedProfile),
      );
      const currentProfile = profileRef.current;
      if (
        !mounted.current ||
        currentProfile.agent !== requestedProfile.agent ||
        currentProfile.targetUrl !== requestedProfile.targetUrl ||
        currentProfile.host !== requestedProfile.host
      ) {
        return;
      }
      handleProfileChange(linked.draft);
      setWebsiteProfileContext({
        kind: "reference",
        details,
        reference: linked.reference,
        saveStatus: "idle",
      });
    } catch {
      setWebsiteProfileContext(null);
    }
  }

  async function handleWebsiteProfileSaveBack(): Promise<void> {
    const context = websiteProfileContextRef.current;
    if (context === null || context.saveStatus === "saving") return;
    const capturedProfile = profileRef.current;
    setWebsiteProfileContext({ ...context, saveStatus: "saving" });
    try {
      const mapped = agentDraftToWebsiteProfile(profileRef.current);
      const response = await fetch(
        "/api/account/websites/" + context.details.websiteId,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: "save_profile",
            baseVersion: context.details.draft?.draftVersion ?? 0,
            profile: mapped,
            ...(context.reference === null
              ? {}
              : { expectedReference: context.reference }),
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      const details = await websiteDetailsFromResponse(
        body,
        response.status === 409 ? "conflict" : "data",
      );
      if (
        !mounted.current ||
        details === null ||
        details.websiteId !== context.details.websiteId
      ) {
        throw new Error("invalid website save response");
      }
      const liveContext = websiteProfileContextRef.current;
      if (
        liveContext === null ||
        liveContext.kind !== context.kind ||
        liveContext.details.websiteId !== context.details.websiteId ||
        liveContext.reference?.snapshotId !== context.reference?.snapshotId
      ) {
        return;
      }
      if (response.status === 409) {
        setWebsiteProfileContext({
          ...liveContext,
          details,
          saveStatus: "conflict",
        });
        return;
      }
      if (response.status !== 200) throw new Error("website save failed");
      setWebsiteProfileContext({
        ...liveContext,
        details,
        saveStatus:
          profileRef.current === capturedProfile ? "saved" : "idle",
      });
    } catch {
      const liveContext = websiteProfileContextRef.current;
      if (
        mounted.current &&
        liveContext !== null &&
        liveContext.kind === context.kind &&
        liveContext.details.websiteId === context.details.websiteId &&
        liveContext.reference?.snapshotId === context.reference?.snapshotId
      ) {
        setWebsiteProfileContext({ ...liveContext, saveStatus: "error" });
      }
    }
  }

  function handleProfileChange(next: AgentProfileDraft): void {
    const websiteIdentityChanged =
      next.agent !== profile.agent ||
      next.targetUrl !== profile.targetUrl ||
      next.host !== profile.host;
    const refreshIdentityChanged =
      next.agent !== profile.agent ||
      next.targetUrl !== profile.targetUrl ||
      next.host !== profile.host ||
      next.country !== profile.country ||
      canonicalLanguageTag(next.locale) !== canonicalLanguageTag(profile.locale);
    const searchIdentityChanged =
      refreshIdentityChanged ||
      (next.country === "CN" &&
        next.targetQuery.trim() !== profile.targetQuery.trim());
    // A captured report is evidence about one URL. Editing the product context
    // that only labels that evidence must not abort a running crawl or throw
    // away a finished one; only changing what is being audited does.
    const auditIdentityChanged =
      next.agent !== profile.agent ||
      next.targetUrl !== profile.targetUrl ||
      next.host !== profile.host ||
      // Both values travel on an ordinary run. A page-checker handoff freezes
      // its own query list, so later Profile-label edits do not change that run.
      next.pageType !== profile.pageType ||
      (handoffQueries === null &&
        next.targetQuery.trim() !== profile.targetQuery.trim());
    // The handed-over queries are deliberately not compared here. They are set
    // once, by the effect that consumes the intent and deletes it, so within one
    // mount they cannot change from one question to another; a second handoff is
    // a fresh navigation. And the captured report publishes the queries it
    // measured inside its own evidence region, so it cannot be read as an answer
    // to different ones.
    if (auditIdentityChanged) {
      activeOperationController.current?.abort();
      activeOperationController.current = null;
      operationId.current += 1;
      busy.current = false;
      setLoading(false);
      setErrorCode(null);
      setData(null);
      setRunProfile(null);
      setRunWebsiteReference(null);
    }
    if (websiteIdentityChanged) {
      setWebsiteProfileContext(null);
    }
    if (searchIdentityChanged) {
      profileSearchController.current?.abort();
      profileSearchController.current = null;
      profileSearchBusy.current = false;
      profileSearchDataRef.current = null;
      profileSearchDataKey.current = null;
      pendingProfileSearch.current = null;
      setProfileSearchLoading(false);
      setProfileSearchData(null);
      setProfileSearchErrorCode(null);
      if (signInPurpose === "profile_search") {
        setSignInPurpose(null);
        setSignInOpen(false);
      }
    }
    if (refreshIdentityChanged) {
      profileRefreshController.current?.abort();
      profileRefreshController.current = null;
      profileRefreshBusy.current = false;
      setProfileRefreshLoading(false);
      setProfileRefreshData(null);
      setProfileRefreshErrorCode(null);
      profileRefreshIntent.current = null;
      const storage = getSessionIntentStorage();
      if (storage) clearPendingAgentIntent(storage, agent);
      if (signInPurpose === "profile_refresh") {
        setSignInPurpose(null);
        setSignInOpen(false);
      }
    }
    setProfile(next);
  }

  function clearAuditForRunOptionChange(): void {
    activeOperationController.current?.abort();
    activeOperationController.current = null;
    operationId.current += 1;
    busy.current = false;
    setLoading(false);
    setErrorCode(null);
    setData(null);
    setRunProfile(null);
    setRunWebsiteReference(null);
    resumeIntent.current = null;
    if (signInPurpose === "audit") {
      const storage = getSessionIntentStorage();
      if (storage) clearPendingAgentIntent(storage, agent);
      setSignInPurpose(null);
      setSignInOpen(false);
    }
  }

  function handleRunTierChange(nextTier: AgentRunTier): void {
    if (agent !== "seo" || loading || profileRefreshLoading || nextTier === runTier) {
      return;
    }
    clearAuditForRunOptionChange();
    setRunTier(nextTier);
  }

  function handleExtraKeyPagesInputChange(nextValue: string): void {
    if (
      agent !== "seo" ||
      loading ||
      profileRefreshLoading ||
      nextValue === extraKeyPagesInput
    ) {
      return;
    }
    clearAuditForRunOptionChange();
    setExtraKeyPagesInput(nextValue);
  }

  function handleProfileConfirm(
    confirmedProfile: AgentProfileDraft,
    selectedRunOptions?: AgentRunOptions,
  ): void {
    if (confirmedProfile.agent !== agent || busy.current) return;
    setProfile(confirmedProfile);
    startOperation(
      confirmedProfile,
      selectedRunOptions ?? defaultAgentRunOptions(agent),
    );
  }

  function handleDialogChange(open: boolean): void {
    setSignInOpen(open);
    if (!open) {
      const closingPurpose = signInPurpose;
      setSignInPurpose(null);
      if (closingPurpose === "profile_search") {
        profileSearchController.current?.abort();
        profileSearchController.current = null;
        profileSearchBusy.current = false;
        pendingProfileSearch.current = null;
        setProfileSearchLoading(false);
        if (profileSearchErrorCode === "auth_required") {
          setProfileSearchErrorCode(null);
        }
        return;
      }
      if (closingPurpose === "profile_refresh") {
        profileRefreshController.current?.abort();
        profileRefreshController.current = null;
        profileRefreshBusy.current = false;
        setProfileRefreshLoading(false);
        if (profileRefreshErrorCode === "auth_required") {
          setProfileRefreshErrorCode(null);
        }
        const storage = getSessionIntentStorage();
        if (storage) clearPendingAgentIntent(storage, agent);
        profileRefreshIntent.current = null;
        return;
      }
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
  const parsedExtraKeyPages = parseAgentExtraKeyPages(
    profile.targetUrl,
    extraKeyPagesInput,
  );
  const selectedRunOptions: AgentRunOptions = {
    tier: agent === "seo" ? runTier : "full-site",
    extraKeyPages:
      agent === "seo" && parsedExtraKeyPages.ok
        ? parsedExtraKeyPages.extraKeyPages
        : [],
  };

  return (
    <section
      id={`${agent}-agent-workbench`}
      data-agent={agent}
      className="scroll-mt-24"
      aria-busy={loading}
    >
      <div className="mb-4">
        <WebsiteProfilePicker
          targetUrl={profile.targetUrl}
          onImport={handleWebsiteProfileImport}
          onReference={(details) => {
            void handleWebsiteProfileReference(details);
          }}
        />
      </div>
      <AgentProfilePanel
        agent={agent}
        locale={locale}
        profile={profile}
        disabled={loading || profileRefreshLoading}
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
        profileRefresh={{
          loading: profileRefreshLoading,
          data: profileRefreshData,
          errorCode: profileRefreshErrorCode,
        }}
        onRefresh={(mode) => {
          void handleProfileRefresh(mode, profile);
        }}
        websiteProfile={
          websiteProfileContext === null
            ? undefined
            : {
                kind: websiteProfileContext.kind,
                websiteLabel: websiteLabel(websiteProfileContext.details),
                reference: websiteProfileContext.reference,
                saveStatus: websiteProfileContext.saveStatus,
                onSaveBack: () => {
                  void handleWebsiteProfileSaveBack();
                },
              }
        }
        runOptions={
          agent === "seo"
            ? {
                value: selectedRunOptions,
                extraKeyPagesInput,
                error: parsedExtraKeyPages.ok
                  ? null
                  : parsedExtraKeyPages.error,
                onTierChange: handleRunTierChange,
                onExtraKeyPagesInputChange: handleExtraKeyPagesInputChange,
              }
            : undefined
        }
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
        <>
          {runWebsiteReference === null ? null : (
            <p
              data-run-website-reference
              data-snapshot-revision={runWebsiteReference.snapshotRevision}
              data-profile-hash={runWebsiteReference.profileHash}
              className="mt-5 font-mono text-[10.5px] text-text-dark-faint"
            >
              {t("websiteProfile.runReference", {
                revision: runWebsiteReference.snapshotRevision,
                hash: runWebsiteReference.profileHash.slice(0, 10),
              })}
            </p>
          )}
          <AgentResults
            key={`${agent}:${data.result.targetUrl}:${data.run.source.completedAt}`}
            agent={agent}
            locale={locale}
            data={data}
            profile={runProfile ?? profile}
            {...(agent === "seo" && data.result.crawlTier === "key-pages" ? {
              onChooseFullSite: () => {
                handleRunTierChange("full-site");
                document.getElementById("seo-agent-run-tier")?.focus();
              },
            } : {})}
          />
        </>
      ) : null}

      <SignInDialog open={signInOpen} onOpenChange={handleDialogChange} />
    </section>
  );
}
