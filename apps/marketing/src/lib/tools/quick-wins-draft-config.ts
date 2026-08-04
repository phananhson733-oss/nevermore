// @input  -- the deployment's environment
// @output -- whether this deployment can produce Title/Meta drafts, and against what
// @pos    -- the single answer to "are drafts on", read by both the API and the page
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Chat completions endpoint. Overridable so a test never reaches the network. */
const DEFAULT_MODEL_URL = "https://api.openai.com/v1/chat/completions";

/** Low, because a wording candidate should not wander. */
const DEFAULT_TEMPERATURE = 0.4;

/**
 * How the endpoint expects the credential.
 *
 * OpenAI and OpenAI-compatible gateways take `Authorization: Bearer`. Azure
 * OpenAI takes an `api-key` header and rejects the bearer form, so pointing
 * `QUICK_WINS_DRAFT_URL` at an Azure deployment is not enough on its own —
 * every request comes back 401. `packages/artifacts/src/llm/openai-client.ts`
 * carries the same switch for the product's own Azure calls; this mirrors it
 * rather than inventing a second convention.
 */
export type DraftAuthScheme = "bearer" | "api-key";

export interface DraftModelConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly url: string;
  readonly authScheme: DraftAuthScheme;
  /**
   * Sampling temperature.
   *
   * Configurable because some models accept exactly one value. The product's
   * Azure `gpt-5.6-luna` deployment runs at 1 for that reason, and a request
   * carrying anything else is refused outright rather than nudged.
   */
  readonly temperature: number;
}

function readTemperature(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TEMPERATURE;
  const value = Number(raw);
  // An unparseable or out-of-range value falls back rather than being sent.
  // A model that refuses the temperature refuses the whole request, and a
  // typo in a dashboard should not silently disable drafts.
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    return DEFAULT_TEMPERATURE;
  }
  return value;
}

function readAuthScheme(raw: string | undefined): DraftAuthScheme {
  return raw?.trim().toLowerCase() === "api-key" ? "api-key" : "bearer";
}

/**
 * Whether this deployment can produce drafts at all.
 *
 * Absent configuration is a supported state, not an error: the evidence table
 * is the product and it does not depend on a model. `runQuickWins` simply
 * receives no seams and skips the two extra Search Console reads entirely.
 */
export function draftModelFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DraftModelConfig | null {
  const apiKey = env["QUICK_WINS_DRAFT_API_KEY"];
  const model = env["QUICK_WINS_DRAFT_MODEL"];
  if (!apiKey || !model) return null;
  return {
    apiKey,
    model,
    url: env["QUICK_WINS_DRAFT_URL"] ?? DEFAULT_MODEL_URL,
    authScheme: readAuthScheme(env["QUICK_WINS_DRAFT_AUTH_SCHEME"]),
    temperature: readTemperature(env["QUICK_WINS_DRAFT_TEMPERATURE"]),
  };
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
