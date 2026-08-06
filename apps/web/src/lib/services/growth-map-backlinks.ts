import {
  GrowthMapBacklinkReadModel as GrowthMapBacklinkReadModelSchema,
  type BacklinkAuthorityMetric,
  type BacklinkCoverage,
  type BacklinkMetric,
  type BacklinkOpportunity,
  type BacklinkReferringDomain,
  type BacklinkSnapshotSource,
  type GrowthMapBacklinkReadModel,
} from "@sf/contracts";
import {
  BacklinkAuthorityIntegrityError,
  BacklinkGrowthMapRepository,
  ProjectsRepository,
  type BacklinkAuthoritySnapshotRow,
  type BacklinkFactRow,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import type { UiLocale } from "@sf/i18n";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_COMPARISON_DISTANCE_MS = 45 * DAY_MS;

interface BacklinkProjectionCopy {
  readonly noAuthority: string;
  readonly noComparableCompetitor: string;
  readonly searchDerivedLimitation: string;
  readonly manualCsvLimitation: string;
  readonly providerUnavailable: (provider: string) => string;
  readonly siteGapTitle: string;
  readonly siteGapSummary: (
    provider: string,
    current: number,
    benchmark: number,
  ) => string;
  readonly pageGapTitle: string;
  readonly pageGapSummary: (provider: string) => string;
}

function backlinkProjectionCopy(locale: UiLocale): BacklinkProjectionCopy {
  if (locale === "en") {
    return {
      noAuthority: "No readable backlink snapshot is available yet.",
      noComparableCompetitor:
        "No approved competitor has a snapshot from the same Provider and a comparable collection window, so no quantity comparison is shown.",
      searchDerivedLimitation:
        "Search-derived evidence is only a verified observed subset, not a complete backlink index; it does not provide DR or site-wide totals.",
      manualCsvLimitation:
        "Manual CSV evidence counts only the imported records, not a complete backlink index; it does not provide DR.",
      providerUnavailable: (provider) =>
        `${provider} backlink authority is currently unavailable; missing metrics remain unavailable rather than zero.`,
      siteGapTitle:
        "Approved competitors have materially broader referring-domain coverage",
      siteGapSummary: (provider, current, benchmark) =>
        `Within the same ${provider} scope, the current site has ${current} referring domains and the comparable-competitor median is ${benchmark}.`,
      pageGapTitle: "No backlinks are observed for this page by the Provider",
      pageGapSummary: (provider) =>
        `${provider} currently reports zero backlinks and zero referring domains for this exact page.`,
    };
  }
  return {
    noAuthority: "尚无可读取的外链数据快照。",
    noComparableCompetitor:
      "没有同一 Provider、相近采集窗口的已批准竞品快照，暂不做竞品数量对比。",
    searchDerivedLimitation:
      "Search-derived 仅表示已验证发现，不是完整外链索引，不提供 DR 或全站总量。",
    manualCsvLimitation:
      "手动 CSV 仅统计本次已导入记录，不代表完整外链索引，不提供 DR。",
    providerUnavailable: (provider) =>
      `${provider} 外链权威当前不可用；缺失指标保持不可用，不会补成 0。`,
    siteGapTitle: "已批准竞品的引用域覆盖明显领先",
    siteGapSummary: (provider, current, benchmark) =>
      `同一 ${provider} 口径下，当前站点为 ${current} 个引用域，可比竞品中位数为 ${benchmark} 个。`,
    pageGapTitle: "页面尚无 Provider 观测到的外链",
    pageGapSummary: (provider) =>
      `${provider} 当前索引中，该页面的外链与引用域均为 0。`,
  };
}

type BacklinkWorkspaceScope = WorkspaceScope & {
  readonly uiLocale: UiLocale;
};

function providerLabel(provider: BacklinkSnapshotSource["provider"]): string {
  switch (provider) {
    case "ahrefs":
      return "Ahrefs";
    case "moz":
      return "Moz";
    case "dataforseo":
      return "DataForSEO";
    case "manual_csv":
      return "Manual CSV";
    case "search_derived":
      return "Search-derived";
  }
}

function corruptBacklinks(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "外链增长路径的数据权威链未通过完整性校验。",
  );
}

function exactNow(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return corruptBacklinks();
  }
  return now.toISOString();
}

