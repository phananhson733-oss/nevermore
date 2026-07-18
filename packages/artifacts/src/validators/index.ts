/**
 * Artifact validation dispatch (spec §10.1). Markdown artifacts are checked by a
 * heading/section validator; metadata_rewrite by a Zod schema. A failed result
 * means the revision may be saved as draft but MUST NOT be set ready (§10.1).
 */

import type { ArtifactContent, ArtifactType, ArtifactValidationResult } from "../types.ts";
import { ARTIFACT_FORMAT } from "../types.ts";
import { validateMarkdownSections, type RequiredSection } from "./markdown.ts";
import { validateMetadata } from "./metadata.ts";
import {
  CONTENT_BRIEF_SECTIONS,
  TECHNICAL_TICKET_CORE_SECTIONS,
  TECHNICAL_TICKET_VALIDATION_SECTIONS,
  toRequiredSection,
} from "./sections.ts";

export interface ValidateArtifactOptions {
  /**
   * When true (spec §9.3 step 8: high-risk technical change), the technical_ticket
   * MUST contain non-empty `## Validation` and `## Rollback` sections.
   */
  readonly requiresValidationRollback?: boolean;
}

export { validateMarkdownSections, validateMetadata };
export type { RequiredSection };

function validateMarkdownBody(
  content: ArtifactContent,
  required: readonly RequiredSection[],
): readonly string[] {
  if (typeof content.content !== "string") {
    return ["markdown artifact content must be a string"];
  }
  return validateMarkdownSections(content.content, required);
}

export function validateArtifact(
  type: ArtifactType,
  content: ArtifactContent,
  opts?: ValidateArtifactOptions,
): ArtifactValidationResult {
  const errors: string[] = [];

  const expectedFormat = ARTIFACT_FORMAT[type];
  if (content.contentFormat !== expectedFormat) {
    errors.push(
      `contentFormat must be "${expectedFormat}" for ${type}, got "${content.contentFormat}"`,
    );
  }

  switch (type) {
    case "content_brief":
      errors.push(...validateMarkdownBody(content, CONTENT_BRIEF_SECTIONS.map(toRequiredSection)));
      break;
    case "technical_ticket": {
      const required = [
        ...TECHNICAL_TICKET_CORE_SECTIONS,
        ...(opts?.requiresValidationRollback === true ? TECHNICAL_TICKET_VALIDATION_SECTIONS : []),
      ].map(toRequiredSection);
      errors.push(...validateMarkdownBody(content, required));
      break;
    }
    case "metadata_rewrite":
      errors.push(...validateMetadata(content.content));
      break;
    default: {
      const _never: never = type;
      errors.push(`unsupported artifactType: ${String(_never)}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
