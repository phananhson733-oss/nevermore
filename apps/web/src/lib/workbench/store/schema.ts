import { z } from "zod";
import {
  ARTIFACT_CONTENT_MAX,
  ARTIFACT_FILENAME_PATTERN,
  ARTIFACT_LIMIT,
  ARTIFACT_TITLE_MAX,
  HISTORY_LIMIT,
  type WorkbenchProjectState,
} from "../types.ts";

/**
 * Boundary validation for localStorage (design §6.5). Strict objects: a shape
 * this build cannot fully account for is never partially trusted.
 *
 * Evolution discipline (R14). An envelope whose only problem is keys this
 * build does not know (a newer build's addition, or a field this build
 * removed) is `incompatible`: the session stays read-only and never writes
 * over that data. Anything else this build cannot parse is `invalid` and gets
 * discarded and overwritten. Therefore:
 * - Adding an enum member, widening a type (including raising a `.max()`
 *   limit), narrowing one, renaming a field, or removing a field: bump
 *   `PERSISTED_VERSION`. The storage key carries the version, so the new
 *   envelope lands under a key older builds never read. Without the bump an
 *   older build reads a new enum member as `invalid` and overwrites it, and a
 *   build that removed a field leaves every existing project read-only for good.
 * - Adding a field: first ship, on its own, a reader that accepts it, and only
 *   write it in a later release. An older build that still meets the new field
 *   goes read-only rather than overwriting it, but it cannot save anything.
 * The domain side of this contract is `types.ts`: every type reachable from
 * `WorkbenchProjectState` is persisted through this schema.
 */
export const PERSISTED_VERSION = 1 as const;

const severity = z.enum(["high", "mid", "low"]);
const engine = z.enum(["seo", "geo", "both"]);
const level = z.enum(["high", "mid", "low"]);
const pageType = z.enum([
  "landing", "blog", "comparison", "listicle", "tool", "glossary", "answer-page",
]);
const nullableNumber = z.number().nullable();
/** `AuditReport.at` contract (types.ts): `"YYYY-MM-DD HH:mm"`, the slice(5) the site card shows. */
const auditStamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

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
  at: auditStamp,
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
  // v1 contract: only mock results are persisted. Widening this to
  // z.boolean() needs a PERSISTED_VERSION bump, like any narrowing or renaming:
  // this build would still parse the new data, but an older build reads
  // `real: true` as `invalid` (not `incompatible`), discards it and writes over
  // it. New fields follow the reader-first rule in the file header.
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
  // Pre-ship exemption from the bump rule above: dr and difficulty were widened
  // to nullable (a channel with no domain has no DR; unavailable is null, never
  // 0) before the first release. PR-1 never shipped, so no reader of the old
  // shape exists and PERSISTED_VERSION stays 1. Once released, a change like
  // this needs a bump.
  dr: nullableNumber,
  relevance: level,
  difficulty: level.nullable(),
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
  // Pre-ship exemption from the bump rule above: renamed from `indexed` (the
  // count is the audit's indexable pages, not pages a search engine indexed)
  // before the first release. PR-1 never shipped, so no reader of the old shape
  // exists and PERSISTED_VERSION stays 1. An envelope with the old key is
  // `invalid`, not `incompatible`: the missing `indexable` is a real defect.
  // Once released, a change like this needs a bump.
  indexable: z.number(),
  traffic: z.number(),
  dr: z.number(),
  refdomains: z.number(),
});

/**
 * `GscRowsSource | null` (types.ts), used twice: the project's current rows and
 * the provenance a profile snapshot froze when it was generated.
 */
const gscRowsSource = z.enum(["sample", "user"]).nullable();

const profileDoc = z.strictObject({
  crawl: crawlSignals.nullable(),
  gsc: z
    .strictObject({
      total: z.number(),
      // Pre-ship exemption from the bump rule above: these four were widened to
      // nullable (unavailable is null, never 0) before the first release. PR-1
      // never shipped, so no reader of the old all-number shape exists and
      // PERSISTED_VERSION stays 1. Once released, a change like this needs a bump.
      brandQueries: nullableNumber,
      brandClicks: nullableNumber,
      nonBrandClicks: nullableNumber,
      top: z.array(gscRow),
      near: nullableNumber,
    })
    .nullable(),
  // Pre-ship exemption 5, and the reason it is worth a field at all (Q6): a
  // document generated from the sample rows and then left alone while the user
  // imports real ones must keep saying "sample", and the reverse must not start
  // saying it. Only the value frozen here can answer that, so it is persisted
  // with the document. Adding a field otherwise follows the reader-first rule in
  // the file header; PR-1/PR-2 never shipped, so no envelope without this key
  // exists outside a developer's browser and PERSISTED_VERSION stays 1. After
  // release, a change like this needs the reader-first release or a bump.
  gscSource: gscRowsSource,
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
  // Bounds mirror the reducer's clamps (types.ts): a stored envelope is the
  // reducer's output, so a larger value here is tampering or another origin's
  // data, and the whole envelope is discarded rather than partially trusted.
  title: z.string().max(ARTIFACT_TITLE_MAX),
  content: z.string().max(ARTIFACT_CONTENT_MAX),
  filename: z.string().regex(ARTIFACT_FILENAME_PATTERN).optional(),
});

