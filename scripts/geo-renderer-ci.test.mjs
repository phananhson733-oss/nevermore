import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const installBrowser = "pnpm exec playwright install --with-deps chromium";
const installDependencies = "pnpm install --frozen-lockfile";
const unitCommands = new Set(["pnpm test", "pnpm test:coverage", "pnpm coverage:unit-gaps"]);

// Read this repository's ordinary named-step layout without adding a YAML
// dependency to the dependency-free scripts test suite. Unknown layout fails.
function stepsOf(jobName) {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `Missing CI job ${jobName}`);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[\w-]+:$/.test(lines[end])) end += 1;
  const steps = lines.slice(start, end).join("\n").split(/(?=^ {6}- name:)/m).slice(1);
  assert.ok(steps.length > 0, `No named steps found in ${jobName}`);
  return steps;
}

function runCommand(step) {
  return /^ {8}run: ([^\n]+)$/m.exec(step)?.[1] ?? null;
}

for (const [jobName, requiredCoverage] of [
  ["contracts-and-unit", "pnpm coverage:unit-gaps"],
  ["database", "pnpm test:coverage"],
]) {
  test(`${jobName} installs pinned Chromium before its first unit/browser coverage run`, () => {
    const steps = stepsOf(jobName);
    const commands = steps.map(runCommand);
    assert.equal(commands.filter(command => command === installBrowser).length, 1,
      `${jobName} must install Chromium exactly once with the pinned workspace Playwright`);
    const browserIndex = commands.indexOf(installBrowser);
    const dependenciesIndex = commands.indexOf(installDependencies);
    assert.ok(dependenciesIndex >= 0 && dependenciesIndex < browserIndex,
      `${jobName} must install frozen dependencies before resolving Playwright`);
    assert.ok(commands.includes(requiredCoverage), `${jobName} must retain ${requiredCoverage}`);
    const firstUnitIndex = commands.findIndex(command => unitCommands.has(command));
    assert.ok(browserIndex < firstUnitIndex,
      `${jobName}: Chromium must exist before ${commands[firstUnitIndex]} collects the real renderer tests`);
    assert.doesNotMatch(steps[browserIndex], /^ {8}(?:if|continue-on-error):/m,
      `${jobName} browser installation must not be optional`);
  });
}

test("the CI ordering guard runs while CI remains explicitly manual", () => {
  assert.ok(stepsOf("contracts-and-unit").some(step => runCommand(step) === "node --test scripts/geo-renderer-ci.test.mjs"));
  const trigger = workflow.slice(workflow.indexOf("\non:\n") + 1, workflow.indexOf("\npermissions:"));
  const activeLines = trigger.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  assert.deepEqual(activeLines, ["on:", "workflow_dispatch:"]);
});
