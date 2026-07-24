/**
 * Deterministic artifact template dispatch (spec §10.1). Given the allowlisted
 * prompt input, builds the canonical `ArtifactContent` for its artifactType,
 * using `ARTIFACT_FORMAT` for the content format. Pure and reproducible: no
 * clock, no randomness.
 */

import type { ArtifactContent, ArtifactPromptInput } from "../types.ts";
import { ARTIFACT_FORMAT } from "../types.ts";
import { build as buildContentBrief } from "./content-brief.ts";
import { build as buildMetadataRewrite } from "./metadata-rewrite.ts";
import { build as buildTechnicalTicket } from "./technical-ticket.ts";
import { assertTemplateArtifactLocale } from "./util.ts";

export { buildContentBrief, buildMetadataRewrite, buildTechnicalTicket };
export {
  assertTemplateArtifactLocale,
  normalizeTemplateArtifactLocale,
  UNSUPPORTED_TEMPLATE_LOCALE_MESSAGE,
  UnsupportedTemplateLocaleError,
} from "./util.ts";
export type { TemplateArtifactLocale } from "./util.ts";

export function buildTemplateArtifact(
  input: ArtifactPromptInput,
): ArtifactContent {
  assertTemplateArtifactLocale(input.outputLocale);
  const contentFormat = ARTIFACT_FORMAT[input.artifactType];
  switch (input.artifactType) {
    case "content_brief":
      return { contentFormat, content: buildContentBrief(input) };
    case "technical_ticket":
      return { contentFormat, content: buildTechnicalTicket(input) };
    case "metadata_rewrite":
      return { contentFormat, content: buildMetadataRewrite(input) };
    case "english_blog_draft":
      // english_blog_draft has no deterministic template: it is minted by the
      // Content Shadow worker via the markdown LLM envelope, never here.
      throw new Error(
        "english_blog_draft is not produced by deterministic template dispatch",
      );
    default: {
      const _never: never = input.artifactType;
      throw new Error(`unsupported artifactType: ${String(_never)}`);
    }
  }
}
