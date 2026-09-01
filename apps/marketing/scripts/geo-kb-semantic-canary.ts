// Manual verification CLI only. Importing this module never reads an env file or calls a model.
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GeoKbCanaryError, runGeoKbSemanticCanary, type GeoKbCanaryOptions } from "./geo-kb-semantic-canary-lib.ts";

export function parseGeoKbCanaryArgs(args: readonly string[]): GeoKbCanaryOptions {
  try {
    const { values } = parseArgs({ args: [...args], strict: true, allowPositionals: false, options: {
      stage: { type: "string" }, "env-file": { type: "string" }, "output-dir": { type: "string" }, "roles-reviewed": { type: "boolean", default: false }, "retry-failed-roles": { type: "boolean", default: false }, "retry-failed-questions": { type: "boolean", default: false },
    } });
    if ((values.stage !== "roles" && values.stage !== "questions") || !values["env-file"] || !values["output-dir"] || (values.stage === "roles" && values["roles-reviewed"])
      || (values.stage === "questions" && values["retry-failed-roles"]) || (values.stage === "roles" && values["retry-failed-questions"])
      || (values["retry-failed-questions"] && !values["roles-reviewed"])) throw new Error("Invalid arguments");
    return { stage: values.stage, envFile: values["env-file"], outputDir: values["output-dir"], rolesReviewed: values["roles-reviewed"], retryFailedRoles: values["retry-failed-roles"], retryFailedQuestions: values["retry-failed-questions"] };
  } catch { throw new GeoKbCanaryError("invalid_arguments"); }
}

async function main(): Promise<void> {
  try {
    const summary = await runGeoKbSemanticCanary(parseGeoKbCanaryArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(summary) + "\n");
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    // Never print filesystem, environment or provider diagnostics: they can
    // contain secrets/URLs. The immutable attempt marker remains consumed.
    process.stderr.write(JSON.stringify({ ok: false, scope: "local_verification_only", code: error instanceof GeoKbCanaryError ? error.code : "canary_failed" }) + "\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
