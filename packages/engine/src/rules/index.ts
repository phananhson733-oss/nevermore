import type { DiagnosticRule } from "../rule.ts";
import { techHttpStatusRule } from "./tech-http-status.ts";
import { techCanonicalRule } from "./tech-canonical.ts";
import { techLinkgraphRule } from "./tech-linkgraph.ts";
import { searchCtrRule } from "./search-ctr.ts";
import { searchDecayRule } from "./search-decay.ts";
import { contentCoverageRule } from "./content-coverage.ts";
import { contentGapRule } from "./content-gap.ts";
import { croPathRule } from "./cro-path.ts";
import { croLandingRule } from "./cro-landing.ts";
import { geoEntityRule } from "./geo-entity.ts";
import { geoCrawlerRule } from "./geo-crawler.ts";

/**
 * The frozen 11-rule registry in fixed pipeline order (spec §8.4). Deterministic
 * rules only; the pipeline runs them in this exact order.
 */
export const ALL_RULES: readonly DiagnosticRule[] = [
  techHttpStatusRule,
  techCanonicalRule,
  techLinkgraphRule,
  searchCtrRule,
  searchDecayRule,
  contentCoverageRule,
  contentGapRule,
  croPathRule,
  croLandingRule,
  geoEntityRule,
  geoCrawlerRule,
];

export {
  techHttpStatusRule,
  techCanonicalRule,
  techLinkgraphRule,
  searchCtrRule,
  searchDecayRule,
  contentCoverageRule,
  contentGapRule,
  croPathRule,
  croLandingRule,
  geoEntityRule,
  geoCrawlerRule,
};
