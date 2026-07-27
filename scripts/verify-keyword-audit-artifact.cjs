"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const {
  assertRepositoryOwnedPath,
} = require("./artifact-path-guard.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const defaultArtifactFile = path.join(
  repositoryRoot,
  "docs",
  "artifacts",
  "Nevermore-Keyword-Growth-Audit.html",
);
const [artifactArgument] = process.argv.slice(2);
const artifactFile = artifactArgument
  ? path.resolve(repositoryRoot, artifactArgument)
  : defaultArtifactFile;

const PRODUCT_MODULES = [
  { id: "overview", name: "概览" },
  { id: "growth-map", name: "增长地图" },
  { id: "execution", name: "执行中心" },
  { id: "results", name: "效果追踪" },
];
const PRODUCT_MODULE_IDS = new Set(PRODUCT_MODULES.map((module) => module.id));
const CUSTOMER_CONNECTORS = ["GSC", "GA4", "GitHub"];
const GROWTH_OBJECT_IDS = [
  "page-portfolio",
  "keyword-library",
  "topic-governance",
  "competitor-corpus",
  "internal-link-graph",
  "keyword-history",
  "external-evidence",
];
const DELIVERABLE_TYPES = [
  { id: "english-blog", minimumCharacters: 500 },
  { id: "content-brief", minimumCharacters: 300 },
  { id: "metadata", minimumCharacters: 120 },
  { id: "technical-ticket-code-patch", minimumCharacters: 300 },
];
const PRIMARY_EXPERIENCE_FORBIDDEN_COPY =
  /最终客户页面结构|实施条件|Canonical\s*(?:对象|Objects?)|Capability\s*entry|方案证据来源/i;
const PRIMARY_INTERNAL_IDENTITY_SELECTOR = [
  "[data-capability-entry]",
  "[data-capability-detail]",
  "[data-capability-next]",
  "[data-capability-id]",
  "[data-audit-requirement-id]",
  "[data-audit-requirement]",
  "[data-requirement-id]",
  "[data-product-node-id]",
].join(", ");

assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath: artifactFile,
  label: "Keyword growth product Artifact",
  mustExist: true,
  kind: "file",
});

