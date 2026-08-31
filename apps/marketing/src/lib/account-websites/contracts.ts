// @input  -- a user-entered public website URL
// @output -- one account-scoped website identity shared by Settings and Agents
// @pos    -- client-safe contract boundary for Marketing account websites

import { z } from "zod";

const MAX_URL_LENGTH = 2_048;

export const MARKETING_WEBSITE_PROFILE_VERSION =
  "marketing-website-profile.v1" as const;
export const WEBSITE_PROFILE_REFERENCE_VERSION =
  "website-profile-reference.v1" as const;

export const WEBSITE_PROFILE_FIELD_NAMES = [
  "productName",
  "oneLinePositioning",
  "valueProposition",
  "coreFeatures",
  "categories",
  "businessModel",
  "primaryCta",
  "trustSignals",
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
  "directCompetitors",
  "indirectAlternatives",
  "excludedAlternatives",
  "firstOutcome",
  "country",
  "locale",
] as const;

export type WebsiteProfileFieldName =
  (typeof WEBSITE_PROFILE_FIELD_NAMES)[number];

export interface WebsiteProfileFieldProvenance {
  readonly path: `/${WebsiteProfileFieldName}`;
  readonly derivation:
    | "declared"
    | "observed"
    | "computed"
    | "inferred"
    | "missing";
  readonly confidence: "high" | "medium" | "low" | "unknown";
  readonly source:
    | "supplied_product_information"
    | "supplied_marketing_strategy"
    | "visitor_url"
    | "public_page"
    | "local_computation"
    | "local_inference"
    | "user_edit"
    | "not_available";
  readonly limitation: string | null;
  readonly observedAt: string | null;
  readonly evidenceUrls: readonly string[];
}

export interface MarketingWebsiteProfileV1 {
  readonly schemaVersion: typeof MARKETING_WEBSITE_PROFILE_VERSION;
  readonly productName: string;
  readonly oneLinePositioning: string;
  readonly valueProposition: string;
  readonly coreFeatures: readonly string[];
  readonly categories: readonly string[];
  readonly businessModel: string;
  readonly primaryCta: string;
  readonly trustSignals: readonly string[];
  readonly primaryIcp: string;
  readonly buyer: string;
  readonly user: string;
  readonly triggerPain: string;
  readonly icpInterests: readonly string[];
  readonly icpPain: string;
  readonly icpBehavior: string;
  readonly icpPositioning: string;
  readonly jtbd: string;
  readonly useCases: readonly string[];
  readonly outcomes: readonly string[];
  readonly barriers: readonly string[];
  readonly qualificationSignals: readonly string[];
  readonly disqualifiers: readonly string[];
  readonly directCompetitors: readonly string[];
  readonly indirectAlternatives: readonly string[];
  readonly excludedAlternatives: readonly string[];
  readonly firstOutcome: string;
  readonly country: string;
  readonly locale: string;
  readonly fieldProvenance: readonly WebsiteProfileFieldProvenance[];
}

export interface WebsiteProfileReferenceV1 {
  readonly schemaVersion: typeof WEBSITE_PROFILE_REFERENCE_VERSION;
  readonly websiteId: string;
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly profileSchemaVersion: typeof MARKETING_WEBSITE_PROFILE_VERSION;
  readonly profileHash: string;
}

export type WebsiteProfileState =
  | "not_generated"
  | "draft"
  | "confirmed"
  | "unconfirmed_changes";

export interface WebsiteSummary {
  readonly websiteId: string;
  readonly origin: string;
  readonly host: string;
  readonly canonicalSiteKey: string;
  readonly displayName: string | null;
  readonly isPrimary: boolean;
  readonly profileState: WebsiteProfileState;
  readonly confirmedSnapshotId: string | null;
  readonly confirmedSnapshotRevision: number | null;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebsiteProfileDraftDetails {
  readonly draftVersion: number;
  readonly updatedAt: string;
  readonly profileHash: string;
  readonly profile: MarketingWebsiteProfileV1;
}

export interface WebsiteConfirmedSnapshotDetails
  extends WebsiteProfileReferenceV1 {
  readonly confirmedAt: string;
  readonly profile: MarketingWebsiteProfileV1;
}

export interface WebsiteDetails extends WebsiteSummary {
  /** Full normalized page URL the user submitted, kept as scan provenance. */
  readonly submittedUrl: string;
  readonly draft: WebsiteProfileDraftDetails | null;
  readonly currentConfirmedSnapshot: WebsiteConfirmedSnapshotDetails | null;
}

export interface NormalizedAccountWebsiteUrl {
  readonly submittedUrl: string;
  readonly origin: string;
  readonly host: string;
  readonly canonicalSiteKey: string;
}

function hasExplicitScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//iu.test(value);
}

