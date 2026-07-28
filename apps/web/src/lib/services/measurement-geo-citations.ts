import type { GeoCitationEvidenceResponse } from "@sf/contracts";
import {
  GeoCitationAuthorityError,
  GeoCitationAuthorityRepository,
  type Executor,
  type ProjectScope,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";

function notFound(): never {
  throw new ProblemError(
    "NOT_FOUND",
    "Measurement GEO citation evidence not found.",
  );
}

function corruptEvidence(): never {
  throw new ProblemError(
    "DEPENDENCY_UNAVAILABLE",
    "Measurement GEO citation evidence failed its authority checks.",
  );
}

async function readEvidence(
  exec: Executor,
  scope: WorkspaceScope,
  projectId: string,
  measurementWindowId: string,
): Promise<GeoCitationEvidenceResponse> {
  const projectScope: ProjectScope = {
    workspaceId: scope.workspaceId,
    projectId,
  };
  try {
    const evidence =
      await new GeoCitationAuthorityRepository(
        exec,
      ).evidenceForMeasurementWindow(
        projectScope,
        measurementWindowId,
      );
    if (evidence === null) return notFound();
    return evidence;
  } catch (error) {
    if (error instanceof GeoCitationAuthorityError) {
      return corruptEvidence();
    }
    throw error;
  }
}

/**
 * Reverse lookup for the GEO observations frozen into one Measurement Window.
 * Dates, target URL, source lineage, and query cohort are server-owned.
 */
export async function getProjectMeasurementGeoCitations(
  scope: WorkspaceScope,
  projectId: string,
  measurementWindowId: string,
  exec?: Executor,
): Promise<GeoCitationEvidenceResponse> {
  if (exec) {
    return readEvidence(
      exec,
      scope,
      projectId,
      measurementWindowId,
    );
  }
  return getDb().db.transaction(
    (tx) =>
      readEvidence(
        tx,
        scope,
        projectId,
        measurementWindowId,
      ),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
