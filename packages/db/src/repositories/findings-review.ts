import { findingReviewEvents } from "../schema.ts";
import { Repository } from "./base.ts";

/**
 * `finding_review_events` is the append-only audit trail for finding review state
 * changes (spec §5.2, §9.1). Every transition appends one row with the from/to
 * state, the new revision, the actor, and an optional reason/note.
 */

export class FindingReviewEventsRepository extends Repository {
  async append(values: {
    workspaceId: string;
    projectId: string;
    findingId: string;
    fromState: string;
    toState: string;
    revision: number;
    reason: string | null;
    note: string | null;
    actorId: string;
  }): Promise<void> {
    await this.exec.insert(findingReviewEvents).values({
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      finding_id: values.findingId,
      from_state: values.fromState,
      to_state: values.toState,
      revision: values.revision,
      reason: values.reason,
      note: values.note,
      actor_id: values.actorId,
    });
  }
}