function isObviouslyNonPublicHost(hostname: string): boolean {
  const unwrapped = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    unwrapped === "localhost" ||
    unwrapped.endsWith(".localhost") ||
    unwrapped.endsWith(".local") ||
    isNonPublicIpv4(unwrapped) ||
    isNonPublicIpv6(unwrapped)
  );
}

function isNonPublicIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const octets = hostname.split(".").map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [first = 0, second = 0, third = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 &&
      (second === 0 ||
        second === 2 ||
        (second === 31 && third === 196) ||
        (second === 52 && third === 193) ||
        second === 168 ||
        (second === 88 && third === 99) ||
        (second === 175 && third === 48))) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isNonPublicIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const [firstPart = "", secondPart = "0"] = hostname.split(":");
  const first = Number.parseInt(firstPart, 16);
  const second = Number.parseInt(secondPart || "0", 16);
  const isGlobalUnicast =
    Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff;
  return (
    !isGlobalUnicast ||
    hostname === "::" ||
    hostname === "::1" ||
    hostname.startsWith("::ffff:") ||
    /^f[cd]/u.test(hostname) ||
    /^fe[89ab]/u.test(hostname) ||
    (first === 0x2001 && second <= 0x01ff) ||
    (first === 0x2001 && second === 0x0db8) ||
    first === 0x2002 ||
    (first === 0x2620 && second === 0x004f && hostname.startsWith("2620:4f:8000:")) ||
    (first === 0x3fff && second <= 0x0fff)
  );
}

function isCanonicalLocale(value: string): boolean {
  if (value === "" || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isPublicEvidenceUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      !isObviouslyNonPublicHost(hostname)
    );
  } catch {
    return false;
  }
}

const boundedText = z.string().max(2_000);
const boundedList = z.array(z.string().min(1).max(500)).max(32);
const websiteId = z.string().uuid();
const profileHash = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalLocale = z.string().refine(
  (value) => value === "" || isCanonicalLocale(value),
  "locale must be empty or canonical BCP 47",
);
const countryCode = z
  .string()
  .refine((value) => value === "" || /^[A-Z]{2}$/u.test(value));
const canonicalTimestamp = z
  .string()
  .refine(isCanonicalTimestamp, "timestamp must be canonical ISO 8601");
const publicEvidenceUrl = z
  .string()
  .refine(isPublicEvidenceUrl, "evidence URL must be public http(s)");

export const fieldProvenanceSchema: z.ZodType<WebsiteProfileFieldProvenance> = z
  .object({
    path: z.enum(
      WEBSITE_PROFILE_FIELD_NAMES.map(
        (field) => `/${field}` as const,
      ) as [
        `/${WebsiteProfileFieldName}`,
        ...`/${WebsiteProfileFieldName}`[],
      ],
    ),
    derivation: z.enum([
      "declared",
      "observed",
      "computed",
      "inferred",
      "missing",
    ]),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    source: z.enum([
      "supplied_product_information",
      "supplied_marketing_strategy",
      "visitor_url",
      "public_page",
      "local_computation",
      "local_inference",
      "user_edit",
      "not_available",
    ]),
    limitation: z.string().max(1_000).nullable(),
    observedAt: canonicalTimestamp.nullable(),
    evidenceUrls: z.array(publicEvidenceUrl).max(12),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.source === "not_available") {
      if (
        entry.derivation !== "missing" ||
        entry.confidence !== "unknown" ||
        entry.limitation === null ||
        entry.limitation.trim() === "" ||
        entry.evidenceUrls.length !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "not-available provenance must remain missing and limited",
        });
      }
      return;
    }
    if (entry.derivation === "missing") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing derivation requires not-available source",
        path: ["derivation"],
      });
    }
    if (
      entry.source === "user_edit" &&
      (entry.derivation !== "declared" ||
        entry.confidence !== "high" ||
        entry.limitation !== null ||
        entry.observedAt !== null ||
        entry.evidenceUrls.length !== 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "user edits are high-confidence declarations without evidence",
      });
    }
    if (
      entry.source === "public_page" &&
      (entry.observedAt === null || entry.evidenceUrls.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "public-page provenance requires time and evidence URL",
      });
    }
  });

