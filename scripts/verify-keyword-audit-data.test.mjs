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

test("主 Artifact 冻结 Nevermore 四模块完整融合方案", async () => {
  const audit = await loadAuditData();
  const product = audit.integratedProduct;
  const expectedModules = [
    ["overview", "概览"],
    ["growth-map", "增长地图"],
    ["execution", "执行中心"],
    ["results", "效果追踪"],
  ];

  assert.equal(
    product.requirementsEvidenceRole,
    "secondary-evidence",
    "原 13 条审核记录必须作为二级 evidence，而不是主产品 IA",
  );
  assert.deepEqual(
    product.modules.map((module) => [module.id, module.name]),
    expectedModules,
  );
  const expectedGrowthMapSections = [
    "page-portfolio",
    "keyword-library",
    "topic-governance",
    "competitor-corpus",
    "internal-link-graph",
    "keyword-history",
    "external-evidence",
  ];
  assert.deepEqual(product.growthMapSections, expectedGrowthMapSections);
  assert.deepEqual(
    product.modules
      .find((module) => module.id === "growth-map")
      .mainSections.map((section) => section.id),
    expectedGrowthMapSections,
    "Growth Map 稳定索引必须与主页面区块 authority 一致",
  );
  assert.deepEqual(Object.keys(product.truthStates), [
    "current",
    "next",
    "provider-dependent",
  ]);
  assertNonEmptyText(product.customerPromise, "缺少完整产品客户承诺");

  for (const module of product.modules) {
    assertNonEmptyText(module.customerGoal, `${module.name} 缺少客户目标`);
    assertNonEmptyText(
      module.customerQuestion,
      `${module.name} 缺少客户问题`,
    );
    assert.ok(
      Array.isArray(module.mainSections) && module.mainSections.length > 0,
      `${module.name} 缺少主页面区块`,
    );
    assert.ok(
      Array.isArray(module.entryPoints) && module.entryPoints.length > 0,
      `${module.name} 缺少跨模块入口`,
    );
    assert.ok(
      Array.isArray(module.exitPoints) && module.exitPoints.length > 0,
      `${module.name} 缺少跨模块出口`,
    );
    assertNonEmptyStringList(
      module.canonicalObjects,
      `${module.name} 缺少 canonical objects`,
    );
    assert.ok(
      Array.isArray(module.capabilityIds) && module.capabilityIds.length > 0,
      `${module.name} 缺少能力归属`,
    );

    for (const section of module.mainSections) {
      assertNonEmptyText(section.id, `${module.name} 页面区块缺少 id`);
      assertNonEmptyText(section.title, `${module.name} 页面区块缺少标题`);
      assertNonEmptyText(section.purpose, `${module.name} 页面区块缺少用途`);
      assert.ok(
        ["current", "next", "provider-dependent"].includes(
          section.truthStatus,
        ),
        `${module.name}/${section.id} 缺少真实状态`,
      );
      assertGovernedAction(
        section.primaryAction,
        `${module.name}/${section.id} 的主操作`,
      );
    }
  }

  const resultsSections = product.modules.find(
    (module) => module.id === "results",
  ).mainSections;
  assert.equal(
    resultsSections.find((section) => section.id === "gsc-ga4-windows")
      .truthStatus,
    "next",
    "GSC/GA4 连接 readiness 已存在，不代表 immutable Measurement Window 已上线",
  );

  const executionSections = product.modules.find(
    (module) => module.id === "execution",
  ).mainSections;
  const currentArtifactBody = executionSections.find(
    (section) => section.id === "artifact-body",
  );
  assert.match(
    currentArtifactBody.purpose,
    /Blog.*Brief.*Metadata.*Technical Ticket.*Code Patch/,
  );
  assert.doesNotMatch(
    currentArtifactBody.purpose,
    /Publish|UTM/,
    "当前 Artifact Body 不得提前声称 Publication/Measurement 交付链已经存在",
  );
  assert.equal(
    executionSections.find(
      (section) => section.id === "approval-publication",
    ).truthStatus,
    "next",
  );
});