function coverageFor(
  row: BacklinkAuthoritySnapshotRow,
  copy: BacklinkProjectionCopy,
): BacklinkCoverage {
  if (row.availability === "available") {
    if (
      row.source_kind !== "provider_import" ||
      row.index_scope !== "provider_index" ||
      row.limitation !== null ||
      row.total_backlinks === null ||
      row.total_referring_domains === null ||
      row.observed_backlinks !== null ||
      row.observed_referring_domains !== null ||
      row.authority_metric_kind === null ||
      row.authority_metric_value === null
    ) {
      return corruptBacklinks();
    }
    return {
      availability: "available",
      indexScope: "provider_index",
      limitations: [],
    };
  }
  if (row.availability === "partial") {
    if (
      row.source_kind === "provider_import" ||
      row.index_scope !== "observed_subset" ||
      row.limitation === null ||
      row.total_backlinks !== null ||
      row.total_referring_domains !== null ||
      row.observed_backlinks === null ||
      row.observed_referring_domains === null ||
      row.authority_metric_kind !== null ||
      row.authority_metric_value !== null
    ) {
      return corruptBacklinks();
    }
    return {
      availability: "partial",
      indexScope: "observed_subset",
      limitations: [
        row.source_kind === "manual_csv"
          ? copy.manualCsvLimitation
          : copy.searchDerivedLimitation,
      ],
    };
  }
  if (
    row.source_kind !== "provider_import" ||
    (row.provider !== "ahrefs" &&
      row.provider !== "moz" &&
      row.provider !== "dataforseo") ||
    row.index_scope !== "unavailable" ||
    row.limitation === null ||
    row.total_backlinks !== null ||
    row.total_referring_domains !== null ||
    row.observed_backlinks !== null ||
    row.observed_referring_domains !== null ||
    row.authority_metric_kind !== null ||
    row.authority_metric_value !== null
  ) {
    return corruptBacklinks();
  }
  return {
    availability: "unavailable",
    indexScope: "unavailable",
    limitations: [
      copy.providerUnavailable(providerLabel(row.provider)),
    ],
  };
}

function metric(
  row: BacklinkAuthoritySnapshotRow,
  kind: "backlinks" | "referring_domains",
): BacklinkMetric {
  if (row.availability === "unavailable") {
    return { semantics: "unavailable", value: null };
  }
  if (row.source_kind === "provider_import") {
    const value =
      kind === "backlinks"
        ? row.total_backlinks
        : row.total_referring_domains;
    if (value === null) return corruptBacklinks();
    return { semantics: "provider_index_total", value };
  }
  const value =
    kind === "backlinks"
      ? row.observed_backlinks
      : row.observed_referring_domains;
  if (value === null) return corruptBacklinks();
  return { semantics: "observed_fact_count", value };
}

function authorityMetric(
  row: BacklinkAuthoritySnapshotRow,
): BacklinkAuthorityMetric | null {
  if (
    row.authority_metric_kind === null &&
    row.authority_metric_value === null
  ) {
    return null;
  }
  if (
    row.source_kind !== "provider_import" ||
    row.availability === "unavailable" ||
    row.authority_metric_kind === null ||
    row.authority_metric_value === null ||
    (row.provider === "ahrefs" &&
      row.authority_metric_kind !== "domain_rating") ||
    (row.provider === "moz" &&
      row.authority_metric_kind !== "domain_authority") ||
    (row.provider === "dataforseo" &&
      row.authority_metric_kind !== "dataforseo_rank")
  ) {
    return corruptBacklinks();
  }
  return {
    kind: row.authority_metric_kind,
    value: row.authority_metric_value,
  };
}

