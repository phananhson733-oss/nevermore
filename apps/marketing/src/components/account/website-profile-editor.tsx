// @input  -- one owned website ID, its private detail API, and SEO profile refresh
// @output -- single-column profile, source-labeled competitor review, autosave and collapsible confirmation
// @pos    -- stateful body of /account/websites/[websiteId]
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Minus, Pencil, Plus } from "lucide-react";

import {
  applyProfileRefreshToWebsiteDraft,
} from "../../lib/account-websites/agent-profile-bridge.ts";
import {
  classifyWebsiteCompetitorDraft,
  websiteCompetitorSearchIdentity,
  websiteCompetitorSearchRequest,
  type WebsiteCompetitorSearchRequest,
} from "../../lib/account-websites/competitor-discovery.ts";
import {
  WEBSITE_PROFILE_FIELD_NAMES,
  emptyMarketingWebsiteProfile,
  isMarketingWebsiteProfileReady,
  parseMarketingWebsiteProfile,
  parseWebsiteDetails,
  type MarketingWebsiteProfileV1,
  type WebsiteDetails,
  type WebsiteProfileFieldName,
  type WebsiteProfileFieldProvenance,
} from "../../lib/account-websites/contracts.ts";
import {
  isAgentProfileRefreshEnvelope,
  type AgentProfileRefreshAvailability,
} from "../../lib/agents/profile-refresh-contract.ts";
import {
  isAgentProfileSearchEnvelope,
  normalizeAgentProfileSearchDomain,
  type AgentProfileSearchData,
} from "../../lib/agents/profile-search-contract.ts";
import {
  AgentProfileSearch,
  type AgentProfileSearchCopy,
} from "../agents/agent-profile-search.tsx";
import {
  deriveAgentCompetitorDisplayFrame,
  deriveAgentCompetitorSuggestions,
  type AgentCompetitorClassification,
  type AgentCompetitorDisplayEntry,
} from "../agents/agent-competitor-candidates.ts";
import { Button } from "../ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { profileRefreshReason, type ProfileRefreshReason } from "../../lib/account-websites/refresh-error.ts";
import { ACCOUNT_AUTOSAVE_DELAY_MS } from "./autosave-delay.ts";
import { ProfileRefreshReview } from "./profile-refresh-review.tsx";

const AUTOSAVE_DELAY_MS = ACCOUNT_AUTOSAVE_DELAY_MS;
const PROFILE_SEARCH_CLIENT_TIMEOUT_MS = 35_000;
const PROFILE_SEARCH_RESPONSE_LIMIT_BYTES = 256 * 1_024;
const PROFILE_SEARCH_PUBLIC_ERROR_CODES = new Set([
  "auth_required",
  "auth_unavailable",
  "unsupported_media_type",
  "payload_too_large",
  "invalid_request",
  "invalid_url",
  "search_in_progress",
]);
const REQUIRED_FIELDS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "primaryIcp",
  "locale",
] as const satisfies readonly WebsiteProfileFieldName[];
const LIST_FIELDS = new Set<WebsiteProfileFieldName>([
  "coreFeatures",
  "categories",
  "trustSignals",
  "icpInterests",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
]);

function hasBlankListItem(profile: MarketingWebsiteProfileV1): boolean {
  return [...LIST_FIELDS].some((field) => {
    const value = profile[field];
    return Array.isArray(value) && value.some((item) => item.trim() === "");
  });
}
const PRODUCT_FIELDS = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
] as const satisfies readonly WebsiteProfileFieldName[];
const ICP_FIELDS = [
  "primaryIcp",
  "buyer",
  "user",
  "triggerPain",
  "icpInterests",
  "icpPain",
  "icpBehavior",
  "icpPositioning",
  "jtbd",
  "useCases",
  "outcomes",
  "barriers",
  "qualificationSignals",
  "disqualifiers",
] as const satisfies readonly WebsiteProfileFieldName[];
const COMPETITOR_GROUPS = [
  { classification: "direct", field: "directCompetitors" },
  { classification: "indirect", field: "indirectAlternatives" },
  { classification: "excluded", field: "excludedAlternatives" },
] as const;
const MARKET_FIELDS = [
  "country",
  "locale",
] as const satisfies readonly WebsiteProfileFieldName[];

type SaveState = "saved" | "unsaved" | "saving" | "failed";
type RefreshState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "error"; readonly reason: ProfileRefreshReason | null }
  | {
      readonly status: "review";
      readonly proposal: MarketingWebsiteProfileV1;
      readonly availability: AgentProfileRefreshAvailability;
    };
type CompetitorSearchState =
  | { readonly status: "idle" | "pending" | "loading" }
  | {
      readonly status: "result";
      readonly requestIdentity: string;
      readonly data: AgentProfileSearchData;
    }
  | {
      readonly status: "error";
      readonly requestIdentity: string | null;
      readonly code: string;
    };

interface ReadyEditor {
  readonly phase: "ready";
  readonly details: WebsiteDetails;
  readonly profile: MarketingWebsiteProfileV1;
  readonly saveState: SaveState;
  readonly conflict: WebsiteDetails | null;
  readonly conflictChoices: Readonly<
    Partial<Record<WebsiteProfileFieldName, "local" | "server">>
  >;
  readonly refresh: RefreshState;
  readonly competitorSearch: CompetitorSearchState;
  readonly confirming: boolean;
  readonly collapsed: boolean;
  readonly confirmError: readonly WebsiteProfileFieldName[] | null;
}

type EditorState =
  | { readonly phase: "loading" | "signed-out" | "unavailable" | "not-found" }
  | ReadyEditor;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredValue = response.headers.get("content-length");
  if (declaredValue !== null) {
    const declaredBytes = Number(declaredValue);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > PROFILE_SEARCH_RESPONSE_LIMIT_BYTES
    ) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
  }
  if (response.body === null) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > PROFILE_SEARCH_RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function responseErrorCode(body: unknown): string {
  const code = record(record(body)?.error)?.code;
  return typeof code === "string" && PROFILE_SEARCH_PUBLIC_ERROR_CODES.has(code)
    ? code
    : "unknown";
}

async function websiteFromData(body: unknown): Promise<WebsiteDetails | null> {
  const website = record(record(body)?.data)?.website;
  try {
    return await parseWebsiteDetails(website);
  } catch {
    return null;
  }
}

async function websiteFromConflict(
  body: unknown,
): Promise<WebsiteDetails | null> {
  const website = record(record(record(body)?.error)?.details)?.website;
  try {
    return await parseWebsiteDetails(website);
  } catch {
    return null;
  }
}