export const projectStateSchema = z.strictObject({
  profile,
  profileDoc: profileDoc.nullable(),
  conns: z.strictObject({ GSC: z.boolean(), GA4: z.boolean() }),
  gscRows: z.array(gscRow),
  // Pre-ship exemption 4: same reasoning as the `profileDoc.gscSource` note
  // above. An envelope written before this field existed is `invalid` (the
  // missing key is a real defect, not an unknown one), so it is discarded and
  // overwritten rather than freezing the project read-only.
  gscRowsSource,
  seeds: z.string(),
  built: z.boolean(),
  saved: z.array(savedKeyword),
  audit: auditReport.nullable(),
  auditHistory: z.array(auditReport).max(HISTORY_LIMIT),
  lastAudit: auditReport.nullable(),
  visResults: z.array(visResult),
  visPartial: z.boolean(),
  visHistory: z.array(visSnapshot).max(HISTORY_LIMIT),
  lastVis: visSnapshot.nullable(),
  compData: compData.nullable(),
  plans: z.record(z.string(), answerPlan),
  targets: z.array(linkTarget).nullable(),
  kb: z.strictObject({ entries: z.array(kbEntry), at: z.string() }).nullable(),
  artifacts: z.array(artifact).max(ARTIFACT_LIMIT),
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
// Intentionally unused type aliases (compile-time guards); would need a
// void-style escape if noUnusedLocals is ever enabled.
type _MissingInSchema = AssertNever<Exclude<keyof WorkbenchProjectState, keyof SchemaState>>;
type _ExtraInSchema = AssertNever<Exclude<keyof SchemaState, keyof WorkbenchProjectState>>;

export type PersistedParse =
  | { readonly kind: "ok"; readonly state: WorkbenchProjectState }
  | { readonly kind: "incompatible" | "invalid" };

/**
 * "No rows, no source" (Q6), re-applied to what came off disk. The reducer keeps
 * it for everything it writes (`sourceFor`), but the schema checks each field on
 * its own, so stored bytes can hold `{gscRows: [], gscRowsSource: "sample"}`. The
 * realistic writer is not the dev tools: `PERSISTED_VERSION` does not change
 * across a deploy, so during a deploy window a tab still running another build
 * writes the same key, and the `storage` event hands its state to this tab.
 *
 * What such a mark can mislead is narrow, and worth stating exactly: it never
 * reaches the next paste, because `setGscRows` always rewrites the source. The
 * exposure is any reader that looks at the source while there are no rows, and
 * — through the cross-tab path — this tab writing the mark back to disk on its
 * next local edit.
 *
 * Normalised, not rejected: the failure radius has to match where the failure
 * is. A MISSING key is `invalid` and the envelope goes, because it was written by
 * a build without the field; an envelope with every key that disagrees with
 * itself in one of them is not another version of the format, and condemning it
 * would take the basket, the profile snapshot and the seed words with it. A
 * `.refine` only looks more thorough because it would sit on this same read
 * layer that both load paths share; the fix is to normalise at that layer, not
 * to switch to rejecting.
 *
 * Only this direction. Rows with a `null` source stay as they are: nothing can
 * tell sample rows from the user's by looking at them, and inventing either (or
 * reading `state.demo`, or dropping the user's rows) would be a guess written
 * down as a fact. Readers render `null` as unknown provenance (types.ts).
 *
 * Returns the same object when there is nothing to fix.
 */
function withoutOrphanedGscSource(state: WorkbenchProjectState): WorkbenchProjectState {
  return state.gscRows.length === 0 && state.gscRowsSource !== null ? { ...state, gscRowsSource: null } : state;
}

/**
 * `incompatible`: every issue, at any depth, is a key this build does not know
 * (a newer build's addition, or a field this build removed). Callers must not
 * write over it. `invalid`: anything else, including an unknown key next to a
 * real defect.
 *
 * `ok` carries a normalised state (`withoutOrphanedGscSource`). This is the exit
 * every read of persisted bytes goes through — first hydration and the cross-tab
 * `storage` event both read via `readProjectState` — so no load path has to
 * remember to normalise, and the one that must NOT settle interrupted runs
 * (cross-tab) still gets this.
 */
export function classifyPersistedState(raw: unknown): PersistedParse {
  const result = persistedSchema.safeParse(raw);
  if (result.success) return { kind: "ok", state: withoutOrphanedGscSource(result.data.state) };
  const { issues } = result.error;
  const onlyUnknownKeys = issues.length > 0 && issues.every((issue) => issue.code === "unrecognized_keys");
  return { kind: onlyUnknownKeys ? "incompatible" : "invalid" };
}

export function parsePersistedState(raw: unknown): WorkbenchProjectState | null {
  const parsed = classifyPersistedState(raw);
  return parsed.kind === "ok" ? parsed.state : null;
}
