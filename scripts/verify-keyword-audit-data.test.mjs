import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourcePath = path.join(
  repositoryRoot,
  "docs",
  "keyword-audit-artifact-src",
  "audit-data.js",
);

const requiredTextFields = [
  "title",
  "sourceStatement",
  "currentTruth",
  "decision",
  "rationale",
];

const requiredListFields = [
  "currentEvidence",
  "rewrittenAcceptance",
  "modules",
  "stage",
  "dependencies",
  "completionEvidence",
  "notIncluded",
];

async function loadAuditData() {
  const source = await readFile(sourcePath, "utf8");
  const window = {};
  vm.runInNewContext(source, { window }, { filename: sourcePath });
  return structuredClone(window.NevermoreKeywordAudit);
}

function assertNonEmptyText(value, message) {
  assert.equal(typeof value, "string", message);
  assert.notEqual(value.trim(), "", message);
}

function assertNonEmptyStringList(value, message) {
  assert.ok(Array.isArray(value), message);
  assert.ok(value.length > 0, message);
  value.forEach((entry, index) =>
    assertNonEmptyText(entry, `${message}（索引 ${index}）`),
  );
}

test("审计数据完整覆盖 13 条原始需求", async () => {
  const audit = await loadAuditData();

  assert.equal(audit.requirements.length, 13);
  assert.deepEqual(
    audit.requirements.map((item) => item.id),
    Array.from({ length: 13 }, (_, index) => index + 1),
  );
  assert.equal(
    new Set(audit.requirements.map((item) => item.sourceStatement)).size,
    13,
    "每条原始需求必须且只能出现一次",
  );
  assert.deepEqual(
    new Set(audit.requirements.map((item) => item.decision)),
    new Set(["adopt", "rewrite", "defer"]),
  );
});

test("每条审核记录都具备可实施、可验收和明确排除边界", async () => {
  const audit = await loadAuditData();
  const validTruthStates = new Set([
    "current",
    "partial",
    "not-implemented",
    "external-dependent",
  ]);
  const moduleIds = new Set(audit.modules.map((module) => module.id));
  const stageIds = new Set(audit.stages.map((stage) => stage.id));

  for (const requirement of audit.requirements) {
    for (const field of requiredTextFields) {
      assertNonEmptyText(
        requirement[field],
        `需求 ${requirement.id} 缺少 ${field}`,
      );
    }
    for (const field of requiredListFields) {
      assertNonEmptyStringList(
        requirement[field],
        `需求 ${requirement.id} 缺少 ${field}`,
      );
    }

    assert.ok(
      validTruthStates.has(requirement.currentTruth),
      `需求 ${requirement.id} 的 currentTruth 无效`,
    );
    requirement.modules.forEach((moduleId) =>
      assert.ok(
        moduleIds.has(moduleId),
        `需求 ${requirement.id} 引用了未知模块 ${moduleId}`,
      ),
    );
    requirement.stage.forEach((stageId) =>
      assert.ok(
        stageIds.has(stageId),
        `需求 ${requirement.id} 引用了未知阶段 ${stageId}`,
      ),
    );
  }
});

test("客户可见连接面只包含 GSC、GA4 和 GitHub", async () => {
  const audit = await loadAuditData();

  assert.deepEqual(audit.customerVisibleConnectors, ["GSC", "GA4", "GitHub"]);
});

test("关键审核边界不会被 Artifact 误报为已上线能力", async () => {
  const audit = await loadAuditData();
  const requirement9 = audit.requirements.find((item) => item.id === 9);
  const requirement11 = audit.requirements.find((item) => item.id === 11);
  const requirement12 = audit.requirements.find((item) => item.id === 12);

  assert.deepEqual(
    requirement9.completionFlags.map((flag) => flag.id),
    ["rank_history_complete", "receipt_backed_results_complete"],
  );
  requirement9.completionFlags.forEach((flag) => {
    assertNonEmptyText(flag.label, `需求 9 的 ${flag.id} 缺少 label`);
    assertNonEmptyText(
      flag.evidenceNeeded,
      `需求 9 的 ${flag.id} 缺少 evidenceNeeded`,
    );
    assert.notEqual(
      flag.status,
      "complete",
      `需求 9 的 ${flag.id} 不得在审计 Artifact 中提前标记完成`,
    );
  });

  assert.equal(requirement11.decision, "defer");
  assert.ok(
    requirement11.stage.every((stageId) => stageId !== "stage-1"),
    "外链 Provider 深接不得进入当前上线阶段",
  );

  const requirement12Text = JSON.stringify(requirement12);
  assert.match(requirement12Text, /Observation|观测/);
  assert.equal(requirement12.targetEvidenceMode, "observation");
  assert.match(
    requirement12.rewrittenAcceptance.join(" "),
    /Analysis|分析/,
    "需求 12 必须把结构差异标记为分析，而不是事实归因",
  );
});

test("客户可见审计数据不泄露工作站、凭据或历史兼容项目标识", async () => {
  const audit = await loadAuditData();
  const serialized = JSON.stringify(audit);

  assert.doesNotMatch(serialized, /\/Users\/|[A-Za-z]:\\/);
  assert.doesNotMatch(serialized, /signalframe-mvp-app|SignalFrame|@sf\//i);
  assert.doesNotMatch(
    serialized,
    /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']+/i,
  );
});