const html = fs.readFileSync(artifactFile, "utf8");
const forbiddenDependencies = [
  ["external script", /<script\b[^>]*\bsrc\s*=/i],
  [
    "external stylesheet",
    /<link\b[^>]*\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i,
  ],
  ["CSS import", /@import\s/i],
  ["remote CSS asset", /url\s*\(\s*["']?https?:/i],
  [
    "remote media asset",
    /<(?:img|audio|video|source|iframe)\b[^>]*\bsrc\s*=\s*["']https?:/i,
  ],
  ["remote object", /<object\b[^>]*\bdata\s*=\s*["']https?:/i],
  ["network fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["worker", /\b(?:Shared)?Worker\s*\(/],
  ["importScripts", /\bimportScripts\s*\(/],
  ["WebSocket", /\bWebSocket\s*\(/],
  ["EventSource", /\bEventSource\s*\(/],
  ["sendBeacon", /\bsendBeacon\s*\(/],
];

for (const [label, pattern] of forbiddenDependencies) {
  assert.equal(
    pattern.test(html),
    false,
    `Keyword growth product Artifact must not contain ${label}`,
  );
}

assert.doesNotMatch(
  html,
  /(?:\bSignalFrame\b|signalframe-mvp-app|@sf\/)/i,
  "Artifact must not expose a compatibility package name",
);
assert.doesNotMatch(
  html,
  /(?:\/Users\/|\/home\/|\/var\/folders\/|\/private\/(?:tmp|var)\/|[A-Za-z]:\\Users\\|\.codex[/\\]visualizations|file:\/\/)/i,
  "Artifact must not expose an absolute workstation path",
);
assert.doesNotMatch(
  html,
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^/\s:@]+:[^@\s/]+@|https?:\/\/[^/\s:@]+:[^@\s/]+@|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/,
  "Artifact must not contain credentials",
);
assert.doesNotMatch(
  html,
  /\b(?:showToast|createToast|toast\s*\()/i,
  "Visible actions must resolve to governed destinations, not a generic toast",
);
assert.doesNotMatch(
  html,
  /\bRelayOps\b/i,
  "Artifact must not expose the legacy RelayOps scenario product",
);
assert.equal(
  /(?:\bDEMO DATA\b|场景数据\s*[·•|]\s*\d{4}|2,486\s+keywords|126\s+URLs|28\s+domains|1,240\s+(?:clicks|点击)|1,842\s+words|\b37\s+total\b|\b92%|产品画像\s*100%|data-evidence-status\s*=\s*["'](?:mock|scenario)["'])/i.test(
    html,
  ),
  false,
  "Artifact must not present legacy mock business metrics as customer truth",
);

assert.match(html, /data-keyword-audit-build="2\.0-static"/);
assert.match(html, /data-primary-experience="growth-workspace"/);
assert.match(html, /<html\b[^>]*\blang="zh-CN"/i);
assert.match(html, /<title>Nevermore · SEO\/GEO 增长工作台<\/title>/);
assert.match(html, /<style>[\s\S]+<\/style>/);
assert.match(html, /window\.NevermoreKeywordAudit/);
assert.match(html, /<div id="app"><\/div>/);
assert.match(html, /<noscript>[\s\S]+<\/noscript>/);

const runtimeErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", (message) => {
  runtimeErrors.push(`console.error: ${String(message)}`);
});
virtualConsole.on("jsdomError", (error) => {
  runtimeErrors.push(`jsdom: ${error.message}`);
});

const dom = new JSDOM(html, {
  url: "http://127.0.0.1/Nevermore-Keyword-Growth-Audit.html",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    window.requestAnimationFrame = (callback) => {
      callback(Date.now());
      return 1;
    };
    window.cancelAnimationFrame = () => {};
  },
});

const { document, Event, HashChangeEvent, KeyboardEvent } = dom.window;
if (document.querySelector("#app")?.dataset.ready !== "true") {
  document.dispatchEvent(
    new Event("DOMContentLoaded", { bubbles: true, cancelable: false }),
  );
}

const one = (selector, root = document) => {
  const matches = root.querySelectorAll(selector);
  assert.equal(
    matches.length,
    1,
    `Expected exactly one match for ${selector}; got ${matches.length}`,
  );
  return matches[0];
};
const many = (selector, minimum = 1, root = document) => {
  const matches = [...root.querySelectorAll(selector)];
  assert.ok(
    matches.length >= minimum,
    `Expected at least ${minimum} matches for ${selector}; got ${matches.length}`,
  );
  return matches;
};
const clickElement = (element) => {
  assert.notEqual(element.disabled, true, "Product action must be enabled");
  const previousHash = dom.window.location.hash;
  element.click();
  if (dom.window.location.hash !== previousHash) {
    dom.window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  return {
    previousHash,
    currentHash: dom.window.location.hash,
  };
};
const click = (selector, root = document) =>
  clickElement(one(selector, root));
const normalizedText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const audit = dom.window.NevermoreKeywordAudit;
assert.ok(audit && typeof audit === "object", "Product data must be available");
assert.equal(
  audit.requirements.length,
  13,
  "All 13 reviewed capabilities must remain available as evidence",
);
assert.deepEqual(
  Array.from(audit.requirements, (item) => item.id),
  Array.from({ length: 13 }, (_, index) => index + 1),
  "Requirement ids must cover 1 through 13 exactly once",
);
assert.deepEqual(
  Array.from(audit.customerVisibleConnectors),
  CUSTOMER_CONNECTORS,
  "Only GSC, GA4, and GitHub may be customer-visible connectors",
);

const integratedProduct = audit.integratedProduct;
assert.ok(
  integratedProduct && typeof integratedProduct === "object",
  "Audit data must expose the integrated Nevermore product model",
);
assert.equal(
  integratedProduct.requirementsEvidenceRole,
  "secondary-evidence",
  "The original demand audit must be secondary evidence, not the primary experience",
);
assert.deepEqual(
  Array.from(integratedProduct.modules, (module) => ({
    id: module.id,
    name: module.name,
  })),
  PRODUCT_MODULES,
  "The customer product model must have exactly the four canonical modules",
);
const growthMapModule = integratedProduct.modules.find(
  (module) => module.id === "growth-map",
);
assert.deepEqual(
  Array.from(growthMapModule.mainSections, (section) => section.id),
  GROWTH_OBJECT_IDS,
  "Growth Map module sections must expose all seven governed objects",
);
assert.deepEqual(
  Array.from(integratedProduct.growthMapSections),
  GROWTH_OBJECT_IDS,
  "Growth Map navigation index must preserve the canonical seven-object order",
);
assert.deepEqual(
  Array.from(integratedProduct.growthMapSections),
  Array.from(growthMapModule.mainSections, (section) => section.id),
  "Growth Map navigation index must remain a projection of module mainSections",
);
assert.equal(
  integratedProduct.capabilities.length,
  13,
  "The integrated product must map all 13 reviewed capabilities",
);
assert.deepEqual(
  Array.from(
    integratedProduct.capabilities,
    (capability) => capability.requirementId,
  ),
  Array.from({ length: 13 }, (_, index) => index + 1),
  "Capabilities must map requirements 1 through 13 exactly once",
);

const allowedTruthStates = new Set([
  "current",
  "next",
  "provider-dependent",
]);
const allowedDestinationKinds = new Set([
  "module-surface",
  "canonical-command",
  "evidence-view",
  "results-view",
  "provider-readiness",
]);
const governedActionDefinitions = [];

for (const module of integratedProduct.modules) {
  assert.ok(
    Array.isArray(module.mainSections) && module.mainSections.length > 0,
    `${module.name} must expose customer-facing product sections`,
  );
  for (const section of module.mainSections) {
    assert.ok(
      allowedTruthStates.has(section.truthStatus),
      `${module.name}/${section.id} must expose a canonical truth status`,
    );
    assert.ok(
      normalizedText(section.primaryAction?.id) &&
        normalizedText(section.primaryAction?.label),
      `${module.name}/${section.id} must expose a primary action`,
    );
    assert.ok(
      allowedDestinationKinds.has(section.primaryAction?.destination?.kind) &&
        normalizedText(section.primaryAction?.destination?.target),
      `${module.name}/${section.id} action must have a governed destination`,
    );
    governedActionDefinitions.push(section.primaryAction);
  }
}

for (const capability of integratedProduct.capabilities) {
  assert.ok(
    PRODUCT_MODULE_IDS.has(capability.primaryModule),
    `Capability ${capability.requirementId} must have a valid primary module`,
  );
  assert.ok(
    Array.isArray(capability.supportingModules),
    `Capability ${capability.requirementId} must expose supporting modules`,
  );
  assert.ok(
    capability.supportingModules.every((moduleId) =>
      PRODUCT_MODULE_IDS.has(moduleId),
    ),
    `Capability ${capability.requirementId} contains an unknown supporting module`,
  );
  assert.ok(
    allowedTruthStates.has(capability.truthStatus),
    `Capability ${capability.requirementId} must expose current truth`,
  );
  assert.ok(
    Array.isArray(capability.entryPoints) && capability.entryPoints.length > 0,
    `Capability ${capability.requirementId} must expose customer entry points`,
  );
  assert.ok(
    Array.isArray(capability.exitPoints) && capability.exitPoints.length > 0,
    `Capability ${capability.requirementId} must expose governed exit points`,
  );
  assert.ok(
    Array.isArray(capability.canonicalObjects) &&
      capability.canonicalObjects.length > 0,
    `Capability ${capability.requirementId} must identify canonical objects`,
  );
  assert.ok(
    normalizedText(capability.implementationCondition),
    `Capability ${capability.requirementId} must expose an implementation condition`,
  );
  assert.ok(
    normalizedText(capability.primaryAction?.id) &&
      normalizedText(capability.primaryAction?.label),
    `Capability ${capability.requirementId} must expose a primary customer action`,
  );
  assert.ok(
    allowedDestinationKinds.has(
      capability.primaryAction?.destination?.kind,
    ) && normalizedText(capability.primaryAction?.destination?.target),
    `Capability ${capability.requirementId} action must have a governed destination`,
  );
  governedActionDefinitions.push(capability.primaryAction);
}

assert.equal(
  new Set(governedActionDefinitions.map((action) => action.id)).size,
  governedActionDefinitions.length,
  "Every governed product action must have a unique stable id",
);

for (const requirement of audit.requirements) {
  assert.ok(
    Array.isArray(requirement.modules) && requirement.modules.length > 0,
    `Requirement ${requirement.id} must retain at least one module landing`,
  );
  assert.ok(
    requirement.modules.every((moduleId) => PRODUCT_MODULE_IDS.has(moduleId)),
    `Requirement ${requirement.id} must only land in canonical product modules`,
  );
}

const connectorPolicy = integratedProduct.connectorPolicy;
assert.deepEqual(
  Array.from(connectorPolicy.customerVisible),
  CUSTOMER_CONNECTORS,
  "Connector policy must match the customer-visible connector list",
);
assert.match(
  connectorPolicy.rule,
  /内部.*(?:Evidence|证据).*(?:不能|不得|不应|不).*(?:连接卡|客户连接|连接的应用)|(?:Evidence|证据).*Provider.*(?:不能|不得|不应|不).*(?:连接卡|客户连接|连接的应用)/i,
  "Connector policy must keep internal evidence providers out of customer connection cards",
);

assert.equal(document.title, "Nevermore · SEO/GEO 增长工作台");
assert.equal(document.documentElement.lang, "zh-CN");
assert.equal(document.querySelector(".boot-error"), null);
assert.equal(document.querySelectorAll(".toast, [data-toast]").length, 0);
assert.equal(one("#app").dataset.ready, "true");
assert.equal(
  one("#app").dataset.activeView,
  "overview",
  "The default customer view must be Overview, not the demand audit",
);
assert.doesNotMatch(
  normalizedText(one("h1").textContent),
  /需求审计|需求审核/,
  "The primary heading must describe the product workspace, not the audit",
);

const customerNavigation = one('nav[aria-label="客户工作区"]');
const productNavigationItems = many("[data-product-view]", 4, customerNavigation);
assert.equal(
  productNavigationItems.length,
  4,
  "Customer navigation must contain exactly four product modules",
);
assert.deepEqual(
  productNavigationItems.map((item) => item.dataset.productView),
  PRODUCT_MODULES.map((module) => module.id),
  "Customer navigation must use exactly the four canonical module ids",
);
for (const [index, module] of PRODUCT_MODULES.entries()) {
  assert.match(
    normalizedText(productNavigationItems[index].textContent),
    new RegExp(module.name),
    `Customer navigation item ${module.id} must display ${module.name}`,
  );
}
assert.doesNotMatch(
  normalizedText(customerNavigation.textContent),
  /需求审核|模块影响|分阶段落地|验收证据/,
  "Demand-audit navigation must not appear in the customer primary navigation",
);

const productContent = one("main#product-content");
assert.doesNotMatch(
  normalizedText(productContent.textContent),
  PRIMARY_EXPERIENCE_FORBIDDEN_COPY,
  "The primary customer workspace must not read like an implementation blueprint",
);
assert.equal(
  productContent.querySelectorAll(
    `${PRIMARY_INTERNAL_IDENTITY_SELECTOR}, [data-audit-register]`,
  ).length,
  0,
  "Requirement and capability identities must not appear in the primary product workspace",
);

const assertGovernedElement = (element, actionDefinition = null) => {
  const destination = element.dataset.governedDestination ?? "";
  assert.ok(
    normalizedText(destination),
    `${element.dataset.productAction ?? "Product action"} must expose a governed destination`,
  );
  assert.doesNotMatch(
    destination,
    /^(?:toast|feedback|none|#|javascript:)/i,
    `${element.dataset.productAction ?? "Product action"} must not use generic feedback`,
  );
  if (actionDefinition) {
    const expected =
      `${actionDefinition.destination.kind}:` +
      actionDefinition.destination.target;
    assert.equal(
      element.dataset.productAction,
      actionDefinition.id,
      `Rendered product action must preserve stable id ${actionDefinition.id}`,
    );
    assert.equal(
      destination,
      expected,
      `Product action ${actionDefinition.id} must expose its governed destination`,
    );
  }
};

const openAuditEvidence = one(
  '[data-product-action="open-audit-evidence"]',
);
assertGovernedElement(openAuditEvidence);
clickElement(openAuditEvidence);
const secondaryEvidence = one(
  "dialog[data-audit-evidence-dialog][data-secondary-evidence]",
);
assert.equal(
  secondaryEvidence.open || secondaryEvidence.hasAttribute("open"),
  true,
  "Demand-audit evidence must open in a secondary dialog",
);
assert.match(
  normalizedText(secondaryEvidence.textContent),
  /需求(?:审计|审核)|审核证据/,
  "The secondary evidence surface must identify the original demand audit",
);
const auditRequirements = many(
  "[data-audit-requirement-id]",
  13,
  secondaryEvidence,
);
assert.equal(
  auditRequirements.length,
  13,
  "Secondary evidence must preserve all 13 reviewed requirements",
);
assert.deepEqual(
  auditRequirements.map((element) =>
    Number(element.dataset.auditRequirementId),
  ),
  Array.from({ length: 13 }, (_, index) => index + 1),
  "Secondary evidence must preserve requirement identities",
);
document.dispatchEvent(
  new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
);
assert.equal(
  secondaryEvidence.open || secondaryEvidence.hasAttribute("open"),
  false,
  "Escape must close the secondary evidence dialog",
);

const openConnections = one('[data-product-action="open-connections"]');
assertGovernedElement(openConnections);
clickElement(openConnections);
const connectionsDialog = one("dialog[data-connections-dialog]");
assert.equal(
  connectionsDialog.open || connectionsDialog.hasAttribute("open"),
  true,
  "Customer connections must open in a governed dialog",
);
const connectorElements = many(
  "[data-connection-id][data-customer-connector]",
  3,
  connectionsDialog,
);
assert.equal(
  connectorElements.length,
  3,
  "The customer connection surface must show exactly three connectors",
);
assert.deepEqual(
  connectorElements.map((element) => element.dataset.customerConnector),
  CUSTOMER_CONNECTORS,
  "The connection surface may only show GSC, GA4, and GitHub",
);
document.dispatchEvent(
  new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
);
assert.equal(
  connectionsDialog.open || connectionsDialog.hasAttribute("open"),
  false,
  "Escape must close the customer connections dialog",
);

const selectSectionPanel = (moduleId, sectionId) => {
  click(`[data-product-view="${moduleId}"]`, customerNavigation);
  clickElement(one(`[data-section-id="${sectionId}"]`));
  const sectionControl = one(`[data-section-id="${sectionId}"]`);
  assert.equal(
    sectionControl.getAttribute("aria-selected"),
    "true",
    `${moduleId}/${sectionId} must become the selected customer view`,
  );
  const controlledPanel = sectionControl.getAttribute("aria-controls");
  assert.ok(
    normalizedText(controlledPanel),
    `${moduleId}/${sectionId} must control a real customer panel`,
  );
  const surface = one(`[data-product-surface="${moduleId}"]`);
  return {
    control: sectionControl,
    panel: one(`#${controlledPanel}`, surface),
    surface,
  };
};

for (const module of PRODUCT_MODULES) {
  if (module.id !== "overview") {
    click(`[data-product-view="${module.id}"]`, customerNavigation);
  }
  assert.equal(
    one("#app").dataset.activeView,
    module.id,
    `${module.name} navigation must activate its product surface`,
  );
  let surface = one(`[data-product-surface="${module.id}"]`);
  assert.doesNotMatch(
    normalizedText(surface.textContent),
    PRIMARY_EXPERIENCE_FORBIDDEN_COPY,
    `${module.name} must use native customer product language`,
  );
  assert.equal(
    surface.querySelectorAll("[data-product-metric]").length,
    0,
    `${module.name} must not invent scenario business metrics`,
  );

  for (const action of surface.querySelectorAll("[data-product-action]")) {
    assertGovernedElement(action);
  }

  const moduleDefinition = integratedProduct.modules.find(
    (item) => item.id === module.id,
  );
  for (const section of moduleDefinition.mainSections) {
    const selection = selectSectionPanel(module.id, section.id);
    surface = selection.surface;
    const action = one(
      `[data-product-action="${section.primaryAction.id}"]`,
      selection.panel,
    );
    assertGovernedElement(action, section.primaryAction);
  }
}

click('[data-product-view="growth-map"]', customerNavigation);
const growthObjects = many("[data-growth-object]", 7);
assert.equal(
  growthObjects.length,
  7,
  "Growth Map must expose all seven governed object views",
);
assert.deepEqual(
  growthObjects.map((element) => element.dataset.growthObject),
  GROWTH_OBJECT_IDS,
  "Growth Map object views must use the canonical order and identities",
);
for (const objectId of [
  GROWTH_OBJECT_IDS[0],
  GROWTH_OBJECT_IDS.at(-1),
  GROWTH_OBJECT_IDS[1],
  GROWTH_OBJECT_IDS[0],
]) {
  clickElement(one(`[data-growth-object="${objectId}"]`));
  const objectControl = one(`[data-growth-object="${objectId}"]`);
  assert.equal(
    objectControl.getAttribute("aria-selected"),
    "true",
    `Growth Map object ${objectId} must become selected`,
  );
  assert.equal(
    new URLSearchParams(dom.window.location.hash.split("?")[1]).get("object"),
    objectId,
    `Growth Map object ${objectId} must persist in the hash`,
  );
  const controlledPanel = objectControl.getAttribute("aria-controls");
  assert.ok(
    normalizedText(controlledPanel) && document.getElementById(controlledPanel),
    `Growth Map object ${objectId} must control a real panel`,
  );
}

click('[data-product-view="overview"]', customerNavigation);
one("[data-overview-workspace]");

click('[data-product-view="execution"]', customerNavigation);
one("[data-execution-workspace]");
const deliverableControls = many("[data-deliverable-select]", 4);
assert.equal(
  deliverableControls.length,
  DELIVERABLE_TYPES.length,
  "Execution must expose exactly four customer-reviewable deliverables",
);
assert.deepEqual(
  deliverableControls.map((control) => control.dataset.deliverableSelect),
  DELIVERABLE_TYPES.map((deliverable) => deliverable.id),
  "Execution deliverables must preserve the canonical customer order",
);
for (const deliverable of DELIVERABLE_TYPES) {
  clickElement(
    one(`[data-deliverable-select="${deliverable.id}"]`),
  );
  const selectedControl = one(
    `[data-deliverable-select="${deliverable.id}"]`,
  );
  assert.equal(
    selectedControl.getAttribute("aria-selected"),
    "true",
    `${deliverable.id} must become the selected deliverable`,
  );
  const body = one(
    `[data-deliverable-body][data-deliverable-type="${deliverable.id}"]`,
  );
  assert.match(
    body.dataset.deliverableStatus ?? "",
    /^(?:pending-review|pending-action)$/,
    `${deliverable.id} must disclose a pending—not completed—state`,
  );
  assert.ok(
    normalizedText(body.textContent).length >= deliverable.minimumCharacters,
    `${deliverable.id} must contain substantive customer-reviewable content`,
  );
  assert.doesNotMatch(
    normalizedText(body.textContent),
    /已发布|已产生客户结果|发布成功/,
    `${deliverable.id} must not invent publication or customer results`,
  );
  if (deliverable.id === "english-blog") {
    assert.match(
      body.getAttribute("lang") ?? "",
      /^en(?:-|$)/i,
      "The English Blog deliverable body must declare an English language",
    );
  }
  const deliveryChecks = many(
    "[data-delivery-check][data-evidence-status]",
    4,
    body,
  );
  assert.equal(
    deliveryChecks.length,
    4,
    `${deliverable.id} must expose exactly four delivery truth checks`,
  );
  assert.deepEqual(
    new Set(
      deliveryChecks.map((check) => check.dataset.deliveryCheck),
    ),
    new Set(["sources", "qa", "approval", "publication-receipt"]),
    `${deliverable.id} must disclose sources, QA, approval, and publication receipt truth`,
  );
  for (const check of deliveryChecks) {
    assert.match(
      check.dataset.evidenceStatus ?? "",
      /^(?:pending|unavailable)$/,
      `${deliverable.id}/${check.dataset.deliveryCheck} must remain pending or unavailable`,
    );
  }
}

click('[data-product-view="results"]', customerNavigation);
one("[data-results-workspace]");
const resultsModule = integratedProduct.modules.find(
  (module) => module.id === "results",
);
for (const section of resultsModule.mainSections) {
  const { panel } = selectSectionPanel("results", section.id);
  const comparisons = [
    ...panel.querySelectorAll("[data-results-comparison]"),
  ];
  const emptyStates = [
    ...panel.querySelectorAll("[data-honest-empty-state]"),
  ];
  assert.equal(
    comparisons.length + emptyStates.length,
    1,
    `${section.id} must render exactly one evidence-backed comparison or honest unavailable state`,
  );
  if (comparisons.length === 1) {
    const comparison = comparisons[0];
    assert.match(
      comparison.dataset.evidenceStatus ?? "",
      /^(?:verified|observation)$/,
      `${section.id} comparison must disclose verified or observational evidence`,
    );
    assert.ok(
      normalizedText(comparison.dataset.evidenceSource),
      `${section.id} comparison must identify its evidence source`,
    );
    one("[data-before]", comparison);
    one("[data-after]", comparison);
  } else {
    const emptyState = emptyStates[0];
    assert.equal(
      emptyState.dataset.evidenceStatus,
      "unavailable",
      `${section.id} empty state must explicitly be unavailable`,
    );
    assert.ok(
      normalizedText(emptyState.textContent).length > 24,
      `${section.id} unavailable state must explain the missing evidence`,
    );
    assertGovernedElement(
      one(
        "[data-product-action][data-governed-destination]",
        emptyState,
      ),
    );
  }
}

const openNativeDetailForAction = (capability) => {
  const moduleDefinition = integratedProduct.modules.find(
    (module) => module.id === capability.primaryModule,
  );
  const owningSections = moduleDefinition.mainSections.filter((section) =>
    Array.from(section.capabilityIds ?? []).includes(capability.id),
  );
  assert.ok(
    owningSections.length > 0,
    `Product contract must land ${capability.primaryAction.id} in a native section`,
  );

  for (const section of owningSections) {
    let { panel } = selectSectionPanel(
      capability.primaryModule,
      section.id,
    );
    const entryIds = Array.from(
      new Set(
        Array.from(
          panel.querySelectorAll("[data-native-entry][data-entry-id]"),
          (entry) => entry.dataset.entryId,
        ),
      ),
    );
    assert.ok(
      entryIds.length > 0,
      `${capability.primaryModule}/${section.id} must expose native customer entries`,
    );

    for (const entryId of entryIds) {
      panel = selectSectionPanel(
        capability.primaryModule,
        section.id,
      ).panel;
      clickElement(
        one(
          `[data-native-entry][data-entry-id="${entryId}"]`,
          panel,
        ),
      );
      panel = one(
        `#${one(
          `[data-section-id="${section.id}"]`,
        ).getAttribute("aria-controls")}`,
        one(`[data-product-surface="${capability.primaryModule}"]`),
      );
      const nativeDetail = one(
        `[data-native-detail][data-entry-id="${entryId}"]`,
        panel,
      );
      assert.doesNotMatch(
        normalizedText(nativeDetail.textContent),
        PRIMARY_EXPERIENCE_FORBIDDEN_COPY,
        `Native entry ${entryId} must read like a product workflow, not a blueprint`,
      );
      assert.equal(
        nativeDetail.querySelectorAll(PRIMARY_INTERNAL_IDENTITY_SELECTOR)
          .length,
        0,
        `Native entry ${entryId} must not expose requirement/capability identities`,
      );
      const entryHashParameters = new URLSearchParams(
        dom.window.location.hash.split("?")[1],
      );
      assert.equal(
        entryHashParameters.get("entry"),
        entryId,
        `Native entry ${entryId} must persist under the entry hash parameter`,
      );
      assert.equal(
        entryHashParameters.has("capability"),
        false,
        "The primary workspace hash must never expose a capability parameter",
      );
      const action = nativeDetail.querySelector(
        `[data-product-action="${capability.primaryAction.id}"]`,
      );
      if (action) {
        assertGovernedElement(action, capability.primaryAction);
        return { action, entryId, nativeDetail };
      }
    }
  }

  assert.fail(
    `No native ${capability.primaryModule} detail exposes product action ${capability.primaryAction.id}`,
  );
};

const coveredCapabilityActions = new Set();
for (const capability of integratedProduct.capabilities) {
  const { action } = openNativeDetailForAction(capability);
  coveredCapabilityActions.add(action.dataset.productAction);
}
assert.deepEqual(
  coveredCapabilityActions,
  new Set(
    integratedProduct.capabilities.map(
      (capability) => capability.primaryAction.id,
    ),
  ),
  "All 13 reviewed abilities must be reachable through native product details and actions",
);

click('[data-product-view="overview"]', customerNavigation);
assert.equal(one("#app").dataset.activeView, "overview");
click('[data-product-view="growth-map"]', customerNavigation);
assert.equal(one("#app").dataset.activeView, "growth-map");
click('[data-product-view="overview"]', customerNavigation);
assert.equal(
  one("#app").dataset.activeView,
  "overview",
  "Repeated module switching must remain responsive",
);

const sampleCapability = integratedProduct.capabilities[0];
const {
  action: sampleAction,
  entryId: sampleEntryId,
} = openNativeDetailForAction(sampleCapability);
const expectedSampleDestination =
  `${sampleCapability.primaryAction.destination.kind}:` +
  sampleCapability.primaryAction.destination.target;
clickElement(sampleAction);
assert.equal(
  one("#app").dataset.activeDestination,
  expectedSampleDestination,
  `Product action ${sampleCapability.primaryAction.id} must resolve to its governed destination`,
);
const sampleHashParameters = new URLSearchParams(
  dom.window.location.hash.split("?")[1],
);
assert.equal(
  sampleHashParameters.get("entry"),
  sampleEntryId,
  "Governed destination must preserve the originating native entry",
);
assert.equal(
  sampleHashParameters.has("capability"),
  false,
  "Governed navigation must not expose a capability hash parameter",
);
assert.equal(
  sampleHashParameters.get("target"),
  expectedSampleDestination,
  "Governed destination must persist its target in the hash",
);
assert.ok(
  many(`[data-governed-target="${expectedSampleDestination}"]`, 1).length > 0,
  "Governed navigation must resolve to a real target surface",
);

const primaryExperienceClone = one("#app").cloneNode(true);
for (const evidenceSurface of primaryExperienceClone.querySelectorAll(
  "[data-secondary-evidence]",
)) {
  evidenceSurface.remove();
}
assert.doesNotMatch(
  normalizedText(primaryExperienceClone.textContent),
  PRIMARY_EXPERIENCE_FORBIDDEN_COPY,
  "Blueprint terminology may only appear inside secondary evidence",
);
assert.equal(
  primaryExperienceClone.querySelectorAll(
    `${PRIMARY_INTERNAL_IDENTITY_SELECTOR}, [data-audit-register]`,
  ).length,
  0,
  "Requirement/capability identities may only appear inside secondary evidence",
);

assert.deepEqual(runtimeErrors, [], `Runtime errors:\n${runtimeErrors.join("\n")}`);

console.log(
  JSON.stringify(
    {
      artifact: artifactFile,
      bytes: Buffer.byteLength(html),
      primaryExperience: "growth-workspace",
      modules: PRODUCT_MODULES.map((module) => module.id),
      capabilities: integratedProduct.capabilities.length,
      connectors: CUSTOMER_CONNECTORS,
      result: "PASS",
    },
    null,
    2,
  ),
);

dom.window.close();