const marketingWebsiteProfileSchema: z.ZodType<MarketingWebsiteProfileV1> = z
  .object({
    schemaVersion: z.literal(MARKETING_WEBSITE_PROFILE_VERSION),
    productName: z.string().max(160),
    oneLinePositioning: boundedText,
    valueProposition: boundedText,
    coreFeatures: boundedList,
    categories: boundedList,
    businessModel: z.string().max(500),
    primaryCta: z.string().max(500),
    trustSignals: boundedList,
    primaryIcp: boundedText,
    buyer: boundedText,
    user: boundedText,
    triggerPain: boundedText,
    icpInterests: boundedList,
    icpPain: boundedText,
    icpBehavior: boundedText,
    icpPositioning: boundedText,
    jtbd: boundedText,
    useCases: boundedList,
    outcomes: boundedList,
    barriers: boundedList,
    qualificationSignals: boundedList,
    disqualifiers: boundedList,
    directCompetitors: boundedList,
    indirectAlternatives: boundedList,
    excludedAlternatives: boundedList,
    firstOutcome: boundedText,
    country: countryCode,
    locale: canonicalLocale,
    fieldProvenance: z.array(fieldProvenanceSchema).max(
      WEBSITE_PROFILE_FIELD_NAMES.length,
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of value.fieldProvenance.entries()) {
      if (seen.has(entry.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate provenance path: ${entry.path}`,
          path: ["fieldProvenance", index, "path"],
        });
      }
      seen.add(entry.path);

      if (entry.source === "not_available") {
        const field = entry.path.slice(1) as WebsiteProfileFieldName;
        const fieldValue = value[field];
        const isEmpty = Array.isArray(fieldValue)
          ? fieldValue.length === 0
          : fieldValue === "";
        if (!isEmpty) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "not-available provenance requires an empty field",
            path: [field],
          });
        }
      }
    }
  });

const websiteProfileReferenceSchema: z.ZodType<WebsiteProfileReferenceV1> = z
  .object({
    schemaVersion: z.literal(WEBSITE_PROFILE_REFERENCE_VERSION),
    websiteId,
    snapshotId: z.string().uuid(),
    snapshotRevision: z.number().int().positive(),
    profileSchemaVersion: z.literal(MARKETING_WEBSITE_PROFILE_VERSION),
    profileHash,
  })
  .strict();

const websiteProfileStateSchema = z.enum([
  "not_generated",
  "draft",
  "confirmed",
  "unconfirmed_changes",
]);

const publicOriginSchema = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    const normalized = normalizeAccountWebsiteUrl(value);
    return (
      normalized !== null &&
      parsed.origin === value &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      normalized.origin === value
    );
  } catch {
    return false;
  }
}, "origin must be one canonical public origin");

const submittedPublicUrlSchema = z.string().min(1).max(MAX_URL_LENGTH).refine(
  (value) => normalizeAccountWebsiteUrl(value)?.submittedUrl === value,
  "submitted URL must be one normalized public URL",
);

const publicHostSchema = z.string().min(1).max(255).refine((value) => {
  const normalized = normalizeAccountWebsiteUrl(`https://${value}`);
  return normalized !== null && normalized.host === value;
}, "host must be one canonical public host");

const websiteSummaryShape = {
  websiteId,
  origin: publicOriginSchema,
  host: publicHostSchema,
  canonicalSiteKey: publicHostSchema,
  displayName: z.string().min(1).max(160).nullable(),
  isPrimary: z.boolean(),
  profileState: websiteProfileStateSchema,
  confirmedSnapshotId: z.string().uuid().nullable(),
  confirmedSnapshotRevision: z.number().int().positive().nullable(),
  confirmedAt: canonicalTimestamp.nullable(),
  createdAt: canonicalTimestamp,
  updatedAt: canonicalTimestamp,
} as const;

function validateWebsiteSummary(
  value: WebsiteSummary,
  ctx: z.RefinementCtx,
): void {
  if (value.host !== value.canonicalSiteKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "host and canonical site key must match",
      path: ["canonicalSiteKey"],
    });
  }
  const normalizedOrigin = normalizeAccountWebsiteUrl(value.origin);
  if (
    normalizedOrigin === null ||
    normalizedOrigin.origin !== value.origin ||
    normalizedOrigin.host !== value.host ||
    normalizedOrigin.canonicalSiteKey !== value.canonicalSiteKey
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "origin, host, and canonical site key must identify one website",
      path: ["origin"],
    });
  }
  const confirmedParts = [
    value.confirmedSnapshotId,
    value.confirmedSnapshotRevision,
    value.confirmedAt,
  ];
  const hasAnyConfirmed = confirmedParts.some((part) => part !== null);
  const hasFullConfirmed = confirmedParts.every((part) => part !== null);
  const stateNeedsConfirmed =
    value.profileState === "confirmed" ||
    value.profileState === "unconfirmed_changes";
  if (hasAnyConfirmed !== hasFullConfirmed || stateNeedsConfirmed !== hasFullConfirmed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "profile state and confirmed snapshot identity disagree",
      path: ["profileState"],
    });
  }
}

