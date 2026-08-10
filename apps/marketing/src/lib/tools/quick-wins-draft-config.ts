// @input  -- the deployment's environment
// @output -- whether this deployment can produce Title/Meta drafts, and against what
// @pos    -- the single answer to "are drafts on", read by both the API and the page
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Chat completions endpoint. Overridable so a test never reaches the network. */
const DEFAULT_MODEL_URL = "https://api.openai.com/v1/chat/completions";

/**
 * How the endpoint expects the credential.
 *
 * OpenAI and OpenAI-compatible gateways take `Authorization: Bearer`. Azure
 * OpenAI documents an `api-key` header, and measurement against the product's
 * own `gpt-5.6-luna` resource shows it accepts the bearer form for a resource
 * key too — so this switch is not the difference between working and 401. It
 * stays because sending the credential in a header the endpoint has no reason
 * to read is worse than sending it in the one it documents.
 * `packages/artifacts/src/llm/openai-client.ts` carries the same switch for
 * the product's own Azure calls; this mirrors it rather than inventing a
 * second convention.
 */
export type DraftAuthScheme = "bearer" | "api-key";

export interface DraftModelConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly url: string;
  readonly authScheme: DraftAuthScheme;
  /**
   * Sampling temperature, or null to send none.
   *
   * Null by default, and null is not "use 0.4" — it means the field is left
   * out of the request entirely. Reasoning models accept exactly one value:
   * the product's Azure `gpt-5.6-luna` deployment answers a request carrying
   * `temperature: 0.4` with 400 `unsupported_value`, refusing the whole call
   * rather than nudging it. A default that turns drafts off on the models
   * this is most likely pointed at is not a safe default.
   */
  readonly temperature: number | null;
  /**
   * Whether to ask the endpoint for a JSON object.
   *
   * On by default: without it a chatty model wraps the draft in a sentence,
   * and the reply gets reported as a format nobody can use. Off for the
   * gateways that answer 400 for the field itself — `quick-wins-drafts.ts`
   * also drops it and retries once, so a deployment that never sets this
   * degrades to one wasted call per draft rather than to no drafts.
   */
  readonly jsonMode: boolean;
}

function readTemperature(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  // An unparseable or out-of-range value is dropped rather than sent. A model
  // that refuses the temperature refuses the whole request, and a typo in a
  // dashboard should not silently disable drafts.
  if (!Number.isFinite(value) || value < 0 || value > 2) return null;
  return value;
}

function readAuthScheme(raw: string | undefined): DraftAuthScheme {
  return raw?.trim().toLowerCase() === "api-key" ? "api-key" : "bearer";
}

/** Off only for the values that unambiguously mean off. */
function readJsonMode(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
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
    jsonMode: readJsonMode(env["QUICK_WINS_DRAFT_JSON_MODE"]),
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
