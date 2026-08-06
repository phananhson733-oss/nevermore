import {
  ExecutionPreview as ExecutionPreviewSchema,
  type ExecutionPreview,
} from "@sf/contracts";
import {
  ACTION_TEMPLATES,
  resolveActionCopy,
  type RuleId,
} from "@sf/engine";

/**
 * Adapt one static ActionTemplate into presentational current-view copy.
 * This pure adapter performs no persistence, Action creation, ID allocation,
 * model invocation, or workflow transition.
 */
export function buildExecutionPreview(
  ruleId: string,
  deliveryLocale: string,
): ExecutionPreview | null {
  if (!Object.hasOwn(ACTION_TEMPLATES, ruleId)) return null;

  const template = ACTION_TEMPLATES[ruleId as RuleId];
  const { copy, contentLocale } = resolveActionCopy(
    template,
    deliveryLocale,
  );
  return ExecutionPreviewSchema.parse({
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    artifactType: template.artifactType,
    effort: template.effort,
    risk: template.risk,
    contentLocale,
    ...copy,
  });
}