const websiteSummarySchema: z.ZodType<WebsiteSummary> = z
  .object(websiteSummaryShape)
  .strict()
  .superRefine(validateWebsiteSummary);

const websiteProfileDraftDetailsSchema: z.ZodType<WebsiteProfileDraftDetails> = z
  .object({
    draftVersion: z.number().int().positive(),
    updatedAt: canonicalTimestamp,
    profileHash,
    profile: marketingWebsiteProfileSchema,
  })
  .strict();

const websiteConfirmedSnapshotDetailsSchema: z.ZodType<WebsiteConfirmedSnapshotDetails> =
  z
    .object({
      schemaVersion: z.literal(WEBSITE_PROFILE_REFERENCE_VERSION),
      websiteId,
      snapshotId: z.string().uuid(),
      snapshotRevision: z.number().int().positive(),
      profileSchemaVersion: z.literal(MARKETING_WEBSITE_PROFILE_VERSION),
      profileHash,
      confirmedAt: canonicalTimestamp,
      profile: marketingWebsiteProfileSchema,
    })
    .strict();

const websiteDetailsSchema: z.ZodType<WebsiteDetails> = z
  .object({
    ...websiteSummaryShape,
    submittedUrl: submittedPublicUrlSchema,
    draft: websiteProfileDraftDetailsSchema.nullable(),
    currentConfirmedSnapshot: websiteConfirmedSnapshotDetailsSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateWebsiteSummary(value, ctx);
    const submitted = normalizeAccountWebsiteUrl(value.submittedUrl);
    if (
      submitted === null ||
      submitted.origin !== value.origin ||
      submitted.canonicalSiteKey !== value.canonicalSiteKey
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "submitted URL must identify the same website",
        path: ["submittedUrl"],
      });
    }
    const snapshot = value.currentConfirmedSnapshot;
    const derivedState = profileState(
      value.draft?.profileHash ?? null,
      snapshot?.profileHash ?? null,
    );
    if (value.profileState !== derivedState) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "profile state does not match draft and snapshot hashes",
        path: ["profileState"],
      });
    }
    if (snapshot === null) {
      if (value.confirmedSnapshotId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confirmed summary requires snapshot details",
          path: ["currentConfirmedSnapshot"],
        });
      }
      return;
    }
    if (
      snapshot.websiteId !== value.websiteId ||
      snapshot.snapshotId !== value.confirmedSnapshotId ||
      snapshot.snapshotRevision !== value.confirmedSnapshotRevision ||
      snapshot.confirmedAt !== value.confirmedAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confirmed snapshot details do not match the summary",
        path: ["currentConfirmedSnapshot"],
      });
    }
  });

const websiteListSchema = z
  .array(websiteSummarySchema)
  .max(100)
  .superRefine((websites, ctx) => {
    const primaryCount = websites.filter((website) => website.isPrimary).length;
    if (websites.length > 0 && primaryCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a non-empty website list must have exactly one primary",
      });
    }
  });

