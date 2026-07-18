import { z } from "zod";

/**
 * Source collection request schemas (spec §7.5). CSV uses the dedicated import
 * endpoint; DataForSEO is disabled — so `createCollectionRun` only accepts
 * crawl/gsc/ga4. `operation` is optional and derived from `provider` when absent.
 */

export const CollectionProvider = z.enum(["crawl", "gsc", "ga4"]);
export type CollectionProvider = z.infer<typeof CollectionProvider>;

export const CollectionOperationInput = z.enum([
  "site_graph",
  "search_analytics",
  "organic_landing",
]);
export type CollectionOperationInput = z.infer<typeof CollectionOperationInput>;

export const CreateCollectionRunRequest = z
  .object({
    provider: CollectionProvider,
    sourceConnectionId: z.uuid().nullable().optional(),
    operation: CollectionOperationInput.optional(),
  })
  .strict();
export type CreateCollectionRunRequest = z.infer<
  typeof CreateCollectionRunRequest
>;

/**
 * `connectProjectSource` three-phase OAuth request (spec §7.4). One endpoint,
 * discriminated by `phase`: authorize → property_selection → select_property.
 */
export const AuthorizeSourceRequest = z
  .object({
    phase: z.literal("authorize"),
    returnPath: z.string().regex(/^\/p\/[0-9a-f-]+\/sources$/),
  })
  .strict();
export type AuthorizeSourceRequest = z.infer<typeof AuthorizeSourceRequest>;

export const GetPropertySelectionRequest = z
  .object({
    phase: z.literal("property_selection"),
    oauthIntentId: z.uuid(),
  })
  .strict();
export type GetPropertySelectionRequest = z.infer<
  typeof GetPropertySelectionRequest
>;

export const SelectPropertyRequest = z
  .object({
    phase: z.literal("select_property"),
    oauthIntentId: z.uuid(),
    externalPropertyId: z.string().min(1).max(1000),
    keyEventNames: z.array(z.string().min(1).max(200)).max(20).optional(),
  })
  .strict();
export type SelectPropertyRequest = z.infer<typeof SelectPropertyRequest>;

export const ConnectSourceRequest = z.discriminatedUnion("phase", [
  AuthorizeSourceRequest,
  GetPropertySelectionRequest,
  SelectPropertyRequest,
]);
export type ConnectSourceRequest = z.infer<typeof ConnectSourceRequest>;

/** OAuth providers that use the connect endpoint (crawl/csv/dataforseo do not). */
export const OAuthProvider = z.enum(["gsc", "ga4"]);
export type OAuthProvider = z.infer<typeof OAuthProvider>;

/**
 * `importProjectSourceFile(mode=confirm)` request (spec §7.5). The `mapping`
 * values are SOURCE column names selected by the operator for each canonical
 * field; keyword/searchVolume/marketCode/languageCode are required.
 */
export const ImportConfirmMapping = z
  .object({
    keyword: z.string(),
    searchVolume: z.string(),
    cluster: z.string().nullable().optional(),
    currentUrl: z.string().nullable().optional(),
    currentRank: z.string().nullable().optional(),
    competitorDomain: z.string().nullable().optional(),
    competitorRank: z.string().nullable().optional(),
    marketCode: z.string(),
    languageCode: z.string(),
  })
  .strict();
export type ImportConfirmMapping = z.infer<typeof ImportConfirmMapping>;

export const ImportConfirmRequest = z
  .object({
    mode: z.literal("confirm"),
    importToken: z.string().min(32).max(512),
    mapping: ImportConfirmMapping,
  })
  .strict();
export type ImportConfirmRequest = z.infer<typeof ImportConfirmRequest>;

/** CSV import template — the MVP has exactly one (spec §7.5). */
export const ImportTemplateId = z.literal("keyword_gap_v1");
export type ImportTemplateId = z.infer<typeof ImportTemplateId>;
