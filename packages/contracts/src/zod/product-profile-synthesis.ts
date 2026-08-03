import { z } from "zod";
import { Bcp47Locale, IsoDateTime, MarketCode, Uuid } from "./common.ts";
import { ProductProfileCompetitorDomain } from "./product-profile.ts";
import { ProductProfileProductUrl } from "./projects.ts";

export const PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION =
  "product-profile-synthesis-input.0.3.0" as const;
export const PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION =
  "product-profile-synthesis-input.0.3.1" as const;
export const PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION =
  "product-profile-synthesis-input.0.3.2" as const;
export const PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION =
  "product-profile-page-selection.0.3.0" as const;
export const PRODUCT_PROFILE_SELECTION_POLICY_VERSION =
  "product-profile-page-selection.0.3.1" as const;
export const PRODUCT_PROFILE_SYNTHESIS_VERSION =
  "product-profile-synthesis.0.3.0" as const;
export const MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES = 12;

const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedVersion = z.string().trim().min(1).max(200);
const BoundedLimitation = z.string().trim().min(1).max(2000);

export const ProductProfileSynthesisBaseProfile = z
  .object({
    id: Uuid,
    version: z.number().int().min(1),
    contentHash: Sha256Hex,
    status: z.literal("draft"),
  })
  .strict();
export type ProductProfileSynthesisBaseProfile = z.infer<
  typeof ProductProfileSynthesisBaseProfile
>;

export const ProductProfileSynthesisCrawlSnapshot = z
  .object({
    id: Uuid,
    collectionRunId: Uuid,
    sourceConnectionId: Uuid.nullable(),
    provider: z.literal("crawl"),
    datasetKey: z.literal("crawl.site_graph.v1"),
    schemaVersion: BoundedVersion,
    methodVersion: BoundedVersion,
    capturedAt: IsoDateTime,
    checksum: Sha256Hex,
    availability: z.enum(["available", "partial"]),
    rowCount: z.number().int().min(1),
    limitation: BoundedLimitation,
  })
  .strict();
export type ProductProfileSynthesisCrawlSnapshot = z.infer<
  typeof ProductProfileSynthesisCrawlSnapshot
>;

export const ProductProfileSynthesisPage = z
  .object({
    pageSnapshotId: Uuid,
    sitePageId: Uuid,
    dataSnapshotId: Uuid,
    normalizedUrl: ProductProfileProductUrl,
    normalizedUrlHash: Sha256Hex,
    contentHash: Sha256Hex,
    capturedAt: IsoDateTime,
  })
  .strict();
export type ProductProfileSynthesisPage = z.infer<
  typeof ProductProfileSynthesisPage
>;

const ProductProfileSynthesisDomainOverlapObservationShape = {
  observationId: Uuid,
  domain: ProductProfileCompetitorDomain,
  intersections: z.number().int().positive(),
  organicEstimatedTrafficVolume: z.number().finite().nonnegative(),
  observedAt: IsoDateTime,
} as const;

const ProductProfileSynthesisLegacyDomainOverlapObservation = z
  .object(ProductProfileSynthesisDomainOverlapObservationShape)
  .strict();

const ProductProfileSynthesisDomainOverlapObservation = z
  .object({
    sourceKind: z.literal("domain_overlap"),
    ...ProductProfileSynthesisDomainOverlapObservationShape,
  })
  .strict();

const ProductProfileSynthesisSerpCompetitorObservation = z
  .object({
    sourceKind: z.literal("serp_competitor"),
    observationId: Uuid,
    domain: ProductProfileCompetitorDomain,
    rating: z.number().finite().nonnegative(),
    keywordsCount: z.number().int().nonnegative(),
    relevantSerpItems: z.number().int().nonnegative(),
    organicEstimatedTrafficVolume: z.number().finite().nonnegative(),
    observedAt: IsoDateTime,
  })
  .strict();

export const ProductProfileSynthesisCompetitorObservation = z.union([
  ProductProfileSynthesisLegacyDomainOverlapObservation,
  ProductProfileSynthesisDomainOverlapObservation,
  ProductProfileSynthesisSerpCompetitorObservation,
]);
export type ProductProfileSynthesisCompetitorObservation = z.infer<
  typeof ProductProfileSynthesisCompetitorObservation
>;

