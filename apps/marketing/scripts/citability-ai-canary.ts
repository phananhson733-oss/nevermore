// Manual, explicitly authorized live probe. Not imported by the application or
// regular test suite. One output file reserves one attempt before any paid POST.
import { open, readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSeoAuditUrl } from "@sf/public-tools";
import { fetchPublicResource } from "@sf/sources/public-http";
import { createCitabilityAiContext } from "../src/lib/geo-tools/citability-ai-evidence.ts";
import { buildCitabilityAiTask, CitabilityAiProviderError, isCitabilityAiProviderConfigured,
  resolveCitabilityAiModel, reviewCitabilityWithDataForSeo } from "../src/lib/geo-tools/citability-ai-provider.ts";
import { CITABILITY_MAX_BODY_BYTES } from "../src/lib/geo-tools/citability-contract.ts";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isCitabilityCanaryHtml(contentType: string | null, body: string): boolean {
  const mediaType = (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase();
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  return (mediaType === "text/html" || mediaType === "application/xhtml+xml")
    && (charset === undefined || ["utf-8", "utf8", "us-ascii", "ascii"].includes(charset))
    && (body.length === 0 || (body.match(/\ufffd/gu) ?? []).length / body.length <= 0.02);
}

export async function readCitabilityCanaryCredentials(path: string, currentEnv: Readonly<Record<string, string | undefined>> = process.env): Promise<Record<string, string | undefined>> {
  const source = path === "-" ? currentEnv : parseEnv(await readFile(path, "utf8"));
  return {
    DATAFORSEO_LOGIN: source.DATAFORSEO_LOGIN,
    DATAFORSEO_PASSWORD: source.DATAFORSEO_PASSWORD,
    CITABILITY_AI_MODEL_NAME: source.CITABILITY_AI_MODEL_NAME,
  };
}

async function main(): Promise<void> {
  const [consent, credentialsPath, inputUrl, question, outputPath, ...extra] = process.argv.slice(2);
  if (consent !== "--allow-one-paid-call" || !credentialsPath || !inputUrl || !question || !outputPath || extra.length) {
    console.info("Usage: pnpm exec tsx apps/marketing/scripts/citability-ai-canary.ts --allow-one-paid-call <credentials.env|-> <public-url> <question> <new-evidence.json>");
    process.exitCode = 2;
    return;
  }
  const env = await readCitabilityCanaryCredentials(credentialsPath);
  if (!isCitabilityAiProviderConfigured(env)) throw new Error("credentials_or_model_unavailable");
  const normalized = normalizeSeoAuditUrl(inputUrl);
  if (!normalized.ok || question.trim().length === 0 || question.length > 512) throw new Error("invalid_probe_input");
  const model = resolveCitabilityAiModel(env);
  const registryResponse = await fetch("https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_responses/models", {
    headers: { Authorization: `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64")}` },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!registryResponse.ok) throw new Error("registry_http_failure");
  const registry: unknown = await registryResponse.json();
  const registryTask = object(registry) && Array.isArray(registry.tasks) && registry.tasks.length === 1 && object(registry.tasks[0]) ? registry.tasks[0] : null;
  const matching = registryTask && Array.isArray(registryTask.result)
    ? registryTask.result.filter((row: unknown) => object(row) && row.model_name === model && row.reasoning === false) : [];
  if (!object(registry) || registry.status_code !== 20000 || registryTask?.status_code !== 20000 || matching.length !== 1) throw new Error("model_not_verified");
  const page = await fetchPublicResource(normalized.url, { timeoutMs: 8_000, maxBodyBytes: CITABILITY_MAX_BODY_BYTES, maxRedirects: 0 });
  if (page.kind !== "ok" || page.finalUrl !== normalized.url || page.finalStatus < 200 || page.finalStatus >= 300
    || !page.bodyComplete || !isCitabilityCanaryHtml(page.contentType, page.body)) throw new Error("page_not_complete_html");
  const context = createCitabilityAiContext({ finalUrl: page.finalUrl, rawHtml: page.body,
    targetQuestion: question.trim(), capturedAt: new Date().toISOString(), checks: [] });
  buildCitabilityAiTask(context, model);
  // Exclusive creation avoids accidentally retrying the same documented canary.
  // This is local probe safety, not the production durable quota implementation.
  const evidenceFile = await open(outputPath, "wx", 0o600);
  const base = {
    scope: "Authorized local safe-fetch and real DataForSEO adapter canary; not production auth/quota/browser evidence",
    registryVerifiedAt: new Date().toISOString(), model, registryMatch: matching[0],
    registryCostUsd: typeof registry.cost === "number" ? registry.cost : null,
    httpStatus: page.finalStatus, contentType: page.contentType, context,
  };
  await evidenceFile.writeFile(JSON.stringify({ ...base, outcome: "pending_or_unknown" }, null, 2));
  try {
    const review = await reviewCitabilityWithDataForSeo(context, { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD, model });
    const final = JSON.stringify({ ...base, outcome: "passed", review }, null, 2);
    await evidenceFile.truncate(0);
    await evidenceFile.write(final, 0, "utf8");
    console.info(JSON.stringify({ outcome: "passed", finalUrl: review.finalUrl, rawSha256: review.rawSha256,
      model: review.actualModel, providerTaskId: review.providerTaskId, costUsd: review.costUsd,
      coverage: review.coverage, outputPath }));
  } catch (error) {
    const failure = error instanceof CitabilityAiProviderError
      ? { code: error.code, costUsd: error.costUsd, providerTaskId: error.providerTaskId, outcomeUnknown: error.outcomeUnknown }
      : { code: "probe_failed", costUsd: null, providerTaskId: null, outcomeUnknown: true };
    await evidenceFile.truncate(0);
    await evidenceFile.write(JSON.stringify({ ...base, outcome: "failed", failure }, null, 2), 0, "utf8");
    console.info(JSON.stringify({ outcome: "failed", ...failure, outputPath }));
    process.exitCode = 1;
  } finally { await evidenceFile.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(() => {
  // Deliberately avoid printing arbitrary credential/parser/network error text.
  console.error("Canary prerequisites failed; no successful paid review is claimed. Inspect configuration and use a new explicit evidence path only after checking any existing receipt.");
  process.exitCode = 1;
});
