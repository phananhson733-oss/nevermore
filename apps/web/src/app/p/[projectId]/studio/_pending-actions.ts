import {
  expectedArtifactType,
  type Artifact,
  type ArtifactAction,
} from "@/lib/api/hooks-studio";

/**
 * Confirmed plan Actions are real Studio work even before an Artifact row has
 * been generated. Keep them in the queue until a live Artifact of the exact
 * template-derived type exists; archived rows deliberately do not hide them.
 */
export function actionsAwaitingArtifacts(
  actions: readonly ArtifactAction[],
  artifacts: readonly Artifact[],
): readonly ArtifactAction[] {
  const liveKeys = new Set(
    artifacts
      .filter((artifact) => artifact.status !== "archived")
      .map(
        (artifact) => `${artifact.actionId}:${artifact.artifactType}` as const,
      ),
  );

  return actions.filter((action) => {
    if (action.status === "dismissed") return false;
    const artifactType = expectedArtifactType(action);
    return (
      artifactType !== null && !liveKeys.has(`${action.id}:${artifactType}`)
    );
  });
}
