// @input  -- the deployment's environment
// @output -- whether this deployment can produce Title/Meta drafts, and with what
// @pos    -- the single answer to "are drafts on", read by both the API and the page
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Chat completions endpoint. Overridable so a test never reaches the network. */
const DEFAULT_MODEL_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Whether this deployment can produce drafts at all.
 *
 * Absent configuration is a supported state, not an error: the evidence table
 * is the product and it does not depend on a model. `runQuickWins` simply
 * receives no seams and skips the two extra Search Console reads entirely.
 */
export interface DraftModelConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly url: string;
}

export function draftModelFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DraftModelConfig | null {
  const apiKey = env["QUICK_WINS_DRAFT_API_KEY"];
  const model = env["QUICK_WINS_DRAFT_MODEL"];
  if (!apiKey || !model) return null;
  return { apiKey, model, url: env["QUICK_WINS_DRAFT_URL"] ?? DEFAULT_MODEL_URL };
}

/**
 * Whether the landing page is allowed to advertise drafts.
 *
 * Lives here, next to the switch the API reads, rather than being re-derived
 * from the environment on the page. Drafts were configured on one side and
 * described on the other once already: the page shipped a how-to step, a
 * feature heading and an FAQ entry about drafts to a deployment that had no
 * model key, which is a promise no visitor could ever have collected on.
 *
 * This module has no imports on purpose. The API's draft path pulls in the
 * crawler; a page that only needs a yes or no must not.
 */
export function draftsEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return draftModelFromEnv(env) !== null;
}
