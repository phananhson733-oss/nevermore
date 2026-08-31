// @input -- an explicit engine selection, never a caller-supplied endpoint/model
// @output -- fixed paid-provider configurations and deterministic engine ordering
// @pos -- browser/server shared allowlist before any quota or provider spending
import { VISIBILITY_ENGINES, type VisibilityEngine, type VisibilityEngineConfig } from "./visibility-v2-contract.ts";
export const VISIBILITY_ENGINE_CONFIG: Readonly<Record<VisibilityEngine, VisibilityEngineConfig>> = {
  chatgpt: { engine: "chatgpt", modelRequested: "gpt-5-2025-08-07", surface: "dataforseo_chat_gpt_llm_responses_api", wordingCalibration: "chatgpt_registry" },
  perplexity: { engine: "perplexity", modelRequested: "sonar", surface: "dataforseo_perplexity_llm_responses_api", wordingCalibration: "unmeasured" },
};
export function parseVisibilityEngines(value: unknown): readonly VisibilityEngine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > VISIBILITY_ENGINES.length || new Set(value).size !== value.length || value.some((engine) => !VISIBILITY_ENGINES.includes(engine))) return null;
  return VISIBILITY_ENGINES.filter((engine) => value.includes(engine));
}