function sourceProjection(
  row: BacklinkAuthoritySnapshotRow,
  copy: BacklinkProjectionCopy,
): BacklinkSnapshotSource {
  if (
    (row.source_kind === "provider_import" &&
      row.provider !== "ahrefs" &&
      row.provider !== "moz" &&
      row.provider !== "dataforseo") ||
    (row.source_kind === "manual_csv" &&
      (row.provider !== "manual_csv" ||
        row.import_preview_id === null)) ||
    (row.source_kind === "search_derived" &&
      (row.provider !== "search_derived" ||
        row.import_preview_id !== null)) ||
    (row.source_kind !== "manual_csv" &&
      row.import_preview_id !== null)
  ) {
    return corruptBacklinks();
  }
  return {
    snapshotId: row.id,
    subjectKind: row.subject_kind,
    subjectId:
      row.subject_kind === "primary_site"
        ? row.site_id
        : (row.competitor_id ?? corruptBacklinks()),
    subjectName: row.subject_name,
    domain: row.domain,
    sourceKind: row.source_kind,
    provider: row.provider,
    capturedAt: row.captured_at,
    coverage: coverageFor(row, copy),
    backlinks: metric(row, "backlinks"),
    referringDomains: metric(row, "referring_domains"),
    authorityMetric: authorityMetric(row),
    trace: {
      sourceRef: row.source_ref,
      checksum: row.checksum,
      rowCount: row.row_count,
      importPreviewId: row.import_preview_id,
    },
  };
}

function comparableCompetitors(
  primary: BacklinkSnapshotSource,
  competitors: readonly BacklinkSnapshotSource[],
): BacklinkSnapshotSource[] {
  if (
    primary.sourceKind !== "provider_import" ||
    primary.coverage.availability !== "available" ||
    (primary.provider !== "ahrefs" &&
      primary.provider !== "moz" &&
      primary.provider !== "dataforseo")
  ) {
    return [];
  }
  const primaryCapturedAt = Date.parse(primary.capturedAt);
  return competitors.filter(
    (competitor) =>
      competitor.sourceKind === "provider_import" &&
      competitor.provider === primary.provider &&
      competitor.coverage.availability === "available" &&
      Math.abs(Date.parse(competitor.capturedAt) - primaryCapturedAt) <=
        MAX_COMPARISON_DISTANCE_MS,
  );
}

function authorityPreference(
  source: BacklinkSnapshotSource,
): readonly [number, number, string] {
  const sourceRank =
    source.coverage.availability === "available" &&
    source.sourceKind === "provider_import"
      ? 0
      : source.coverage.availability === "partial" &&
          source.sourceKind !== "provider_import"
        ? 1
        : 2;
  return [
    sourceRank,
    -Date.parse(source.capturedAt),
    source.snapshotId,
  ];
}

function preferredAuthority(
  sources: readonly BacklinkSnapshotSource[],
): BacklinkSnapshotSource | null {
  return (
    [...sources].sort((left, right) => {
      const leftRank = authorityPreference(left);
      const rightRank = authorityPreference(right);
      return (
        leftRank[0] - rightRank[0] ||
        leftRank[1] - rightRank[1] ||
        leftRank[2].localeCompare(rightRank[2])
      );
    })[0] ?? null
  );
}

function preferredCompetitorAuthorities(
  sources: readonly BacklinkSnapshotSource[],
  primary: BacklinkSnapshotSource | null,
): BacklinkSnapshotSource[] {
  const grouped = new Map<string, BacklinkSnapshotSource[]>();
  for (const source of sources) {
    if (source.subjectKind !== "approved_competitor") continue;
    const group = grouped.get(source.subjectId) ?? [];
    group.push(source);
    grouped.set(source.subjectId, group);
  }
  return [...grouped.values()]
    .flatMap((group) => {
      const providerAligned =
        primary?.sourceKind === "provider_import" &&
        primary.coverage.availability === "available"
          ? group.filter(
              (source) =>
                source.sourceKind === "provider_import" &&
                source.provider === primary.provider &&
                source.coverage.availability === "available",
            )
          : [];
      const selected = preferredAuthority(
        providerAligned.length > 0 ? providerAligned : group,
      );
      return selected === null ? [] : [selected];
    })
    .sort(
      (left, right) =>
        left.domain.localeCompare(right.domain) ||
        left.snapshotId.localeCompare(right.snapshotId),
    )
    .slice(0, 50);
}