test("13 项能力全部进入四模块闭环且每项都有入口、目标与下一跳", async () => {
  const audit = await loadAuditData();
  const product = audit.integratedProduct;
  const moduleIds = new Set(product.modules.map((module) => module.id));
  const canonicalObjectIds = new Set(
    product.canonicalObjects.map((object) => object.id),
  );
  const expectedCapabilityIds = [
    "topic-governance",
    "keyword-relation-governance",
    "voc-source-governance",
    "artifact-source-provenance",
    "action-blocker",
    "action-business-progress",
    "opportunity-decision-sla",
    "internal-link-graph",
    "keyword-rank-history",
    "content-decay-monitor",
    "backlink-evidence",
    "geo-citation-observation",
    "competitor-delta-monitor",
  ];

  assert.equal(product.capabilities.length, 13);
  assert.deepEqual(
    product.capabilities.map((capability) => capability.id),
    expectedCapabilityIds,
  );
  assert.deepEqual(
    product.capabilities.map((capability) => capability.requirementId),
    Array.from({ length: 13 }, (_, index) => index + 1),
  );

  for (const capability of product.capabilities) {
    const requirement = audit.requirements.find(
      (item) => item.id === capability.requirementId,
    );
    const ownedModules = [
      capability.primaryModule,
      ...capability.supportingModules,
    ];

    assert.ok(
      moduleIds.has(capability.primaryModule),
      `${capability.id} 缺少合法目标模块`,
    );
    assert.deepEqual(
      new Set(ownedModules),
      new Set(requirement.modules),
      `${capability.id} 的模块归属必须与审核 evidence 一致`,
    );
    assert.ok(
      ["current", "next", "provider-dependent"].includes(
        capability.truthStatus,
      ),
      `${capability.id} 缺少真实状态`,
    );
    assert.ok(
      Array.isArray(capability.entryPoints) &&
        capability.entryPoints.length > 0,
      `${capability.id} 缺少入口`,
    );
    assert.ok(
      capability.entryPoints.some(
        (entry) => entry.toModule === capability.primaryModule,
      ),
      `${capability.id} 至少一个入口必须到达目标模块`,
    );
    assert.ok(
      Array.isArray(capability.exitPoints) && capability.exitPoints.length > 0,
      `${capability.id} 缺少下一跳`,
    );
    assertNonEmptyStringList(
      capability.canonicalObjects,
      `${capability.id} 缺少 canonical object`,
    );
    capability.canonicalObjects.forEach((objectId) =>
      assert.ok(
        canonicalObjectIds.has(objectId),
        `${capability.id} 引用了未知 canonical object ${objectId}`,
      ),
    );
    capability.entryPoints.forEach((entry) =>
      assert.ok(
        moduleIds.has(entry.fromModule) && moduleIds.has(entry.toModule),
        `${capability.id} 的入口必须位于四模块内`,
      ),
    );
    capability.exitPoints.forEach((exit) =>
      assert.ok(
        moduleIds.has(exit.fromModule) && moduleIds.has(exit.toModule),
        `${capability.id} 的下一跳必须位于四模块内`,
      ),
    );
    assertGovernedAction(
      capability.primaryAction,
      `${capability.id} 的主操作`,
    );
    assertNonEmptyText(
      capability.implementationCondition,
      `${capability.id} 缺少实施条件`,
    );
  }

  const deferred = product.capabilities.find(
    (capability) => capability.requirementId === 11,
  );
  assert.equal(deferred.truthStatus, "provider-dependent");
  assert.equal(deferred.primaryAction.destination.kind, "provider-readiness");
  assert.match(
    deferred.implementationCondition,
    /满足|批准|接入/,
    "后置只表示外部条件与实施时序，不能表示能力被放弃",
  );
});

