import {
  GrowthMapTopicModelInsights as GrowthMapTopicModelInsightsSchema,
  type GrowthMapTopicModelInsights,
  type GrowthMapTopicNodeInsight,
} from "@sf/contracts";
import {
  TopicModelInsightsConflictError,
  TopicModelInsightsIntegrityError,
  TopicModelInsightsRepository,
  type Executor,
  type TopicModelInsightsAuthority,
  type TopicNodeInsightFacts,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

const NO_CONFIRMED_MODEL =
  "当前项目尚无已确认的 Topic Model，因此无法生成关键词与内容覆盖分析。";

function insightsUnavailable(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "The Topic Model insight authority failed its integrity checks.",
  );
}

function projectNotFound(): never {
  throw new ProblemError("NOT_FOUND", "Project not found.");
}

function generatedAt(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return insightsUnavailable();
  }
  return now.toISOString();
}

function coverageForNode(
  facts: TopicNodeInsightFacts,
): Pick<GrowthMapTopicNodeInsight, "coverageState" | "limitation"> {
  if (facts.conflictingIntentCount > 0) {
    return {
      coverageState: "conflict",
      limitation: `检测到 ${facts.conflictingIntentCount} 个已确认 intent 分别映射到多个现有页面，存在 SEO cannibalization 风险。`,
    };
  }
  if (facts.keywordCount === 0) {
    return {
      coverageState: "empty",
      limitation: "该 Topic 暂无已纳入统计的非排除关键词。",
    };
  }
  if (facts.existingPageKeywordCount === 0) {
    return {
      coverageState: "uncovered",
      limitation: `该 Topic 已有 ${facts.keywordCount} 个关键词，但尚无关键词映射到现有页面。`,
    };
  }
  const withoutExistingPage =
    facts.keywordCount - facts.existingPageKeywordCount;
  if (
    facts.reviewPendingKeywordCount > 0 ||
    withoutExistingPage > 0
  ) {
    const reasons: string[] = [];
    if (facts.reviewPendingKeywordCount > 0) {
      reasons.push(
        `${facts.reviewPendingKeywordCount} 个关键词仍待审核`,
      );
    }
    if (withoutExistingPage > 0) {
      reasons.push(`${withoutExistingPage} 个关键词尚未覆盖现有页面`);
    }
    return {
      coverageState: "partial",
      limitation: `该 Topic 的内容覆盖不完整：${reasons.join("，")}。`,
    };
  }
  return { coverageState: "covered", limitation: null };
}

function projectConfirmed(
  authority: Extract<TopicModelInsightsAuthority, { state: "confirmed" }>,
  now: string,
): GrowthMapTopicModelInsights {
  const limitations: string[] = [];
  if (authority.unassignedTopicKeywordCount > 0) {
    limitations.push(
      `${authority.unassignedTopicKeywordCount} 个非排除关键词尚未分配到已确认的 Topic，因此未计入节点统计。`,
    );
  }
  if (authority.orphanAssignmentCount > 0) {
    limitations.push(
      `${authority.orphanAssignmentCount} 个关键词引用了已失效、缺失或未来版本的 Topic assignment，因此未计入节点统计。`,
    );
  }
  if (authority.invalidatedAssignmentCount > 0) {
    limitations.push(
      `${authority.invalidatedAssignmentCount} 个 Topic assignment 已因拆分、合并或删除而失效，需要重新审核。`,
    );
  }
  const parsed = GrowthMapTopicModelInsightsSchema.safeParse({
    projectId: authority.projectId,
    topicModelRevision: authority.topicModelRevision,
    nodes: authority.nodes.map((node) => ({
      projectId: authority.projectId,
      ...node,
      ...coverageForNode(node),
    })),
    coverage: {
      availability: limitations.length > 0 ? "partial" : "available",
      limitations,
    },
    generatedAt: now,
  });
  if (!parsed.success) return insightsUnavailable();
  return parsed.data;
}

function projectNoModel(
  authority: Extract<
    TopicModelInsightsAuthority,
    { state: "no_confirmed_model" }
  >,
  now: string,
): GrowthMapTopicModelInsights {
  const parsed = GrowthMapTopicModelInsightsSchema.safeParse({
    projectId: authority.projectId,
    topicModelRevision: null,
    nodes: [],
    coverage: {
      availability: "unavailable",
      limitations: [NO_CONFIRMED_MODEL],
    },
    generatedAt: now,
  });
  if (!parsed.success) return insightsUnavailable();
  return parsed.data;
}

async function insightsInSnapshot(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  now: string,
): Promise<GrowthMapTopicModelInsights> {
  try {
    const authority =
      await new TopicModelInsightsRepository(exec).readLatestConfirmed({
        workspaceId: scope.workspaceId,
        projectId,
      });
    return authority.state === "confirmed"
      ? projectConfirmed(authority, now)
      : projectNoModel(authority, now);
  } catch (error) {
    if (error instanceof TopicModelInsightsConflictError) {
      return projectNotFound();
    }
    if (error instanceof TopicModelInsightsIntegrityError) {
      return insightsUnavailable();
    }
    throw error;
  }
}

/**
 * Customer-visible Topic coverage uses only the latest confirmed Topic Model.
 * An editable draft never changes these counts before explicit confirmation.
 */
export async function getProjectAuditTopicModelInsights(
  scope: WorkspaceScope,
  projectId: string,
  exec?: Executor,
  now: Date = new Date(),
): Promise<GrowthMapTopicModelInsights> {
  const timestamp = generatedAt(now);
  if (exec) {
    return insightsInSnapshot(exec, scope, projectId, timestamp);
  }
  return getDb().db.transaction(
    (tx) => insightsInSnapshot(tx, scope, projectId, timestamp),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
