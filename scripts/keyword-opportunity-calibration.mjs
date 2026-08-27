import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  KEYWORD_OPPORTUNITY_CALIBRATION_SCHEMA_VERSION,
  compareKeywordOpportunityCalibration,
} from "../packages/public-tools/src/keyword-opportunity/calibration.ts";

const argumentsList = process.argv.slice(2);
let inputArgument;
let outputArgument;
for (let index = 0; index < argumentsList.length; index += 1) {
  const value = argumentsList[index];
  if (value === "--") continue;
  if (value === "--out") {
    outputArgument = argumentsList[index + 1];
    if (outputArgument === undefined) throw new Error("--out needs a path");
    index += 1;
    continue;
  }
  if (value?.startsWith("--")) throw new Error(`unknown option: ${value}`);
  if (inputArgument !== undefined) throw new Error("only one input is allowed");
  inputArgument = value;
}
const defaultInput =
  "packages/public-tools/src/keyword-opportunity/__fixtures__/calibration-synthetic.v1.json";
const inputReference = inputArgument ?? defaultInput;
const inputPath = resolve(inputReference);
const raw = await readFile(inputPath, "utf8");
const snapshot = JSON.parse(raw);
if (
  snapshot?.schemaVersion !== KEYWORD_OPPORTUNITY_CALIBRATION_SCHEMA_VERSION ||
  typeof snapshot?.synthetic !== "boolean" ||
  !Array.isArray(snapshot?.candidates)
) {
  throw new Error("invalid keyword opportunity calibration snapshot");
}

const trafficThresholds = {
  rank1To200: 5_000,
  rank201To500: 50_000,
  rank501To1000: 100_000,
};
const comparison = compareKeywordOpportunityCalibration(snapshot, [
  {
    id: "strict-v2",
    unknownPolicy: "strict_unknown_first",
    youngDomainMonths: 24,
    trafficThresholds,
  },
  {
    id: "positive-first-v3",
    unknownPolicy: "positive_first",
    youngDomainMonths: 24,
    trafficThresholds,
  },
  {
    id: "positive-first-weak-tier-10k",
    unknownPolicy: "positive_first",
    youngDomainMonths: 24,
    trafficThresholds: { ...trafficThresholds, rank1To200: 10_000 },
  },
]);
const artifact = {
  artifactVersion: "keyword_opportunity_calibration_report.v1",
  inputSha256: createHash("sha256").update(raw).digest("hex"),
  source: inputReference,
  ...comparison,
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (outputArgument === undefined) {
  process.stdout.write(serialized);
} else {
  await writeFile(resolve(outputArgument), serialized, "utf8");
}