export function normalizeAccountWebsiteUrl(
  input: string,
): NormalizedAccountWebsiteUrl | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH) return null;

  try {
    const parsed = new URL(
      hasExplicitScheme(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== ""
    ) {
      return null;
    }

    const submittedHost = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    if (submittedHost === "" || isObviouslyNonPublicHost(submittedHost)) {
      return null;
    }
    const canonicalHost = submittedHost.startsWith("www.")
      ? submittedHost.slice(4)
      : submittedHost;
    if (canonicalHost === "") return null;

    parsed.hostname = submittedHost;
    parsed.hash = "";

    return {
      submittedUrl: parsed.toString(),
      origin: `${parsed.protocol}//${canonicalHost}`,
      host: canonicalHost,
      canonicalSiteKey: canonicalHost,
    };
  } catch {
    return null;
  }
}

export function emptyMarketingWebsiteProfile(): MarketingWebsiteProfileV1 {
  return {
    schemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    productName: "",
    oneLinePositioning: "",
    valueProposition: "",
    coreFeatures: [],
    categories: [],
    businessModel: "",
    primaryCta: "",
    trustSignals: [],
    primaryIcp: "",
    buyer: "",
    user: "",
    triggerPain: "",
    icpInterests: [],
    icpPain: "",
    icpBehavior: "",
    icpPositioning: "",
    jtbd: "",
    useCases: [],
    outcomes: [],
    barriers: [],
    qualificationSignals: [],
    disqualifiers: [],
    directCompetitors: [],
    indirectAlternatives: [],
    excludedAlternatives: [],
    firstOutcome: "",
    country: "",
    locale: "",
    fieldProvenance: [],
  };
}

export function parseMarketingWebsiteProfile(
  value: unknown,
): MarketingWebsiteProfileV1 {
  return marketingWebsiteProfileSchema.parse(value);
}

export function isMarketingWebsiteProfileReady(
  profile: MarketingWebsiteProfileV1,
): boolean {
  return (
    profile.productName.trim() !== "" &&
    profile.oneLinePositioning.trim() !== "" &&
    profile.valueProposition.trim() !== "" &&
    profile.primaryIcp.trim() !== "" &&
    isCanonicalLocale(profile.locale)
  );
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalize(value: CanonicalJson): CanonicalJson {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalProfileJson(
  profile: MarketingWebsiteProfileV1,
): string {
  const parsed = parseMarketingWebsiteProfile(profile);
  const normalized = {
    ...parsed,
    fieldProvenance: [...parsed.fieldProvenance].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
  return JSON.stringify(canonicalize(normalized as unknown as CanonicalJson));
}

export async function profileSha256(
  profile: MarketingWebsiteProfileV1,
): Promise<string> {
  // Browser-safe consistency check only. This can reject a mismatched private
  // response before it enters local UI state, but it is never authorization:
  // the server store must independently hash the canonical profile before a
  // snapshot can be read, confirmed, or referenced.
  const bytes = new TextEncoder().encode(canonicalProfileJson(profile));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function profileState(
  draftHash: string | null,
  confirmedHash: string | null,
): WebsiteProfileState {
  if (draftHash === null) return "not_generated";
  if (confirmedHash === null) return "draft";
  return draftHash === confirmedHash ? "confirmed" : "unconfirmed_changes";
}

export function parseWebsiteProfileReference(
  value: unknown,
): WebsiteProfileReferenceV1 {
  return websiteProfileReferenceSchema.parse(value);
}

export function parseWebsiteSummary(value: unknown): WebsiteSummary {
  return websiteSummarySchema.parse(value);
}

export function parseWebsiteList(value: unknown): readonly WebsiteSummary[] {
  return websiteListSchema.parse(value);
}

export async function parseWebsiteDetails(value: unknown): Promise<WebsiteDetails> {
  const details = websiteDetailsSchema.parse(value);
  if (
    details.draft !== null &&
    (await profileSha256(details.draft.profile)) !== details.draft.profileHash
  ) {
    throw new Error("draft profile hash does not match its embedded profile");
  }
  if (
    details.currentConfirmedSnapshot !== null &&
    (await profileSha256(details.currentConfirmedSnapshot.profile)) !==
      details.currentConfirmedSnapshot.profileHash
  ) {
    throw new Error(
      "confirmed profile hash does not match its embedded profile",
    );
  }
  return details;
}
