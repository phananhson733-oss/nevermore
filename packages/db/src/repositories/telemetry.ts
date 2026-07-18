import { redact } from "@sf/observability";
import { telemetryEvents } from "../schema.ts";
import { Repository } from "./base.ts";

/**
 * Append-only product telemetry (spec §15.1). Exactly five event names are
 * allowed; `project_id` is nullable (workspace-level events). Properties use a
 * small allowlist and must never carry client content, URLs, query text, or
 * model prompt/output (spec §14.4).
 *
 * Properties are deep-redacted before insert (spec §14.3/§15.2) as a runtime
 * backstop: even if a caller passes a secret-named field, no OAuth token, API
 * key, cookie, or credential value can reach the telemetry table (AC-040).
 */

export type TelemetryEventName =
  | "project_created"
  | "source_snapshot_ready"
  | "diagnostic_completed"
  | "action_confirmed"
  | "export_ready";

export class TelemetryRepository extends Repository {
  /** Emit one telemetry event (inside the owning transaction). */
  async emit(values: {
    workspaceId: string;
    projectId: string | null;
    eventName: TelemetryEventName;
    actorId: string | null;
    properties: Record<string, unknown>;
  }): Promise<void> {
    await this.exec.insert(telemetryEvents).values({
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      event_name: values.eventName,
      actor_id: values.actorId,
      properties: redact(values.properties) as Record<string, unknown>,
    });
  }
}
