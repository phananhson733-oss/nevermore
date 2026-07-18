import type { ArtifactRevisionRow, ArtifactRow, AsyncRunRow } from "@sf/db";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * Artifact row → DTO mappers (spec §10, §11). Shapes match the OpenAPI `Artifact`
 * and `ArtifactRevision` schemas. A revision's `content` is the markdown/csv text
 * or the metadata JSON object; only one of `content_text`/`content_json` is set.
 */

export interface ArtifactRevisionDto {
  id: string;
  revision: number;
  contentFormat: string;
  content: string | Record<string, unknown>;
  contentHash: string;
  validationErrors: string[];
  note: string | null;
  createdAt: string;
}

export function toArtifactRevisionDto(row: ArtifactRevisionRow): ArtifactRevisionDto {
  const content: string | Record<string, unknown> =
    row.content_text !== null
      ? row.content_text
      : (row.content_json as Record<string, unknown> | null) ?? {};
  return {
    id: row.id,
    revision: row.revision,
    contentFormat: row.content_format,
    content,
    contentHash: row.content_hash,
    validationErrors: (row.validation_errors as unknown[]).filter(
      (e): e is string => typeof e === "string",
    ),
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface ArtifactDto {
  id: string;
  actionId: string;
  artifactType: string;
  status: string;
  generationMode: string;
  outputLocale: string;
  currentRevision: number;
  validationState: string;
  current: ArtifactRevisionDto | null;
  activeRun: AsyncRunDto | null;
  createdAt: string;
  updatedAt: string;
}

export function toArtifactDto(
  row: ArtifactRow,
  current: ArtifactRevisionRow | null,
  activeRun: AsyncRunRow | null,
): ArtifactDto {
  return {
    id: row.id,
    actionId: row.action_id,
    artifactType: row.artifact_type,
    status: row.status,
    generationMode: row.generation_mode,
    outputLocale: row.output_locale,
    currentRevision: row.current_revision,
    validationState: row.validation_state,
    current: current ? toArtifactRevisionDto(current) : null,
    activeRun: activeRun ? toAsyncRunDto(activeRun) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