test("统一生命周期、canonical objects 与跨模块旅程可完整重放", async () => {
  const audit = await loadAuditData();
  const product = audit.integratedProduct;
  const moduleIds = new Set(product.modules.map((module) => module.id));
  const objectIds = new Set(
    product.canonicalObjects.map((object) => object.id),
  );

  assert.ok(product.lifecycle.length >= 6, "统一生命周期不能退化为局部流程");
  assert.deepEqual(
    product.lifecycle.map((phase) => phase.order),
    Array.from(
      { length: product.lifecycle.length },
      (_, index) => index + 1,
    ),
  );

  for (const phase of product.lifecycle) {
    assertNonEmptyText(phase.customerQuestion, `${phase.id} 缺少客户问题`);
    assert.ok(moduleIds.has(phase.primaryModule), `${phase.id} 缺少目标模块`);
    assertNonEmptyStringList(
      phase.canonicalObjects,
      `${phase.id} 缺少 canonical objects`,
    );
    assertNonEmptyText(phase.entry, `${phase.id} 缺少生命周期入口`);
    assertNonEmptyText(phase.exit, `${phase.id} 缺少生命周期出口`);
  }

  assert.ok(
    product.canonicalObjects.length >= 12,
    "完整融合方案必须显式列出当前和下一阶段的 canonical objects",
  );
  assert.deepEqual(
    new Set(product.canonicalObjects.map((object) => object.truthStatus)),
    new Set(["current", "next", "provider-dependent"]),
  );
  product.canonicalObjects.forEach((object) => {
    assertNonEmptyText(object.name, `${object.id} 缺少名称`);
    assertNonEmptyText(object.authority, `${object.id} 缺少 authority`);
    assertNonEmptyStringList(
      object.modules,
      `${object.id} 缺少模块消费者`,
    );
    object.modules.forEach((moduleId) =>
      assert.ok(
        moduleIds.has(moduleId),
        `${object.id} 引用了未知模块 ${moduleId}`,
      ),
    );
  });

  assert.ok(
    product.crossModuleJourneys.length >= 3,
    "至少需要内容、技术修复和持续监控三条客户旅程",
  );
  product.crossModuleJourneys.forEach((journey) => {
    assertNonEmptyText(journey.customerOutcome, `${journey.id} 缺少客户结果`);
    assert.ok(journey.steps.length >= 3, `${journey.id} 不是跨模块旅程`);
    journey.steps.forEach((step) => {
      assert.ok(
        moduleIds.has(step.module),
        `${journey.id} 引用了未知模块 ${step.module}`,
      );
      assertNonEmptyText(step.action, `${journey.id} 缺少步骤动作`);
      assertNonEmptyStringList(
        step.canonicalObjects,
        `${journey.id} 步骤缺少 canonical objects`,
      );
      step.canonicalObjects.forEach((objectId) =>
        assert.ok(
          objectIds.has(objectId),
          `${journey.id} 引用了未知 canonical object ${objectId}`,
        ),
      );
    });
  });
});

test("完整产品只展示真实客户连接，并对内部 Evidence Provider 诚实降级", async () => {
  const audit = await loadAuditData();
  const policy = audit.integratedProduct.connectorPolicy;

  assert.deepEqual(policy, audit.connectorPolicy);
  assert.deepEqual(policy.customerVisible, ["GSC", "GA4", "GitHub"]);
  assert.deepEqual(policy.customerVisible, audit.customerVisibleConnectors);
  assert.deepEqual(
    policy.connections.map((connection) => [
      connection.id,
      connection.name,
      connection.truthStatus,
    ]),
    [
      ["gsc", "GSC", "current"],
      ["ga4", "GA4", "current"],
      ["github", "GitHub", "next"],
    ],
  );
  policy.connections.forEach((connection) => {
    assertNonEmptyText(
      connection.purpose,
      `${connection.name} 缺少客户用途`,
    );
    assertNonEmptyText(
      connection.readiness,
      `${connection.name} 缺少 readiness`,
    );
    assertNonEmptyText(
      connection.unavailableText,
      `${connection.name} 缺少 unavailable 文案`,
    );
  });
  assertNonEmptyStringList(
    policy.internalEvidenceProviders,
    "缺少内部 Evidence Provider 边界",
  );
  assertNonEmptyText(policy.rule, "缺少客户连接显示规则");
  assertNonEmptyText(policy.unavailableRule, "缺少 unavailable 规则");
  assertNonEmptyText(policy.mockBoundary, "缺少场景数据边界");
  assert.equal(
    policy.internalEvidenceProviders.some((provider) =>
      policy.customerVisible.includes(provider),
    ),
    false,
    "内部 Evidence Provider 不得伪装成客户连接",
  );

  const serialized = JSON.stringify(audit.integratedProduct);
  assert.doesNotMatch(serialized, /RelayOps/i);
  assert.doesNotMatch(serialized, /\b(?:1,?240|2,?486|37 total|92%)\b/i);

  const primaryActions = [
    ...audit.integratedProduct.modules.flatMap((module) =>
      module.mainSections.map((section) => section.primaryAction),
    ),
    ...audit.integratedProduct.capabilities.map(
      (capability) => capability.primaryAction,
    ),
  ];
  assert.equal(
    new Set(primaryActions.map((action) => action.id)).size,
    primaryActions.length,
    "主页面区块和 13 项能力的 primaryAction id 必须全局唯一",
  );
});

function assertGovernedAction(action, message) {
  assert.ok(action && typeof action === "object", `${message}缺失`);
  assertNonEmptyText(action.id, `${message}缺少 id`);
  assertNonEmptyText(action.label, `${message}缺少 label`);
  assert.ok(
    action.destination && typeof action.destination === "object",
    `${message}缺少 governed destination`,
  );
  assert.ok(
    [
      "module-surface",
      "canonical-command",
      "evidence-view",
      "results-view",
      "provider-readiness",
    ].includes(action.destination.kind),
    `${message}的 destination kind 无效`,
  );
  assertNonEmptyText(action.destination.target, `${message}缺少目标`);
}
