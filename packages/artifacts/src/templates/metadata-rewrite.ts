/**
 * Deterministic metadata_rewrite template (spec §10.1). Produces the metadata
 * JSON object. Proposed title/description are placeholder rewrites derived from
 * the finding/action; targetQueries come from evidence subject refs; evidenceRefs
 * are the evidence ids. Current values come only from the frozen crawl metadata
 * already loaded into the allowlisted input; unknowns remain `null` (§1.3).
 */

import type { ArtifactPromptInput } from "../types.ts";
import { clean, deriveTargetQueries, firstNonEmpty, isZh, pick, truncate } from "./util.ts";

const TITLE_MAX = 65;
const DESCRIPTION_MAX = 155;

export function build(input: ArtifactPromptInput): Record<string, unknown> {
  const { icp, action, finding, currentMetadata, evidence } = input;
  const zh = isZh(input.outputLocale);

  const queries = deriveTargetQueries(input);
  const primaryQuery = queries[0];

  const titleCore = firstNonEmpty(
    [action.title, finding.summary, icp.productName],
    pick(zh, "元数据重写", "Metadata rewrite"),
  );
  const titleSuffix = primaryQuery ?? clean(icp.productName);
  const proposedTitle = truncate(
    titleSuffix ? `${titleCore} | ${titleSuffix}` : titleCore,
    TITLE_MAX,
  );

  const descriptionCore = firstNonEmpty(
    [finding.summary, action.description],
    pick(zh, "草拟描述", "Draft description"),
  );
  const proposedDescription = truncate(
    `${descriptionCore} ${clean(action.expectedOutcome)}`.trim(),
    DESCRIPTION_MAX,
  );

  const rationale = pick(
    zh,
    `依据 Finding「${clean(finding.summary)}」与行动「${clean(action.title)}」重写元数据；目标查询：${queries.join("、") || "待确认"}。`,
    `Rewrite metadata to address the finding "${clean(finding.summary)}" via the action "${clean(action.title)}". Target queries: ${queries.join(", ") || "to be added"}.`,
  );

  return {
    url: currentMetadata.url,
    currentTitle: currentMetadata.currentTitle,
    proposedTitle,
    currentDescription: currentMetadata.currentDescription,
    proposedDescription,
    targetQueries: queries,
    rationale,
    evidenceRefs: evidence.map((e) => clean(e.evidenceId)).filter((id) => id.length > 0),
  };
}
