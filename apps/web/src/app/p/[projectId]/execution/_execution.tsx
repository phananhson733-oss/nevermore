"use client";

/**
 * Execution single-chain view (Slice 1, Task 7). A minimal read-only projection
 * of the canonical delivery chain: each confirmed opportunity yields one
 * Finding-owned Action and one template-fixed Artifact. It reuses the existing
 * Studio query hooks (server-state stays owned by TanStack Query, spec §3.2) and
 * renders the full Studio client below the summary for the actual editing work.
 * This is the minimal usable surface; the complete execution center is Task 6/9.
 */

import { useTranslations } from "next-intl";
import {
  Badge,
  EmptyState,
  Panel,
  StatusPill,
  type StatusTone,
} from "@/components/ui";
import { uniqueCursorItems } from "@/lib/api/cursor-pages";
import {
  expectedArtifactType,
  useProjectActions,
  useProjectArtifacts,
  type Artifact,
  type ArtifactAction,
  type ArtifactType,
} from "@/lib/api/hooks-studio";
import { StudioClient } from "../studio/_studio.tsx";
import type { ExecutionDeepLink } from "./_execution-deep-link.ts";

interface ExecutionChain {
  readonly action: ArtifactAction;
  readonly fixedArtifactType: ArtifactType | null;
  readonly artifact: Artifact | null;
}

/** Map each confirmed Action to its live template-fixed Artifact (read-only join). */
function buildClientChains(
  actions: readonly ArtifactAction[],
  artifacts: readonly Artifact[],
): readonly ExecutionChain[] {
  return actions
    .filter((action) => action.status !== "dismissed")
    .map((action) => {
      const fixedArtifactType = expectedArtifactType(action);
      const artifact =
        artifacts.find(
          (candidate) =>
            candidate.actionId === action.id &&
            candidate.artifactType === fixedArtifactType &&
            candidate.status !== "archived",
        ) ?? null;
      return { action, fixedArtifactType, artifact };
    });
}

const ARTIFACT_TONE: Readonly<Record<Artifact["status"], StatusTone>> = {
  generating: "warning",
  draft: "info",
  ready: "success",
  failed: "danger",
  archived: "neutral",
};

const ACTION_TONE: Readonly<Record<ArtifactAction["status"], StatusTone>> = {
  candidate: "neutral",
  planned: "neutral",
  in_progress: "info",
  blocked: "danger",
  done: "success",
  dismissed: "neutral",
};

function ExecutionChainRow({ chain }: { readonly chain: ExecutionChain }) {
  const t = useTranslations("execution");
  const { action, fixedArtifactType, artifact } = chain;
  const typeLabel = fixedArtifactType
    ? t(`artifactType.${fixedArtifactType}`)
    : t("deliverableLabel");
  return (
    <li className="sf-execution-chain">
      <div className="sf-execution-chain__head">
        <span className="sf-execution-chain__title">{action.title}</span>
        <StatusPill tone={ACTION_TONE[action.status]}>
          {t("actionLabel")} · {action.status}
        </StatusPill>
      </div>
      <div className="sf-execution-chain__delivery">
        <Badge>{typeLabel}</Badge>
        {artifact ? (
          <StatusPill tone={ARTIFACT_TONE[artifact.status]}>
            {artifact.status} ·{" "}
            {t("revisionLabel", { revision: artifact.currentRevision })}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral">{t("artifactPending")}</StatusPill>
        )}
      </div>
    </li>
  );
}

/** Read-only single-chain summary above the reused Studio delivery client. */
export function ExecutionClient({
  projectId,
  initialDeepLink,
}: {
  readonly projectId: string;
  readonly initialDeepLink: ExecutionDeepLink;
}) {
  const t = useTranslations("execution");
  const artifactsQuery = useProjectArtifacts(projectId);
  const actionsQuery = useProjectActions(projectId);
  const artifacts = uniqueCursorItems(artifactsQuery.data);
  const actions = uniqueCursorItems(actionsQuery.data);
  const chains = buildClientChains(actions, artifacts);

  return (
    <div className="sf-execution">
      <Panel aria-label={t("chainTitle")} className="sf-execution__summary">
        <h2 className="sf-execution__heading">{t("chainTitle")}</h2>
        <p className="sf-execution__lead">{t("chainLead")}</p>
        {chains.length === 0 ? (
          <EmptyState title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <ul className="sf-execution__chains">
            {chains.map((chain) => (
              <ExecutionChainRow key={chain.action.id} chain={chain} />
            ))}
          </ul>
        )}
      </Panel>
      <StudioClient projectId={projectId} initialDeepLink={initialDeepLink} />
    </div>
  );
}