export const ProductProfileSynthesisCompetitorDiscovery = z
  .object({
    snapshotId: Uuid,
    collectionRunId: Uuid,
    sourceConnectionId: Uuid,
    datasetKey: z.enum([
      "dataforseo.search_landscape.v1",
      "dataforseo.search_landscape.v2",
    ]),
    schemaVersion: z.enum([
      "dataforseo.search_landscape.v1",
      "dataforseo.search_landscape.v2",
    ]),
    methodVersion: z.enum([
      "dataforseo.search_landscape.v1",
      "dataforseo.search_landscape.v2",
    ]),
    capturedAt: IsoDateTime,
    checksum: Sha256Hex,
    availability: z.enum(["available", "partial"]),
    rowCount: z.number().int().positive(),
    limitation: BoundedLimitation,
    targetDomain: ProductProfileCompetitorDomain,
    marketCode: MarketCode,
    languageCode: z.string().trim().min(2).max(35),
    observations: z
      .array(ProductProfileSynthesisCompetitorObservation)
      .max(100)
      .refine(
        (items) =>
          new Set(items.map((item) => item.observationId)).size === items.length,
        "competitor observation ids must be unique",
      )
      .refine(
        (items) =>
          new Set(items.map((item) => item.domain)).size === items.length,
        "competitor observation domains must be unique",
      ),
  })
  .strict()
  .refine(
    (value) =>
      value.datasetKey === value.schemaVersion &&
      value.datasetKey === value.methodVersion,
    "DataForSEO competitor discovery identity must use one exact version",
  );
export type ProductProfileSynthesisCompetitorDiscovery = z.infer<
  typeof ProductProfileSynthesisCompetitorDiscovery
>;

const ProductProfileSynthesisInputManifestShape = {
  projectId: Uuid,
  siteId: Uuid,
  sourcePageUrl: ProductProfileProductUrl,
  baseProfile: ProductProfileSynthesisBaseProfile,
  crawlSnapshot: ProductProfileSynthesisCrawlSnapshot,
  pages: z
    .array(ProductProfileSynthesisPage)
    .min(1)
    .max(MAX_PRODUCT_PROFILE_SYNTHESIS_PAGES),
} as const;

const ProductProfileSynthesisInputManifestObject = z.discriminatedUnion(
  "schemaVersion",
  [
    z
      .object({
        schemaVersion: z.literal(
          PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION,
        ),
        selectionPolicyVersion: z.literal(
          PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
        ),
        ...ProductProfileSynthesisInputManifestShape,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(
          PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION,
        ),
        selectionPolicyVersion: z.literal(
          PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
        ),
        outputLocale: Bcp47Locale,
        ...ProductProfileSynthesisInputManifestShape,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(
          PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
        ),
        selectionPolicyVersion: z.literal(
          PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
        ),
        outputLocale: Bcp47Locale,
        competitorDiscovery:
          ProductProfileSynthesisCompetitorDiscovery.nullable(),
        ...ProductProfileSynthesisInputManifestShape,
      })
      .strict(),
  ],
);

function addDuplicateIssue(
  values: readonly string[],
  path: "pageSnapshotId" | "sitePageId" | "normalizedUrl",
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: ["pages", index, path],
        message: `${path} must be unique within the frozen page selection`,
      });
    }
    seen.add(value);
  });
}

export const ProductProfileSynthesisInputManifest =
  ProductProfileSynthesisInputManifestObject.superRefine((manifest, ctx) => {
    addDuplicateIssue(
      manifest.pages.map((page) => page.pageSnapshotId),
      "pageSnapshotId",
      ctx,
    );
    addDuplicateIssue(
      manifest.pages.map((page) => page.sitePageId),
      "sitePageId",
      ctx,
    );
    addDuplicateIssue(
      manifest.pages.map((page) => page.normalizedUrl),
      "normalizedUrl",
      ctx,
    );

    if (manifest.pages[0]?.normalizedUrl !== manifest.sourcePageUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["pages", 0, "normalizedUrl"],
        message: "the exact sourcePageUrl must be the first selected page",
      });
    }

    const sourcePageOccurrences = manifest.pages.filter(
      (page) => page.normalizedUrl === manifest.sourcePageUrl,
    ).length;
    if (sourcePageOccurrences !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["pages"],
        message: "sourcePageUrl must occur exactly once in the page selection",
      });
    }

    manifest.pages.forEach((page, index) => {
      if (page.dataSnapshotId !== manifest.crawlSnapshot.id) {
        ctx.addIssue({
          code: "custom",
          path: ["pages", index, "dataSnapshotId"],
          message: "every page must belong to the frozen Crawl DataSnapshot",
        });
      }
    });
  });
export type ProductProfileSynthesisInputManifest = z.infer<
  typeof ProductProfileSynthesisInputManifest
>;