function defaultProfile(locale: string): MarketingWebsiteProfileV1 {
  return {
    ...emptyMarketingWebsiteProfile(),
    country: locale === "zh" ? "CN" : "US",
    locale: locale === "zh" ? "zh-CN" : "en-US",
  };
}

function editableProfile(
  details: WebsiteDetails,
  locale: string,
): MarketingWebsiteProfileV1 {
  return (
    details.draft?.profile ??
    details.currentConfirmedSnapshot?.profile ??
    defaultProfile(locale)
  );
}

function userEditedProfile(
  profile: MarketingWebsiteProfileV1,
  field: WebsiteProfileFieldName,
  value: string | readonly string[],
): MarketingWebsiteProfileV1 {
  const path = ("/" + field) as WebsiteProfileFieldProvenance["path"];
  const provenance: WebsiteProfileFieldProvenance = {
    path,
    derivation: "declared",
    confidence: "high",
    source: "user_edit",
    limitation: null,
    observedAt: null,
    evidenceUrls: [],
  };
  return {
    ...profile,
    [field]: Array.isArray(value) ? [...value] : value,
    fieldProvenance: [
      ...profile.fieldProvenance.filter((entry) => entry.path !== path),
      provenance,
    ],
  };
}

function valueEqual(
  left: MarketingWebsiteProfileV1[WebsiteProfileFieldName],
  right: MarketingWebsiteProfileV1[WebsiteProfileFieldName],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function profileEqual(
  left: MarketingWebsiteProfileV1,
  right: MarketingWebsiteProfileV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function competitorSummaryEntries(
  entries: readonly AgentCompetitorDisplayEntry[],
  savedValues: readonly string[],
): readonly { readonly value: string; readonly source: "saved" | "system" }[] {
  const values = entries.map((entry) => ({
    value: entry.domain,
    source: entry.source === "system" ? "system" as const : "saved" as const,
  }));
  const seen = new Set(values.map(({ value }) => value.toLowerCase()));
  for (const value of savedValues) {
    const trimmed = value.trim();
    // Alternatives may be free-text products or workflows, not hostnames.
    if (
      !trimmed ||
      normalizeAgentProfileSearchDomain(trimmed) !== null ||
      seen.has(trimmed.toLowerCase())
    ) {
      continue;
    }
    seen.add(trimmed.toLowerCase());
    values.push({ value: trimmed, source: "saved" });
  }
  return values;
}

function competitorSearchRequestForProfile(
  profile: MarketingWebsiteProfileV1,
  submittedUrl: string,
): WebsiteCompetitorSearchRequest | null {
  return websiteCompetitorSearchRequest(
    {
      ...emptyMarketingWebsiteProfile(),
      productName: profile.productName,
      oneLinePositioning: profile.oneLinePositioning,
      coreFeatures: profile.coreFeatures,
      categories: profile.categories,
      country: profile.country,
      locale: profile.locale,
      fieldProvenance: profile.fieldProvenance.filter(
        (entry) =>
          entry.path === "/productName" ||
          entry.path === "/oneLinePositioning" ||
          entry.path === "/coreFeatures" ||
          entry.path === "/categories",
      ),
    },
    submittedUrl,
  );
}

function competitorSearchIdentityForProfile(
  profile: MarketingWebsiteProfileV1,
  submittedUrl: string,
): string | null {
  const request = competitorSearchRequestForProfile(profile, submittedUrl);
  return request === null ? null : websiteCompetitorSearchIdentity(request);
}

function sourceProfile(details: WebsiteDetails): MarketingWebsiteProfileV1 {
  return (
    details.draft?.profile ??
    details.currentConfirmedSnapshot?.profile ??
    emptyMarketingWebsiteProfile()
  );
}

function missingRequired(
  profile: MarketingWebsiteProfileV1,
): readonly WebsiteProfileFieldName[] {
  return REQUIRED_FIELDS.filter((field) => {
    const value = profile[field];
    return typeof value === "string" && value.trim() === "";
  });
}

function confirmationErrorFields(
  body: unknown,
): readonly WebsiteProfileFieldName[] {
  const fields = record(record(body)?.error)?.fields;
  if (!Array.isArray(fields)) return [];
  const allowed = new Set<string>(WEBSITE_PROFILE_FIELD_NAMES);
  return fields.filter(
    (field): field is WebsiteProfileFieldName =>
      typeof field === "string" && allowed.has(field),
  );
}

function confirmedChangedFields(
  profile: MarketingWebsiteProfileV1,
  details: WebsiteDetails,
): readonly WebsiteProfileFieldName[] {
  const confirmed = details.currentConfirmedSnapshot?.profile;
  if (confirmed === undefined) {
    return WEBSITE_PROFILE_FIELD_NAMES.filter((field) => {
      const value = profile[field];
      return typeof value !== "string"
        ? value.length > 0
        : value.trim() !== "";
    });
  }
  return WEBSITE_PROFILE_FIELD_NAMES.filter(
    (field) => !valueEqual(profile[field], confirmed[field]),
  );
}

function applyProposal(
  current: MarketingWebsiteProfileV1,
  proposal: MarketingWebsiteProfileV1,
  fields: readonly WebsiteProfileFieldName[],
): MarketingWebsiteProfileV1 {
  const selected = new Set(fields);
  const values: Record<string, unknown> = { ...current };
  for (const field of fields) {
    const value = proposal[field];
    values[field] = Array.isArray(value) ? [...value] : value;
  }
  const selectedPaths = new Set(fields.map((field) => "/" + field));
  const provenance = [
    ...current.fieldProvenance.filter(
      (entry) => !selectedPaths.has(entry.path),
    ),
    ...proposal.fieldProvenance
      .filter((entry) => selected.has(entry.path.slice(1) as WebsiteProfileFieldName))
      .map((entry) => ({ ...entry, evidenceUrls: [...entry.evidenceUrls] })),
  ];
  return parseMarketingWebsiteProfile({
    ...values,
    fieldProvenance: provenance,
  });
}

function FieldEditor({
  field,
  profile,
  onChange,
}: {
  readonly field: WebsiteProfileFieldName;
  readonly profile: MarketingWebsiteProfileV1;
  readonly onChange: (
    field: WebsiteProfileFieldName,
    value: string | readonly string[],
  ) => void;
}) {
  const label = useTranslations("account.websites.fields");
  const editor = useTranslations("account.websites.editor");
  const id = "website-profile-" + field;
  const value = profile[field];

  if (LIST_FIELDS.has(field) && Array.isArray(value)) {
    return (
      <fieldset data-list-field={field} className="min-w-0 space-y-2">
        <legend className="mb-3 text-[14px] font-medium text-text-dark-primary">
          {label(field)}
        </legend>
        {value.map((item, index) => (
          <div key={field + "-" + index} className="flex items-start gap-2">
            <Input
              className="flex-1"
              aria-label={label(field) + " " + (index + 1)}
              name={`${field}[${index}]`}
              autoComplete="off"
              value={item}
              maxLength={500}
              onChange={(event) => {
                const next = [...value];
                next[index] = event.target.value;
                onChange(field, next);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 hover:border-brand-error/50 hover:bg-brand-error/5 hover:text-brand-error"
              aria-label={editor("listRemove") + " " + label(field) + " " + (index + 1)}
              title={editor("listRemove") + " " + label(field) + " " + (index + 1)}
              onClick={() =>
                onChange(
                  field,
                  value.filter((_entry, itemIndex) => itemIndex !== index),
                )
              }
            >
              <Minus aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 text-brand-accent-text hover:bg-brand-accent-soft"
          aria-label={editor("listAdd") + " " + label(field)}
          title={editor("listAdd") + " " + label(field)}
          onClick={() => onChange(field, [...value, ""])}
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      </fieldset>
    );
  }

  const stringValue = typeof value === "string" ? value : "";
  const compact =
    field === "productName" ||
    field === "primaryCta" ||
    field === "country" ||
    field === "locale";
  return (
    <div className="min-w-0 space-y-3">
      <Label htmlFor={id} className="text-[14px] text-text-dark-primary">
        {label(field)}
      </Label>
      {compact ? (
        <Input
          id={id}
          name={field}
          autoComplete="off"
          value={stringValue}
          maxLength={2_000}
          onChange={(event) => onChange(field, event.target.value)}
        />
      ) : (
        <Textarea
          id={id}
          name={field}
          autoComplete="off"
          value={stringValue}
          maxLength={2_000}
          rows={3}
          onChange={(event) => onChange(field, event.target.value)}
        />
      )}
    </div>
  );
}

function ProfileSection({
  title,
  fields,
  profile,
  onChange,
}: {
  readonly title: string;
  readonly fields: readonly WebsiteProfileFieldName[];
  readonly profile: MarketingWebsiteProfileV1;
  readonly onChange: (
    field: WebsiteProfileFieldName,
    value: string | readonly string[],
  ) => void;
}) {
  const headingId = "website-profile-section-" + fields[0];
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className="gap-0 overflow-hidden border-brand-border-strong py-0"
    >
      <CardHeader className="border-b bg-brand-panel-raised px-5 py-5 sm:px-7">
        <CardTitle>
          <h2 id={headingId} className="flex items-center gap-3 text-[17px]">
            <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />
            {title}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-brand-border-card px-5 sm:px-7">
        {fields.map((field) => (
          <div key={field} className="py-6 sm:py-7">
            <FieldEditor
              field={field}
              profile={profile}
              onChange={onChange}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function WebsiteProfileEditor({
  websiteId,
  autoGenerate,
  onConfirmedRevisionChange,
  onProfileAvailabilityChange,
}: {
  readonly websiteId: string;
  readonly autoGenerate: boolean;
  readonly onConfirmedRevisionChange?: (revision: number | null) => void;
  readonly onProfileAvailabilityChange?: (available: boolean) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("account.websites.editor");
  const fieldName = useTranslations("account.websites.fields");
  const profileT = useTranslations("agents.workbench.profile");
  const [state, setState] = useState<EditorState>({ phase: "loading" });
  const stateRef = useRef<EditorState>(state);
  const autoGenerateStarted = useRef(false);
  const refreshController = useRef<AbortController | null>(null);
  const competitorSearchController = useRef<AbortController | null>(null);
  const competitorSearchControllerIdentity = useRef<string | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const wasCollapsed = useRef(false);
  stateRef.current = state;
  const collapsed = state.phase === "ready" && state.collapsed;
  const confirmedRevision = state.phase === "ready"
    ? state.details.currentConfirmedSnapshot?.snapshotRevision ?? null : undefined;

  useEffect(() => {
    if (confirmedRevision !== undefined) onConfirmedRevisionChange?.(confirmedRevision);
  }, [confirmedRevision, onConfirmedRevisionChange]);
  const profileAvailable = state.phase === "loading" ? undefined : state.phase === "ready";
  useEffect(() => {
    if (profileAvailable !== undefined) onProfileAvailabilityChange?.(profileAvailable);
  }, [profileAvailable, onProfileAvailabilityChange]);

  useEffect(() => {
    if (collapsed) {
      summaryRef.current?.focus();
      summaryRef.current?.scrollIntoView?.({ block: "start" });
    } else if (wasCollapsed.current) {
      document.getElementById("website-profile-productName")?.focus();
    }
    wasCollapsed.current = collapsed;
  }, [collapsed]);

  const competitorSearchErrorCode =
    state.phase === "ready" && state.competitorSearch.status === "error"
      ? state.competitorSearch.code
      : null;
  const profileSearchCopy = {
    eyebrow: profileT("search.eyebrow"),
    title: profileT("search.title"),
    description: profileT("search.description"),
    action: profileT("search.action"),
    loadingAction: profileT("search.loadingAction"),
    organicBoundary: profileT("search.organicBoundary"),
    serpBoundary: profileT("search.serpBoundary"),
    seedSerpBoundary: profileT("search.seedSerpBoundary"),
    noData: profileT("search.noData"),
    marketUnsupported: profileT("search.marketUnsupported"),
    sourceUnavailable: profileT("search.sourceUnavailable"),
    requestError:
      competitorSearchErrorCode === "auth_required"
        ? profileT("search.errors.authRequired")
        : competitorSearchErrorCode === "auth_unavailable"
          ? profileT("search.errors.authUnavailable")
          : competitorSearchErrorCode === "search_timeout"
            ? profileT("search.errors.searchTimeout")
            : profileT("search.errors.requestFailed"),
    domainLabel: profileT("search.domainLabel"),
    intersectionsLabel: profileT("search.intersectionsLabel"),
    averagePositionLabel: profileT("search.averagePositionLabel"),
    medianPositionLabel: profileT("search.medianPositionLabel"),
    ratingLabel: profileT("search.ratingLabel"),
    trafficLabel: profileT("search.trafficLabel"),
    keywordsCountLabel: profileT("search.keywordsCountLabel"),
    visibilityLabel: profileT("search.visibilityLabel"),
    relevantSerpItemsLabel: profileT("search.relevantSerpItemsLabel"),
    rankLabel: profileT("search.rankLabel"),
    observedAtLabel: profileT("search.observedAtLabel"),
    unavailableMetricLabel: profileT("search.unavailableMetricLabel"),
    providerCountLabel: profileT("search.counts.providerLabel"),
    confirmedCountLabel: profileT("search.counts.confirmedLabel"),
    excludedCountLabel: profileT("search.counts.excludedLabel"),
    providerEvidenceLabel: profileT("search.review.providerEvidence"),
    seedSerpEvidenceLabel: profileT("search.review.seedSerpEvidence"),
    suggestedDirectLabel: profileT("search.review.suggestedDirect"),
    suggestedIndirectLabel: profileT("search.review.suggestedIndirect"),
    higherOverlapLabel: profileT("search.review.higherOverlap"),
    adjacentOverlapLabel: profileT("search.review.adjacentOverlap"),
    unclassifiedLabel: profileT("search.review.targetQueryObserved"),
    seedSerpObservedLabel: profileT("search.review.seedSerpObserved"),
    currentDirectLabel: profileT("search.review.currentDirect"),
    currentIndirectLabel: profileT("search.review.currentIndirect"),
    currentExcludedLabel: profileT("search.review.currentExcluded"),
    directAction: profileT("search.review.actions.direct"),
    indirectAction: profileT("search.review.actions.indirect"),
    excludeAction: profileT("search.review.actions.exclude"),
  } satisfies AgentProfileSearchCopy;

  useEffect(
    () => () => {
      refreshController.current?.abort();
      refreshController.current = null;
      competitorSearchController.current?.abort();
      competitorSearchController.current = null;
      competitorSearchControllerIdentity.current = null;
    },
    [],
  );

  useEffect(() => {
    refreshController.current?.abort();
    refreshController.current = null;
    competitorSearchController.current?.abort();
    competitorSearchController.current = null;
    competitorSearchControllerIdentity.current = null;
    autoGenerateStarted.current = false;
  }, [websiteId]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: "loading" });
    void fetch("/api/account/websites/" + websiteId, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setState({ phase: "signed-out" });
          return;
        }
        if (response.status === 404) {
          setState({ phase: "not-found" });
          return;
        }
        if (response.status !== 200) {
          setState({ phase: "unavailable" });
          return;
        }
        const details = await websiteFromData(await readJson(response));
        if (controller.signal.aborted) return;
        if (details === null || details.websiteId !== websiteId) {
          setState({ phase: "unavailable" });
          return;
        }
        setState({
          phase: "ready",
          details,
          profile: editableProfile(details, locale),
          saveState: "saved",
          conflict: null,
          conflictChoices: {},
          refresh: { status: "idle" },
          competitorSearch: { status: "idle" },
          confirming: false,
          collapsed: false,
          confirmError: null,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "unavailable" });
      });
    return () => controller.abort();
  }, [locale, websiteId]);

  const saveDraft = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (
      current.phase !== "ready" ||
      current.confirming ||
      current.saveState === "saving" ||
      hasBlankListItem(current.profile) ||
      current.details.draft?.draftVersion === undefined &&
        current.saveState === "saved"
    ) {
      return;
    }
    if (current.conflict !== null) {
      const serverProfile = sourceProfile(current.conflict);
      const unresolved = WEBSITE_PROFILE_FIELD_NAMES.some(
        (field) =>
          !valueEqual(current.profile[field], serverProfile[field]) &&
          current.conflictChoices[field] === undefined,
      );
      if (unresolved) return;
    }
    const captured = current.profile;
    const baseVersion = current.details.draft?.draftVersion ?? 0;
    setState((latest) =>
      latest.phase === "ready"
        ? { ...latest, saveState: "saving", confirmError: null }
        : latest,
    );
    try {
      const response = await fetch("/api/account/websites/" + websiteId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "save_profile",
          baseVersion,
          profile: captured,
        }),
      });
      const body = await readJson(response);
      if (response.status === 409) {
        const server = await websiteFromConflict(body);
        if (server === null || server.websiteId !== websiteId) {
          throw new Error("invalid conflict");
        }
        setState((latest) =>
          latest.phase === "ready"
            ? {
                ...latest,
                details: server,
                saveState: "unsaved",
                conflict: server,
                conflictChoices: {},
              }
            : latest,
        );
        return;
      }
      if (response.status !== 200) throw new Error("save failed");
      const saved = await websiteFromData(body);
      const savedDraft = saved?.draft ?? null;
      if (
        saved === null ||
        saved.websiteId !== websiteId ||
        savedDraft === null
      ) {
        throw new Error("invalid save response");
      }
      setState((latest) => {
        if (latest.phase !== "ready") return latest;
        const unchanged = profileEqual(latest.profile, captured);
        return {
          ...latest,
          details: saved,
          profile: unchanged ? savedDraft.profile : latest.profile,
          saveState: unchanged ? "saved" : "unsaved",
          conflict: null,
          conflictChoices: {},
          confirmError: null,
        };
      });
    } catch {
      setState((latest) =>
        latest.phase === "ready"
          ? { ...latest, saveState: "failed" }
          : latest,
      );
    }
  }, [websiteId]);

  const runRefresh = useCallback(
    async (mode: "prefer_cache" | "refresh"): Promise<void> => {
      const current = stateRef.current;
      if (current.phase !== "ready" || current.refresh.status === "loading") {
        return;
      }
      refreshController.current?.abort();
      const controller = new AbortController();
      refreshController.current = controller;
      const marketCode = /^[A-Z]{2}$/u.test(current.profile.country)
        ? current.profile.country
        : locale === "zh"
          ? "CN"
          : "US";
      let languageTag = current.profile.locale;
      try {
        if (Intl.getCanonicalLocales(languageTag)[0] !== languageTag) {
          languageTag = locale === "zh" ? "zh-CN" : "en-US";
        }
      } catch {
        languageTag = locale === "zh" ? "zh-CN" : "en-US";
      }
      setState((latest) =>
        latest.phase === "ready"
          ? { ...latest, refresh: { status: "loading" } }
          : latest,
      );
      try {
        const response = await fetch("/api/agents/seo/profile-refresh", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            url: current.details.submittedUrl,
            marketCode,
            languageTag,
            outputLocale: locale,
            mode,
          }),
          signal: controller.signal,
        });
        const body = await readJson(response);
        if (controller.signal.aborted) return;
        if (
          response.status !== 200 ||
          !isAgentProfileRefreshEnvelope(body) ||
          body.data.agent !== "seo" ||
          body.data.request.submittedUrl !== current.details.submittedUrl ||
          body.data.request.marketCode !== marketCode ||
          body.data.request.languageTag !== languageTag ||
          body.data.request.outputLocale !== locale
        ) {
          // A refused scan carries a reason. A 200 whose envelope does not
          // match this request is a different problem and stays unnamed.
          const reason =
            response.status === 200
              ? null
              : profileRefreshReason(body, response.status);
          setState((latest) =>
            latest.phase === "ready"
              ? { ...latest, refresh: { status: "error", reason } }
              : latest,
          );
          return;
        }
        setState((latest) => {
          if (
            latest.phase !== "ready" ||
            latest.details.websiteId !== current.details.websiteId ||
            latest.details.websiteId !== websiteId
          ) {
            return latest;
          }
          let proposal: MarketingWebsiteProfileV1;
          try {
            proposal = applyProfileRefreshToWebsiteDraft(
              latest.profile,
              body.data,
              {
                origin: latest.details.origin,
                canonicalSiteKey: latest.details.canonicalSiteKey,
              },
            );
          } catch {
            return { ...latest, refresh: { status: "error", reason: null } };
          }
          return mode === "prefer_cache" &&
            latest.details.draft === null &&
            body.data.availability !== "no_data"
            ? {
                ...latest,
                profile: proposal,
                saveState: "unsaved",
                refresh: { status: "idle" },
                competitorSearch: { status: "pending" },
              }
            : {
                ...latest,
                refresh: {
                  status: "review",
                  proposal,
                  availability: body.data.availability,
                },
              };
        });
      } catch {
        if (!controller.signal.aborted) {
          setState((latest) =>
            latest.phase === "ready"
              ? { ...latest, refresh: { status: "error", reason: null } }
              : latest,
          );
        }
      } finally {
        if (refreshController.current === controller) {
          refreshController.current = null;
        }
      }
    },
    [locale, websiteId],
  );

  const runCompetitorSearch = useCallback(
    async (requestedProfile: MarketingWebsiteProfileV1): Promise<void> => {
      const current = stateRef.current;
      if (current.phase !== "ready") return;

      const request = competitorSearchRequestForProfile(
        requestedProfile,
        current.details.submittedUrl,
      );
      if (request === null) {
        setState((latest) =>
          latest.phase === "ready" &&
          latest.competitorSearch.status === "pending"
            ? { ...latest, competitorSearch: { status: "idle" } }
            : latest,
        );
        return;
      }

      const requestIdentity = websiteCompetitorSearchIdentity(request);
      if (
        competitorSearchController.current !== null &&
        competitorSearchControllerIdentity.current === requestIdentity
      ) {
        return;
      }
      const capturedDetails = current.details;
      competitorSearchController.current?.abort();
      const controller = new AbortController();
      competitorSearchController.current = controller;
      competitorSearchControllerIdentity.current = requestIdentity;
      setState((latest) =>
        latest.phase === "ready" &&
        latest.details.websiteId === capturedDetails.websiteId
          ? { ...latest, competitorSearch: { status: "loading" } }
          : latest,
      );

      const applySearchState = (next: CompetitorSearchState): void => {
        if (competitorSearchController.current !== controller) return;
        setState((latest) => {
          if (
            latest.phase !== "ready" ||
            latest.details.websiteId !== capturedDetails.websiteId ||
            latest.details.websiteId !== websiteId ||
            latest.details.host !== capturedDetails.host
          ) {
            return latest;
          }
          const latestIdentity = competitorSearchIdentityForProfile(
            latest.profile,
            latest.details.submittedUrl,
          );
          if (
            latestIdentity === null ||
            latestIdentity !== requestIdentity
          ) {
            return latest.competitorSearch.status === "loading"
              ? { ...latest, competitorSearch: { status: "idle" } }
              : latest;
          }
          return { ...latest, competitorSearch: next };
        });
      };

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let rejectAbort!: (reason?: unknown) => void;
      const abortRequest = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const rejectOnAbort = () =>
        rejectAbort(
          new DOMException("Competitor search aborted", "AbortError"),
        );
      controller.signal.addEventListener("abort", rejectOnAbort, {
        once: true,
      });

      try {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, PROFILE_SEARCH_CLIENT_TIMEOUT_MS);
        const response = await Promise.race([
          fetch("/api/agents/seo/profile-search", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(request),
            signal: controller.signal,
          }),
          abortRequest,
        ]);
        const body = await Promise.race([
          readBoundedJson(response),
          abortRequest,
        ]);
        if (
          controller.signal.aborted ||
          competitorSearchController.current !== controller
        ) {
          return;
        }
        if (!response.ok) {
          applySearchState({
            status: "error",
            requestIdentity,
            code: responseErrorCode(body),
          });
          return;
        }
        if (
          !isAgentProfileSearchEnvelope(body) ||
          body.data.agent !== "seo" ||
          body.data.targetHost !== capturedDetails.host ||
          body.data.market.code !== request.marketCode
        ) {
          applySearchState({
            status: "error",
            requestIdentity,
            code: "audit_response_invalid",
          });
          return;
        }
        applySearchState({
          status: "result",
          requestIdentity,
          data: body.data,
        });
      } catch {
        if (
          timedOut &&
          competitorSearchController.current === controller
        ) {
          applySearchState({
            status: "error",
            requestIdentity,
            code: "search_timeout",
          });
        } else if (
          !controller.signal.aborted &&
          competitorSearchController.current === controller
        ) {
          applySearchState({
            status: "error",
            requestIdentity,
            code: "unknown",
          });
        }
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", rejectOnAbort);
        if (competitorSearchController.current === controller) {
          competitorSearchController.current = null;
          competitorSearchControllerIdentity.current = null;
        }
      }
    },
    [websiteId],
  );

  useEffect(() => {
    if (
      state.phase !== "ready" ||
      state.competitorSearch.status !== "pending"
    ) {
      return;
    }
    void runCompetitorSearch(state.profile);
  }, [runCompetitorSearch, state]);

  useEffect(() => {
    if (state.phase !== "ready") {
      return;
    }
    const currentIdentity = competitorSearchIdentityForProfile(
      state.profile,
      state.details.submittedUrl,
    );
    if (state.competitorSearch.status === "loading") {
      const activeIdentity = competitorSearchControllerIdentity.current;
      const activeController = competitorSearchController.current;
      if (activeIdentity === null || currentIdentity === activeIdentity) {
        return;
      }
      if (
        competitorSearchController.current === activeController &&
        competitorSearchControllerIdentity.current === activeIdentity
      ) {
        activeController?.abort();
        competitorSearchController.current = null;
        competitorSearchControllerIdentity.current = null;
      }
      const capturedWebsiteId = state.details.websiteId;
      setState((current) => {
        if (
          current.phase !== "ready" ||
          current.details.websiteId !== capturedWebsiteId ||
          current.competitorSearch.status !== "loading"
        ) {
          return current;
        }
        const latestIdentity = competitorSearchIdentityForProfile(
          current.profile,
          current.details.submittedUrl,
        );
        return latestIdentity !== activeIdentity
          ? { ...current, competitorSearch: { status: "idle" } }
          : current;
      });
      return;
    }
    if (
      (state.competitorSearch.status !== "result" &&
        state.competitorSearch.status !== "error") ||
      state.competitorSearch.requestIdentity === null
    ) {
      return;
    }
    const settledIdentity = state.competitorSearch.requestIdentity;
    if (currentIdentity === settledIdentity) {
      return;
    }
    if (competitorSearchControllerIdentity.current === settledIdentity) {
      competitorSearchController.current?.abort();
      competitorSearchController.current = null;
      competitorSearchControllerIdentity.current = null;
    }
    setState((current) => {
      if (
        current.phase !== "ready" ||
        (current.competitorSearch.status !== "result" &&
          current.competitorSearch.status !== "error") ||
        current.competitorSearch.requestIdentity !== settledIdentity
      ) {
        return current;
      }
      const latestIdentity = competitorSearchIdentityForProfile(
        current.profile,
        current.details.submittedUrl,
      );
      return latestIdentity === null || latestIdentity !== settledIdentity
        ? { ...current, competitorSearch: { status: "idle" } }
        : current;
    });
  }, [state]);

  useEffect(() => {
    if (
      !autoGenerate ||
      autoGenerateStarted.current ||
      state.phase !== "ready"
    ) {
      return;
    }
    autoGenerateStarted.current = true;
    void runRefresh("prefer_cache");
  }, [autoGenerate, runRefresh, state.phase]);

  useEffect(() => {
    if (
      state.phase !== "ready" ||
      state.confirming ||
      state.saveState !== "unsaved" ||
      hasBlankListItem(state.profile) ||
      state.conflict !== null
    ) {
      return;
    }
    const timer = setTimeout(() => void saveDraft(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [saveDraft, state]);

  const shouldWarn =
    state.phase === "ready" &&
    (state.saveState === "unsaved" ||
      state.saveState === "failed");
  useEffect(() => {
    if (!shouldWarn) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [shouldWarn]);

  function editField(
    field: WebsiteProfileFieldName,
    value: string | readonly string[],
  ): void {
    setState((current) => {
      if (current.phase !== "ready") return current;
      return {
        ...current,
        profile: userEditedProfile(current.profile, field, value),
        saveState: "unsaved",
        confirmError: null,
      };
    });
  }

  function classifyCompetitor(
    domain: string,
    classification: AgentCompetitorClassification,
  ): void {
    setState((current) => {
      if (
        current.phase !== "ready" ||
        current.competitorSearch.status !== "result"
      ) {
        return current;
      }
      const requestIdentity = competitorSearchIdentityForProfile(
        current.profile,
        current.details.submittedUrl,
      );
      if (
        requestIdentity === null ||
        requestIdentity !== current.competitorSearch.requestIdentity
      ) {
        return { ...current, competitorSearch: { status: "idle" } };
      }
      const profile = classifyWebsiteCompetitorDraft(
        current.profile,
        domain,
        classification,
      );
      if (profileEqual(profile, current.profile)) return current;
      return {
        ...current,
        profile,
        saveState: "unsaved",
        confirmError: null,
      };
    });
  }

  function applyRefreshFields(fields: readonly WebsiteProfileFieldName[]): void {
    setState((current) => {
      if (current.phase !== "ready" || current.refresh.status !== "review") {
        return current;
      }
      const profile = applyProposal(
        current.profile,
        current.refresh.proposal,
        fields,
      );
      const remaining = WEBSITE_PROFILE_FIELD_NAMES.some(
        (field) =>
          !valueEqual(profile[field], current.refresh.status === "review"
            ? current.refresh.proposal[field]
            : profile[field]),
      );
      return {
        ...current,
        profile,
        saveState: "unsaved",
        confirmError: null,
        refresh: remaining ? current.refresh : { status: "idle" },
        competitorSearch: remaining
          ? current.competitorSearch
          : { status: "pending" },
      };
    });
  }

  async function confirmProfile(): Promise<void> {
    const current = stateRef.current;
    if (
      current.phase !== "ready" ||
      current.confirming ||
      current.saveState !== "saved" ||
      current.details.draft === null ||
      !isMarketingWebsiteProfileReady(current.profile)
    ) {
      return;
    }
    const isCurrentWebsite = (latest: EditorState): latest is ReadyEditor =>
      latest.phase === "ready" &&
      latest.details.websiteId === current.details.websiteId;
    setState((latest) =>
      isCurrentWebsite(latest)
        ? { ...latest, confirming: true, confirmError: null }
        : latest,
    );
    try {
      const response = await fetch(
        "/api/account/websites/" + websiteId + "/confirm",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseVersion: current.details.draft.draftVersion,
          }),
        },
      );
      const body = await readJson(response);
      if (response.status === 409) {
        const server = await websiteFromConflict(body);
        if (server === null || server.websiteId !== websiteId) {
          throw new Error("invalid conflict");
        }
        setState((latest) =>
          isCurrentWebsite(latest)
            ? {
                ...latest,
                details: server,
                conflict: server,
                conflictChoices: {},
                saveState: "unsaved",
                confirming: false,
                confirmError: null,
              }
            : latest,
        );
        return;
      }
      if (response.status !== 200) {
        const fields = confirmationErrorFields(body);
        setState((latest) =>
          isCurrentWebsite(latest)
            ? {
                ...latest,
                confirming: false,
                confirmError: fields,
              }
            : latest,
        );
        return;
      }
      const confirmed = await websiteFromData(body);
      if (
        confirmed === null ||
        confirmed.websiteId !== websiteId ||
        confirmed.draft === null ||
        confirmed.currentConfirmedSnapshot === null ||
        !profileEqual(confirmed.currentConfirmedSnapshot.profile, current.profile)
      ) {
        throw new Error("invalid confirmation");
      }
      const confirmedDraft = confirmed.draft;
      const confirmedSnapshot = confirmed.currentConfirmedSnapshot;
      setState((latest) => {
        if (!isCurrentWebsite(latest)) return latest;
        // Another tab can save a newer draft between confirmation and the
        // server's detail read. Keep local content until the user resolves it.
        if (!profileEqual(confirmedDraft.profile, confirmedSnapshot.profile)) {
          return {
            ...latest,
            details: confirmed,
            conflict: confirmed,
            conflictChoices: {},
            saveState: "unsaved",
            confirming: false,
            confirmError: null,
            collapsed: false,
          };
        }
        const unchanged = profileEqual(latest.profile, current.profile);
        return {
          ...latest,
          details: confirmed,
          profile: unchanged ? confirmedDraft.profile : latest.profile,
          saveState: unchanged ? "saved" : "unsaved",
          conflict: null,
          conflictChoices: {},
          confirming: false,
          confirmError: null,
          collapsed: unchanged,
        };
      });
    } catch {
      setState((latest) =>
        isCurrentWebsite(latest)
          ? { ...latest, confirming: false, confirmError: [] }
          : latest,
      );
    }
  }

  if (state.phase !== "ready") {
    const message =
      state.phase === "loading"
        ? t("loading")
        : state.phase === "signed-out"
          ? t("signedOut")
          : state.phase === "not-found"
            ? t("notFound")
            : t("unavailable");
    return (
      <p className="rounded-card border border-brand-border-card bg-brand-panel p-6 text-[13px] text-text-dark-secondary">
        {message}
      </p>
    );
  }

  if (state.collapsed && state.details.currentConfirmedSnapshot !== null) {
    return (
      <div
        ref={summaryRef}
        tabIndex={-1}
        role="region"
        aria-labelledby="website-profile-confirmed-title"
        data-website-profile-collapsed="true"
        className="scroll-mt-24 space-y-5 rounded-card border border-brand-accent/40 bg-brand-panel p-6 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent sm:p-7"
      >
        <p
          role="status"
          data-save-state="saved"
          className="flex items-center gap-2 text-[13px] font-medium text-brand-accent-text"
        >
          <Check aria-hidden="true" className="size-4" />
          {t("confirm.version", {
            revision: state.details.currentConfirmedSnapshot.snapshotRevision,
          })}
        </p>
        <div className="space-y-2">
          <h2 id="website-profile-confirmed-title" className="text-[20px] font-semibold text-text-dark-primary">
            {state.profile.productName}
          </h2>
          <p className="break-all font-mono text-[12px] text-text-dark-secondary">
            {state.details.host}
          </p>
          <p className="text-[14px] leading-relaxed text-text-dark-primary">
            {state.profile.oneLinePositioning}
          </p>
        </div>
        <p className="text-[13px] text-text-dark-secondary">{t("confirm.body")}</p>
        <Button
          type="button"
          variant="outline"
          aria-expanded={false}
          onClick={() => setState((current) =>
            current.phase === "ready"
              ? { ...current, collapsed: false }
              : current,
          )}
        >
          <Pencil aria-hidden="true" className="size-4" />
          {t("confirm.edit")}
        </Button>
      </div>
    );
  }

  const conflictProfile =
    state.conflict === null ? null : sourceProfile(state.conflict);
  const conflictFields =
    conflictProfile === null
      ? []
      : WEBSITE_PROFILE_FIELD_NAMES.filter(
          (field) => !valueEqual(state.profile[field], conflictProfile[field]),
        );
  const requiredMissing = missingRequired(state.profile);
  const confirmedChanges = confirmedChangedFields(
    state.profile,
    state.details,
  );
  const sources = Array.from(
    new Set(
      state.profile.fieldProvenance.flatMap((entry) => entry.evidenceUrls),
    ),
  );
  const displayedSaveState =
    state.conflict === null ? state.saveState : "conflicted";
  const hasIncompleteList = hasBlankListItem(state.profile);
  const competitorData = state.competitorSearch.status === "result"
    ? state.competitorSearch.data
    : null;
  const competitorSuggestions = competitorData === null
    ? []
    : deriveAgentCompetitorSuggestions(competitorData, state.details.host);
  const competitorClassifications = {
    direct: state.profile.directCompetitors,
    indirect: state.profile.indirectAlternatives,
    excluded: state.profile.excludedAlternatives,
  };
  const competitorFrame = deriveAgentCompetitorDisplayFrame(
    competitorSuggestions,
    competitorClassifications,
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-card border border-brand-border-card bg-brand-panel p-6">
        <div>
          <p className="font-mono text-[11px] text-brand-accent-text">
            {state.details.host}
          </p>
          <p
            data-save-state={displayedSaveState}
            aria-live="polite"
            aria-atomic="true"
            className="mt-2 text-[13px] text-text-dark-secondary"
          >
            {t("saveState." + displayedSaveState)}
          </p>
          {hasIncompleteList ? (
            <p className="mt-1 text-[12px] text-text-dark-secondary">
              {t("listIncomplete")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={state.refresh.status === "loading"}
            onClick={() => void runRefresh("refresh")}
          >
            {state.refresh.status === "loading" ? t("generating") : t("rescan")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              state.confirming ||
              state.saveState === "saving" ||
              state.conflict !== null ||
              hasIncompleteList
            }
            onClick={() => void saveDraft()}
          >
            {state.saveState === "failed" ? t("retrySave") : t("saveDraft")}
          </Button>
        </div>
      </div>

      {state.refresh.status === "error" ? (
        <p role="alert" data-refresh-error={state.refresh.reason ?? "unknown"} className="text-[13px] text-brand-error">
          {state.refresh.reason === null
            ? t("generationFailed")
            : `${t("refreshErrors." + state.refresh.reason, { host: state.details.host })} ${t("draftUnchanged")}`}
        </p>
      ) : null}
      {state.refresh.status === "review" ? (
        <ProfileRefreshReview
          current={state.profile}
          proposal={state.refresh.proposal}
          availability={state.refresh.availability}
          onApply={applyRefreshFields}
          onDismiss={() =>
            setState((current) =>
              current.phase === "ready"
                ? { ...current, refresh: { status: "idle" } }
                : current,
            )
          }
        />
      ) : null}

      {conflictProfile === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{t("conflict.title")}</CardTitle>
            <CardDescription>{t("conflict.body")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {conflictFields.map((field) => (
              <div
                key={field}
                data-conflict-field={field}
                className="rounded-[10px] border border-brand-border-card p-4"
              >
                <p className="text-[13px] font-semibold text-text-dark-primary">
                  {fieldName(field)}
                </p>
                <div className="mt-2 space-y-3 break-words text-[12px]">
                  <p>
                    {t("conflict.local")}:{" "}
                    {JSON.stringify(state.profile[field])}
                  </p>
                  <p>
                    {t("conflict.server")}:{" "}
                    {JSON.stringify(conflictProfile[field])}
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState((current) =>
                        current.phase === "ready"
                          ? {
                              ...current,
                              conflictChoices: {
                                ...current.conflictChoices,
                                [field]: "local",
                              },
                            }
                          : current,
                      )
                    }
                  >
                    {t("conflict.keepLocal")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState((current) => {
                        if (current.phase !== "ready") return current;
                        const next = {
                          ...current.profile,
                          [field]: conflictProfile[field],
                          fieldProvenance: [
                            ...current.profile.fieldProvenance.filter(
                              (entry) => entry.path !== "/" + field,
                            ),
                            ...conflictProfile.fieldProvenance.filter(
                              (entry) => entry.path === "/" + field,
                            ),
                          ],
                        } as MarketingWebsiteProfileV1;
                        return {
                          ...current,
                          profile: next,
                          conflictChoices: {
                            ...current.conflictChoices,
                            [field]: "server",
                          },
                        };
                      })
                    }
                  >
                    {t("conflict.useServer")}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="cta"
              disabled={conflictFields.some(
                (field) => state.conflictChoices[field] === undefined,
              )}
              onClick={() => void saveDraft()}
            >
              {t("conflict.save")}
            </Button>
          </CardContent>
        </Card>
      )}

      <ProfileSection
        title={t("productSection")}
        fields={PRODUCT_FIELDS}
        profile={state.profile}
        onChange={editField}
      />
      <ProfileSection
        title={t("icpSection")}
        fields={ICP_FIELDS}
        profile={state.profile}
        onChange={editField}
      />
      <ProfileSection
        title={t("marketSection")}
        fields={MARKET_FIELDS}
        profile={state.profile}
        onChange={editField}
      />
      <Card
        data-website-competitors
        role="region"
        aria-labelledby="website-profile-competitors-title"
        className="gap-0 overflow-hidden border-brand-border-strong py-0"
      >
        <CardHeader className="border-b bg-brand-panel-raised px-5 py-5 sm:px-7">
          <CardTitle>
            <h2 id="website-profile-competitors-title" className="flex items-center gap-3 text-[17px]">
              <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand-accent" />
              {t("competitorSection")}
            </h2>
          </CardTitle>
          <CardDescription>{t("competitors.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-5 py-6 sm:px-7">
          <dl className="space-y-5">
            {COMPETITOR_GROUPS.map(({ classification, field }) => {
              const entries = competitorSummaryEntries(
                competitorFrame[classification],
                state.profile[field],
              );
              const classificationSaved = valueEqual(
                state.profile[field],
                state.details.draft?.profile[field] ??
                  state.details.currentConfirmedSnapshot?.profile[field] ?? [],
              );
              return (
                <div
                  key={field}
                  data-competitor-summary={classification}
                  className="rounded-[10px] border border-brand-border-card p-4"
                >
                  <dt className="text-[14px] font-semibold text-text-dark-primary">{fieldName(field)}</dt>
                  <dd className="mt-3">
                    {entries.length === 0 ? (
                      <p className="text-[13px] text-text-dark-secondary">{t("competitors.empty")}</p>
                    ) : (
                      <ul className="space-y-3">
                        {entries.map(({ value, source }) => (
                          <li
                            key={value}
                            data-competitor-source={source === "saved" && !classificationSaved ? "draft" : source}
                            className="space-y-1"
                          >
                            <p className="break-all text-[14px] text-text-dark-primary">{value}</p>
                            <p className={`text-[12px] ${source === "system" ? "text-brand-warning" : "text-text-dark-secondary"}`}>
                              {t(source === "system"
                                ? "competitors.systemSuggestion"
                                : classificationSaved
                                  ? "competitors.savedClassification"
                                  : "competitors.draftClassification")}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          <AgentProfileSearch
            locale={locale}
            loading={
              state.competitorSearch.status === "pending" ||
              state.competitorSearch.status === "loading"
            }
            data={competitorData}
            suggestions={competitorSuggestions}
            errorCode={
              state.competitorSearch.status === "error"
                ? state.competitorSearch.code
                : null
            }
            onDiscover={() => void runCompetitorSearch(state.profile)}
            disabled={
              state.confirming ||
              competitorSearchRequestForProfile(
                state.profile,
                state.details.submittedUrl,
              ) === null
            }
            reviewDisabled={state.confirming}
            classifications={competitorClassifications}
            onClassify={classifyCompetitor}
            copy={profileSearchCopy}
          />
          <details className="rounded-[10px] border border-brand-border-card bg-brand-bg p-4">
            <summary className="cursor-pointer text-[14px] font-medium text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent">
              {t("competitors.editSaved")}
            </summary>
            <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">{t("competitors.manualHelp")}</p>
            <div className="divide-y divide-brand-border-card">
              {COMPETITOR_GROUPS.map(({ field }) => (
                <div key={field} className="py-5">
                  <FieldEditor field={field} profile={state.profile} onChange={editField} />
                </div>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sourcesSection")}</CardTitle>
          <CardDescription>
            {state.details.draft === null
              ? null
              : t("draftVersion", {
                  version: state.details.draft.draftVersion,
                })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-[13px] text-text-dark-secondary">
              {t("noSources")}
            </p>
          ) : (
            <ul className="space-y-1">
              {sources.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[12px] text-brand-accent-text hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("confirm.title")}</CardTitle>
          <CardDescription>
            {requiredMissing.length === 0
              ? t("confirm.changes", { count: confirmedChanges.length })
              : t("confirm.missing")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.confirmError === null ? null : (
            <div
              role="alert"
              data-confirm-error="true"
              className="mb-4 rounded-[10px] border border-brand-error/30 bg-brand-error/5 p-3 text-[12px] text-brand-error"
            >
              <p>{t("confirm.failed")}</p>
              {state.confirmError.length === 0 ? null : (
                <ul className="mt-2 list-disc pl-5">
                  {state.confirmError.map((field) => (
                    <li key={field}>{fieldName(field)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {requiredMissing.length > 0 || confirmedChanges.length === 0 ? null : (
            <ul className="mb-4 space-y-2">
              {confirmedChanges.map((field) => (
                <li
                  key={field}
                  data-confirm-change={field}
                  className="w-fit rounded-full bg-brand-panel-raised px-2.5 py-1 text-[11px] text-text-dark-secondary"
                >
                  {fieldName(field)}
                </li>
              ))}
            </ul>
          )}
          {requiredMissing.length === 0 ? null : (
            <ul className="mb-4 list-disc pl-5 text-[12px] text-text-dark-secondary">
              {requiredMissing.map((field) => (
                <li key={field}>{fieldName(field)}</li>
              ))}
            </ul>
          )}
          {state.details.currentConfirmedSnapshot === null ? null : (
            <p className="mb-4 text-[12px] text-text-dark-secondary">
              {t("confirm.version", {
                revision:
                  state.details.currentConfirmedSnapshot.snapshotRevision,
              })}
            </p>
          )}
          <Button
            type="button"
            variant="cta"
            disabled={
              state.confirming ||
              state.saveState !== "saved" ||
              state.details.draft === null ||
              requiredMissing.length > 0
            }
            onClick={() => void confirmProfile()}
          >
            {state.confirming ? t("confirm.confirming") : t("confirm.action")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
