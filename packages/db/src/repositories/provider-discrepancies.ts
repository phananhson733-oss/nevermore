import { providerDiscrepancies } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `provider_discrepancies` records conflicting observations for the same
 * metric/subject/provider/window. Conflicts are NOT averaged (spec §7.6); the
 * pair is recorded and the diagnostic engine lowers confidence when a finding's
 * evidence overlaps a discrepancy.
 */

export interface ProviderDiscrepancyRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly metric_key: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly left_observation_id: string;
  readonly right_observation_id: string;
  readonly resolution: string;
  readonly created_at: string;
}

export class ProviderDiscrepanciesRepository extends Repository {
  async insert(values: {
    workspaceId: string;
    projectId: string;
    metricKey: string;
    subjectType: string;
    subjectRef: string;
    leftObservationId: string;
    rightObservationId: string;
  }): Promise<ProviderDiscrepancyRow> {
    const [row] = await this.exec
      .insert(providerDiscrepancies)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        metric_key: values.metricKey,
        subject_type: values.subjectType,
        subject_ref: values.subjectRef,
        left_observation_id: values.leftObservationId,
        right_observation_id: values.rightObservationId,
      })
      .returning();
    return row as ProviderDiscrepancyRow;
  }

  async listByProject(scope: ProjectScope): Promise<ProviderDiscrepancyRow[]> {
    return (await this.exec
      .select()
      .from(providerDiscrepancies)
      .where(
        projectPredicate(providerDiscrepancies, scope),
      )) as ProviderDiscrepancyRow[];
  }
}
