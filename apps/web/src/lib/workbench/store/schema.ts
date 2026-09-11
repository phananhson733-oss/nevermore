import { z } from "zod";
import type { WorkbenchProjectState } from "../types.ts";

/**
 * Boundary validation for localStorage (design §6.5). Strict objects: a stale
 * shape from an older dev build is discarded, never partially trusted.
 */
export const PERSISTED_VERSION = 1 as const;

const severity = z.enum(["high", "mid", "low"]);
const engine = z.enum(["seo", "geo", "both"]);
const level = z.enum(["high", "mid", "low"]);
const pageType = z.enum([
  "landing", "blog", "comparison", "listicle", "tool", "glossary", "answer-page",
]);
const nullableNumber = z.number().nullable();

const profile = z.strictObject({
  url: z.string(),
  brand: z.string(),
  positioning: z.string(),
  features: z.string(),
  competitors: z.string(),
  market: z.string(),
});

const gscRow = z.strictObject({
  query: z.string(),
  clicks: nullableNumber,
  impressions: nullableNumber,
  ctr: nullableNumber,
  position: nullableNumber,
});

const finding = z.strictObject({
  id: z.string(),
  cat: z.string(),
  t: z.string(),
  sev: severity,
  eng: engine,
  found: z.string(),
  expect: z.string(),
  fix: z.string(),
  w: z.number(),
  page: z.string(),
});

const auditReport = z.strictObject({
  at: z.string(),
  score: z.number(),
  findings: z.array(finding),
  crawl: z.strictObject({
    pages: z.number(),
    indexable: z.number(),
    blocked: z.number(),
    orphan: z.number(),
    lcp: z.string(),
    schema: z.number(),
    llmReadable: z.number(),
  }),
  pageRows: z.array(
    z.strictObject({
      url: z.string(),
      status: z.number(),
      h1: z.number(),
      hasSchema: z.boolean(),
      lcp: z.string(),
      issues: z.number(),
    }),
  ),
});

const visResult = z.strictObject({
  p: z.string(),
  platform: z.string(),
  hit: z.boolean(),
  rank: nullableNumber,
  brands: z.array(z.string()),
  domains: z.array(z.string()),
  // v1 contract: only mock results are persisted. Widening to z.boolean()
  // rejects nothing old, but ANY narrowing or renaming here needs a
  // PERSISTED_VERSION bump.
  real: z.literal(false),
});

const visSnapshot = z.strictObject({ at: z.string(), results: z.array(visResult) });

const savedKeyword = z.strictObject({
  q: z.string(),
  addedAt: z.string(),
  source: z.enum(["matrix", "manual", "gap"]),
  note: z.string().optional(),
});

const domainStats = z.strictObject({
  domain: z.string(),
  traffic: z.number(),
  kws: z.number(),
  dr: z.number(),
  refdomains: z.number(),
  topPages: z.array(z.strictObject({ path: z.string(), share: z.number() })),
});

const gapRow = z.strictObject({
  q: z.string(),
  volume: z.number(),
  kd: z.number(),
  cpc: z.string(),
  aio: z.boolean(),
  ranks: z.array(nullableNumber),
  ours: nullableNumber,
  page: pageType,
});

const compData = z.strictObject({
  domains: z.array(domainStats),
  gap: z.strictObject({ comps: z.array(z.string()), rows: z.array(gapRow) }),
  at: z.string(),
});

const answerPlan = z.strictObject({
  url: z.string(),
  h1: z.string(),
  lead: z.string(),
  subq: z.array(z.string()),
  facts: z.array(z.string()),
  dims: z.array(z.string()),
  faq: z.array(z.string()),
  internal: z.array(z.string()),
  schema: z.string(),
  beat: z.string(),
});

const linkTarget = z.strictObject({
  type: z.enum(["dir", "agg", "comm", "rev", "media", "swap"]),
  site: z.string(),
  domain: z.string(),
  dr: z.number(),
  relevance: level,
  difficulty: level,
  action: z.string(),
  asset: z.string(),
});