function referringDomainProjection(
  facts: readonly BacklinkFactRow[],
  source: BacklinkSnapshotSource,
): BacklinkReferringDomain[] {
  const groups = new Map<string, BacklinkFactRow[]>();
  for (const fact of facts) {
    if (fact.snapshot_id !== source.snapshotId) continue;
    const rows = groups.get(fact.referring_domain) ?? [];
    rows.push(fact);
    groups.set(fact.referring_domain, rows);
  }
  return [...groups.entries()]
    .map(([domain, rows]) => {
      const first = rows[0];
      if (!first) return corruptBacklinks();
      const scoreRows = rows.filter(
        (row) =>
          row.source_authority_metric_kind !== null &&
          row.source_authority_metric_value !== null,
      );
      if (
        source.sourceKind !== "provider_import" &&
        scoreRows.length > 0
      ) {
        return corruptBacklinks();
      }
      const expectedAuthorityKind =
        source.provider === "ahrefs"
          ? "domain_rating"
          : source.provider === "moz"
            ? "domain_authority"
            : source.provider === "dataforseo"
              ? "dataforseo_rank"
              : null;
      if (
        scoreRows.some(
          (row) =>
            expectedAuthorityKind === null ||
            row.source_authority_metric_kind !== expectedAuthorityKind,
        )
      ) {
        return corruptBacklinks();
      }
      const score = scoreRows
        .slice()
        .sort(
          (left, right) =>
            (right.source_authority_metric_value ?? -1) -
            (left.source_authority_metric_value ?? -1),
        )[0];
      const targetCounts = new Map<string, number>();
      for (const row of rows) {
        targetCounts.set(
          row.target_url,
          (targetCounts.get(row.target_url) ?? 0) + 1,
        );
      }
      const topTargetUrl = [...targetCounts.entries()].sort(
        (left, right) =>
          right[1] - left[1] || left[0].localeCompare(right[0]),
      )[0]?.[0];
      if (!topTargetUrl) return corruptBacklinks();
      return {
        domain,
        observedBacklinks: rows.length,
        authorityMetric:
          score?.source_authority_metric_kind === null ||
          score?.source_authority_metric_kind === undefined ||
          score.source_authority_metric_value === null
            ? null
            : {
                kind: score.source_authority_metric_kind,
                value: score.source_authority_metric_value,
              },
        topTargetUrl,
        snapshotId: source.snapshotId,
        factIds: rows.map((row) => row.id).sort().slice(0, 100),
      };
    })
    .sort(
      (left, right) =>
        right.observedBacklinks - left.observedBacklinks ||
        left.domain.localeCompare(right.domain),
    )
    .slice(0, 100);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function siteGapOpportunity(
  primary: BacklinkSnapshotSource,
  competitors: readonly BacklinkSnapshotSource[],
  copy: BacklinkProjectionCopy,
): BacklinkOpportunity | null {
  const current = primary.referringDomains.value;
  const benchmark = median(
    competitors.flatMap((competitor) =>
      competitor.referringDomains.value === null
        ? []
        : [competitor.referringDomains.value],
    ),
  );
  if (
    current === null ||
    benchmark === null ||
    benchmark < current + 20 ||
    benchmark < current * 1.5
  ) {
    return null;
  }
  const roundedBenchmark = Math.round(benchmark);
  const provider = providerLabel(primary.provider);
  return {
    opportunityKey: `backlink:site-gap:${primary.snapshotId}:${competitors
      .map((item) => item.snapshotId)
      .sort()
      .join(",")}`,
    kind: "site_referring_domain_gap",
    severity: "high",
    title: copy.siteGapTitle,
    summary: copy.siteGapSummary(provider, current, roundedBenchmark),
    sitePageId: null,
    evidenceSnapshotIds: [
      primary.snapshotId,
      ...competitors.map((item) => item.snapshotId).sort(),
    ],
    executionRef: null,
  };
}

async function readBacklinksInSnapshot(
  exec: Executor,
  scope: BacklinkWorkspaceScope,
  projectId: string,
  generatedAt: string,
): Promise<GrowthMapBacklinkReadModel> {
  const project = await new ProjectsRepository(exec).findById(
    scope,
    projectId,
  );
  if (!project || project.archived_at !== null) {
    throw new ProblemError("NOT_FOUND", "Project not found.");
  }
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  const repository = new BacklinkGrowthMapRepository(exec);
  const rows = await repository.listLatestAuthoritySnapshots(projectScope);
  const copy = backlinkProjectionCopy(scope.uiLocale);
  const sources = rows.map((row) => sourceProjection(row, copy));
  const primary = preferredAuthority(
    sources.filter((source) => source.subjectKind === "primary_site"),
  );
  const approvedCompetitors = preferredCompetitorAuthorities(
    sources,
    primary,
  );

  if (primary === null || primary.coverage.availability === "unavailable") {
    const limitation =
      primary?.coverage.limitations[0] ?? copy.noAuthority;
    return GrowthMapBacklinkReadModelSchema.parse({
      projectId,
      generatedAt,
      coverage: {
        availability: "unavailable",
        indexScope: "unavailable",
        limitations: [limitation],
      },
      sources,
      primarySite: null,
      approvedCompetitors,
      comparison: {
        state: "unavailable",
        provider: null,
        primarySiteSnapshotId: null,
        competitorSnapshotIds: [],
        limitation,
      },
      pages: [],
      referringDomains: [],
      opportunities: [],
    });
  }

  const [pageRows, facts] = await Promise.all([
    repository.listPageMetrics(projectScope, primary.snapshotId),
    repository.listFacts(projectScope, [primary.snapshotId]),
  ]);
  const expectedPageSemantics =
    primary.sourceKind === "provider_import"
      ? "provider_index_total"
      : "observed_fact_count";
  const pages = pageRows.map((row) => {
    if (row.metric_semantics !== expectedPageSemantics) {
      return corruptBacklinks();
    }
    return {
      sitePageId: row.site_page_id,
      canonicalUrl: row.normalized_url,
      title: row.title,
      backlinks: {
        semantics: row.metric_semantics,
        value: row.backlink_count,
      },
      referringDomains: {
        semantics: row.metric_semantics,
        value: row.referring_domain_count,
      },
      snapshotId: row.snapshot_id,
    };
  });
  const referringDomains = referringDomainProjection(facts, primary);
  const comparable = comparableCompetitors(
    primary,
    approvedCompetitors,
  );
  const comparison =
    comparable.length === 0
      ? {
          state: "insufficient" as const,
          provider: null,
          primarySiteSnapshotId: null,
          competitorSnapshotIds: [],
          limitation: copy.noComparableCompetitor,
        }
      : {
          state: "comparable" as const,
          provider: primary.provider as
            | "ahrefs"
            | "moz"
            | "dataforseo",
          primarySiteSnapshotId: primary.snapshotId,
          competitorSnapshotIds: comparable
            .map((source) => source.snapshotId)
            .sort(),
          limitation: null,
        };

  const opportunities: BacklinkOpportunity[] = pages
    .filter(
      (page) =>
        page.backlinks.semantics === "provider_index_total" &&
        page.backlinks.value === 0 &&
        page.referringDomains.value === 0,
    )
    .slice(0, 20)
    .map((page) => ({
      opportunityKey: `backlink:page:${page.sitePageId}:${primary.snapshotId}`,
      kind: "page_without_provider_backlinks",
      severity: "medium",
      title: copy.pageGapTitle,
      summary: copy.pageGapSummary(providerLabel(primary.provider)),
      sitePageId: page.sitePageId,
      evidenceSnapshotIds: [primary.snapshotId],
      executionRef: null,
    }));
  const gap = siteGapOpportunity(primary, comparable, copy);
  if (gap !== null) opportunities.unshift(gap);

  return GrowthMapBacklinkReadModelSchema.parse({
    projectId,
    generatedAt,
    coverage: primary.coverage,
    sources,
    primarySite: primary,
    approvedCompetitors,
    comparison,
    pages,
    referringDomains,
    opportunities,
  });
}

/**
 * Customer-facing Backlink growth path embedded in Growth Map. Every numeric
 * claim comes from an immutable source snapshot; CSV/search discoveries remain
 * observed subsets and can never become provider totals or authority scores.
 */
export async function getProjectAuditBacklinks(
  scope: BacklinkWorkspaceScope,
  projectId: string,
  exec?: Executor,
  now: Date = new Date(),
): Promise<GrowthMapBacklinkReadModel> {
  const generatedAt = exactNow(now);
  try {
    if (exec) {
      return await readBacklinksInSnapshot(
        exec,
        scope,
        projectId,
        generatedAt,
      );
    }
    return await getDb().db.transaction(
      (tx) =>
        readBacklinksInSnapshot(
          tx,
          scope,
          projectId,
          generatedAt,
        ),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  } catch (error) {
    if (
      error instanceof BacklinkAuthorityIntegrityError ||
      error instanceof RangeError
    ) {
      return corruptBacklinks();
    }
    throw error;
  }
}
