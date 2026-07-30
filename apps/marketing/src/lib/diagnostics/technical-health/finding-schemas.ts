// @input  -- zod + @/lib/url-guards (isSafeUrl SOT)
// @output -- Severity/ModuleId/Evidence/DiagnosticFinding/TopFinding/FindingListItem schemas（PRD §17 entity types）+ SafeUrlSchema (Plan A H3 — defense-in-depth scheme guard at API boundary so non-UI consumers still get rejection)
// @pos    -- W3a.2 Plan A H4 split — finding/evidence 维度 SOT；run-schemas.ts + query-schemas.ts 都 import 自此；H3 audit fix lifts the http(s) refinement into the schema layer so worker-supplied URLs are rejected on parse rather than only at render
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { z } from "zod";
import { isSafeUrl } from "@/lib/url-guards";

/**
 * Plan A H3 — Zod-level scheme guard. The UI components apply isSafeUrl at
 * render time (Issue #39 M5), but a CSV exporter, mobile client, AI consumer,
 * or future SDK wrapper that bypasses the rendering layer would otherwise
 * surface raw `javascript:` / `data:` strings. Refining at parse time pushes
 * the rejection up to the API boundary, the correct defense-in-depth layer.
 */
export const SafeUrlSchema = z
  .string()
  .refine(isSafeUrl, { message: "URL must use http(s) scheme" });

export const SeveritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ModuleIdSchema = z.enum([
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
  "A10",
  "A11",
  "A12",
  "A13",
  "A14",
]);
export type ModuleId = z.infer<typeof ModuleIdSchema>;

export const EVIDENCE_TYPES = [
  "http_status",
  "robots",
  "sitemap",
  "gsc",
  "url_inspection",
  "render_diff",
  "html_extract",
  "pagespeed",
  "crux",
  "security_header",
  "analytics_tag",
  "screenshot",
  "internal_link_graph",
  "structured_data",
] as const;

export const EvidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceSchema = z.object({
  type: EvidenceTypeSchema,
  source: z.string().min(1),
  value: z.unknown(),
  url: SafeUrlSchema.optional(),
  template: z.string().optional(),
  capturedAt: z.string(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const DiagnosticFindingSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  siteId: z.string().min(1),
  moduleId: ModuleIdSchema,
  checkId: z.string().min(1),
  severity: SeveritySchema,
  title: z.string().min(1),
  problemDefinition: z.string(),
  diagnosticConclusion: z.string(),
  whyItMatters: z.string(),
  detectionRule: z.string(),
  observedValue: z.unknown(),
  expectedCondition: z.string(),
  affectedUrlCount: z.number().int().nonnegative(),
  affectedUrlPercent: z.number().min(0).max(100),
  affectedCoreUrlCount: z.number().int().nonnegative(),
  affectedTemplates: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  sampleUrls: z.array(SafeUrlSchema),
  dataSources: z.array(z.string()),
  confidence: z.number().min(0).max(1), // 0-1 fraction (DB-aligned); Phase 6 confidence formula keeps same scale
  confidenceReason: z.string(),
  createdAt: z.string(),
});

export type DiagnosticFinding = z.infer<typeof DiagnosticFindingSchema>;

/**
 * One row in RunSummaryResponse.topFindings — diagnosis-only ranking pointer
 * (PRD §17/§18.2). DOES NOT carry the heavy fields (problem/why-it-matters
 * etc.) — that comes from GET findingDetail. Strictly no recommendation /
 * owner / effort / taskId per PRD §3 boundary.
 */
export const TopFindingSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  moduleId: ModuleIdSchema,
  title: z.string().min(1),
});

export type TopFinding = z.infer<typeof TopFindingSchema>;

/**
 * One row in FindingsListResponse.items — drawer-summary shape (PRD §17 +
 * §18.4). Heavy fields (evidence/sampleUrls/whyItMatters) come from
 * findingDetail; this row is sized for table rendering.
 */
export const FindingListItemSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  moduleId: ModuleIdSchema,
  checkId: z.string().min(1),
  title: z.string().min(1),
  affectedUrlCount: z.number().int().nonnegative().nullable(),
  affectedUrlPercent: z.number().min(0).max(100).nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
});

export type FindingListItem = z.infer<typeof FindingListItemSchema>;