const kbEntry = z.strictObject({
  id: z.string(),
  cat: z.enum(["definition", "capability", "boundary", "pricing", "comparison", "data", "faq"]),
  statement: z.string(),
  evidence: z.string(),
  source: z.string(),
  from: z.enum(["crawl", "gap", "aiDraft", "manual"]),
});

const crawlSignals = z.strictObject({
  pages: z.number(),
  lang: z.string(),
  stack: z.string(),
  h1: z.string(),
  hasPricing: z.boolean(),
  hasDocs: z.boolean(),
  hasBlog: z.boolean(),
  indexed: z.number(),
  traffic: z.number(),
  dr: z.number(),
  refdomains: z.number(),
});

const profileDoc = z.strictObject({
  crawl: crawlSignals.nullable(),
  gsc: z
    .strictObject({
      total: z.number(),
      brandQueries: z.number(),
      brandClicks: z.number(),
      nonBrandClicks: z.number(),
      top: z.array(gscRow),
      near: z.number(),
    })
    .nullable(),
  third: crawlSignals.nullable(),
  ai: z.strictObject({
    summary: z.string(),
    icp: z.array(
      z.strictObject({
        seg: z.string(),
        role: z.string(),
        pain: z.string(),
        trigger: z.string(),
        objection: z.string(),
      }),
    ),
    value_props: z.array(z.string()),
    diff: z.array(z.string()),
    pillars: z.array(z.string()),
    facts: z.array(z.string()),
    tone: z.string(),
  }),
  at: z.string(),
});

const artifact = z.strictObject({
  id: z.string(),
  at: z.string(),
  module: z.enum([
    "audit", "visibility", "keywords", "keywordLibrary", "competitors",
    "links", "content", "kb", "answers", "profile", "week",
  ]),
  type: z.enum(["csv", "prompt", "md", "json"]),
  engine,
  title: z.string(),
  content: z.string(),
  filename: z.string().optional(),
});

export const projectStateSchema = z.strictObject({
  profile,
  profileDoc: profileDoc.nullable(),
  conns: z.strictObject({ GSC: z.boolean(), GA4: z.boolean() }),
  gscRows: z.array(gscRow),
  seeds: z.string(),
  built: z.boolean(),
  saved: z.array(savedKeyword),
  audit: auditReport.nullable(),
  auditHistory: z.array(auditReport),
  lastAudit: auditReport.nullable(),
  visResults: z.array(visResult),
  visPartial: z.boolean(),
  visHistory: z.array(visSnapshot),
  lastVis: visSnapshot.nullable(),
  compData: compData.nullable(),
  plans: z.record(z.string(), answerPlan),
  targets: z.array(linkTarget).nullable(),
  kb: z.strictObject({ entries: z.array(kbEntry), at: z.string() }).nullable(),
  artifacts: z.array(artifact),
  notify: z.strictObject({
    weekly: z.boolean(),
    drop: z.boolean(),
    mention: z.boolean(),
    gsc: z.boolean(),
  }),
  demo: z.boolean(),
});

const persistedSchema = z.strictObject({
  v: z.literal(PERSISTED_VERSION),
  state: projectStateSchema,
});

// Drift guards. (1) What the schema accepts must be a valid domain state:
// catches changed field types and required domain fields missing from the
// schema. (2) The two key sets must match in both directions. (1) alone lets
// an *optional* domain field slip past, and because the schema is strict, the
// first persisted write of that field would make every later read fail and
// silently reset the user's data (design §6.5). Top level only; nested shapes
// are covered by the filled fixture in schema.test.ts.
type SchemaState = z.infer<typeof projectStateSchema>;
const _schemaIsDomainState: WorkbenchProjectState = null as unknown as SchemaState;
void _schemaIsDomainState;
type AssertNever<T extends never> = T;
type _MissingInSchema = AssertNever<Exclude<keyof WorkbenchProjectState, keyof SchemaState>>;
type _ExtraInSchema = AssertNever<Exclude<keyof SchemaState, keyof WorkbenchProjectState>>;

export function parsePersistedState(raw: unknown): WorkbenchProjectState | null {
  const result = persistedSchema.safeParse(raw);
  return result.success ? result.data.state : null;
}
