// @input  -- category shard files (metrics, strategy, technical, methodology)
// @output -- combined MOCK_GLOSSARY_TERMS array (50 terms x 2 locales = 100 rows)
// @pos    -- mock data aggregator for glossary data layer, mirrors blog-data.ts pattern
// once this file is updated, update header comments and _DIR.md in this folder

import type { GlossaryTerm } from "@/lib/glossary";
import { GLOSSARY_METRICS } from "./glossary-data-metrics";
import { GLOSSARY_STRATEGY } from "./glossary-data-strategy";
import { GLOSSARY_TECHNICAL } from "./glossary-data-technical";
import { GLOSSARY_METHODOLOGY } from "./glossary-data-methodology";

export const MOCK_GLOSSARY_TERMS: GlossaryTerm[] = [
  ...GLOSSARY_METRICS,
  ...GLOSSARY_STRATEGY,
  ...GLOSSARY_TECHNICAL,
  ...GLOSSARY_METHODOLOGY,
];
