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

assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath: artifactFile,
  label: "Keyword audit Artifact",
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
    `Keyword audit Artifact must not contain ${label}`,
  );
}

assert.doesNotMatch(
  html,
  /(?:\bSignalFrame\b|signalframe-mvp-app|@sf\/)/i,
  "Keyword audit Artifact must not expose a compatibility package name",
);
assert.doesNotMatch(
  html,
  /(?:\/Users\/|\/home\/|\/var\/folders\/|\/private\/(?:tmp|var)\/|[A-Za-z]:\\Users\\|\.codex[/\\]visualizations|file:\/\/)/i,
  "Keyword audit Artifact must not expose an absolute workstation path",
);
assert.doesNotMatch(
  html,
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^/\s:@]+:[^@\s/]+@|https?:\/\/[^/\s:@]+:[^@\s/]+@|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/,
  "Keyword audit Artifact must not contain credentials",
);
assert.doesNotMatch(
  html,
  /\b(?:showToast|createToast|toast\s*\()/i,
  "Visible actions must resolve to governed views, not a generic toast",
);

assert.match(html, /data-keyword-audit-build="1\.0-static"/);
assert.match(html, /<html\b[^>]*\blang="zh-CN"/i);
assert.match(html, /关键词库与 SEO\/GEO 能力需求审计/);
assert.match(html, /审核通过不等于已上线/);
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

const { document, Event, HashChangeEvent } = dom.window;
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
const click = (selector, root = document) => {
  const element = one(selector, root);
  assert.notEqual(element.disabled, true, `${selector} must be enabled`);
  const previousHash = dom.window.location.hash;
  element.click();
  if (dom.window.location.hash !== previousHash) {
    dom.window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  return element;
};
const selectFilter = (filter, value) => {
  const control = one(`select[data-filter="${filter}"]`);
  control.value = value;
  assert.equal(
    control.value,
    value,
    `Filter ${filter} must expose option ${value}`,
  );
  const previousHash = dom.window.location.hash;
  control.dispatchEvent(new Event("change", { bubbles: true }));
  if (dom.window.location.hash !== previousHash) {
    dom.window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
};
const visibleRequirementButtons = () =>
  many("[data-requirement-id]", 1).filter(
    (element) =>
      element.closest('[aria-hidden="true"]') === null &&
      element.hidden !== true,
  );
const assertRequirementSetMatches = (predicate, label) => {
  const buttons = visibleRequirementButtons();
  assert.ok(buttons.length > 0, `${label} must keep at least one requirement`);
  for (const button of buttons) {
    assert.ok(
      predicate(button),
      `${label} returned an out-of-scope requirement ${button.dataset.requirementId}`,
    );
  }
};

const audit = dom.window.NevermoreKeywordAudit;
assert.ok(audit && typeof audit === "object", "Audit data must be available");
assert.equal(audit.requirements.length, 13, "All 13 requirements must be present");
assert.deepEqual(
  Array.from(audit.requirements, (item) => item.id),
  Array.from({ length: 13 }, (_, index) => index + 1),
  "Requirement ids must cover 1 through 13 exactly once",
);
assert.deepEqual(
  new Set(Array.from(audit.requirements, (item) => item.decision)),
  new Set(["adopt", "rewrite", "defer"]),
  "Audit decisions must include adopt, rewrite, and defer",
);
assert.deepEqual(
  Array.from(audit.customerVisibleConnectors),
  ["GSC", "GA4", "GitHub"],
  "Only GSC, GA4, and GitHub may be customer-visible connectors",
);
const requirementNine = audit.requirements.find((item) => item.id === 9);
assert.deepEqual(
  Array.from(requirementNine.completionFlags, (flag) => flag.id),
  ["rank_history_complete", "receipt_backed_results_complete"],
  "Requirement 9 must preserve independent history and receipt-backed result gates",
);
const requirementEleven = audit.requirements.find((item) => item.id === 11);
assert.equal(requirementEleven.decision, "defer");
assert.equal(
  requirementEleven.stage.includes("stage-1"),
  false,
  "Backlink provider integration must remain outside the current launch stage",
);
const requirementTwelve = audit.requirements.find((item) => item.id === 12);
assert.equal(
  requirementTwelve.targetEvidenceMode,
  "observation",
  "GEO evidence must remain an observation rather than causal attribution",
);

assert.equal(document.title, "Nevermore · 关键词增长治理需求审计");
assert.equal(document.documentElement.lang, "zh-CN");
assert.equal(document.querySelector(".boot-error"), null);
assert.equal(document.querySelectorAll(".toast, [data-toast]").length, 0);
one('nav[aria-label="审计视图"]');
assert.equal(one("#app").dataset.ready, "true");
one("main#audit-content");
one('aside[aria-label="需求清单"]');
one('article[aria-live="polite"]');
one('aside[aria-label="影响与证据"]');
assert.equal(many('nav[aria-label="审计视图"] [data-view]', 4).length, 4);
assert.equal(many("[data-requirement-id]", 13).length, 13);

click('[data-requirement-id="2"]');
assert.match(
  one("[data-requirement-detail]").textContent,
  /重复|蚕食|主词|支持词|Primary|Supporting/i,
  "Requirement 2 must render duplicate-governance detail",
);
assert.equal(new URLSearchParams(dom.window.location.hash.split("?")[1]).get("item"), "2");

click('[data-requirement-id="9"]');
const requirementNineText = one("[data-requirement-detail]").textContent;
assert.match(requirementNineText, /排名历史|Rank History|rank_history_complete/i);
assert.match(
  requirementNineText,
  /回执.*结果|效果追踪|receipt_backed_results_complete/i,
);

selectFilter("decision", "rewrite");
assertRequirementSetMatches(
  (button) => button.dataset.decision === "rewrite",
  "Rewrite filter",
);
selectFilter("decision", "adopt");
assertRequirementSetMatches(
  (button) => button.dataset.decision === "adopt",
  "Adopt filter",
);
selectFilter("decision", "rewrite");
assertRequirementSetMatches(
  (button) => button.dataset.decision === "rewrite",
  "Repeated rewrite filter",
);
selectFilter("decision", "all");
assert.equal(
  visibleRequirementButtons().length,
  13,
  "All filter must restore all requirements",
);

selectFilter("module", "growth-map");
assertRequirementSetMatches(
  (button) =>
    (button.dataset.modules || "")
      .split(/\s*,\s*|\s+/)
      .includes("growth-map"),
  "Growth Map module filter",
);
selectFilter("module", "all");
assert.equal(
  visibleRequirementButtons().length,
  13,
  "Clearing the module filter must restore all requirements",
);

click(
  'nav[aria-label="审计视图"] [data-action="set-view"][data-view="modules"]',
);
assert.equal(one("#app").dataset.activeView, "modules");
assert.ok(many("[data-module-id]", 4).length >= 4);
click(
  'nav[aria-label="审计视图"] [data-action="set-view"][data-view="requirements"]',
);
assert.equal(one("#app").dataset.activeView, "requirements");
assert.equal(visibleRequirementButtons().length, 13);
click(
  'nav[aria-label="审计视图"] [data-action="set-view"][data-view="stages"]',
);
assert.equal(one("#app").dataset.activeView, "stages");
assert.match(one("main#audit-content").textContent, /范围|Scope/i);
assert.match(one("main#audit-content").textContent, /依赖|Dependencies/i);
assert.match(one("main#audit-content").textContent, /退出门槛|Exit Gate/i);
assert.match(one("main#audit-content").textContent, /不包含|Exclusions/i);
assert.ok(many("[data-stage-id]", 3).length >= 3);
click(
  'nav[aria-label="审计视图"] [data-action="set-view"][data-view="acceptance"]',
);
assert.equal(one("#app").dataset.activeView, "acceptance");
assert.ok(many("[data-acceptance-layer]", 7).length >= 7);
click(
  'nav[aria-label="审计视图"] [data-action="set-view"][data-view="stages"]',
);
assert.equal(one("#app").dataset.activeView, "stages");

dom.window.location.hash =
  "#/requirements?item=2&decision=rewrite&module=growth-map";
dom.window.dispatchEvent(new HashChangeEvent("hashchange"));
assert.equal(
  one(
    'nav[aria-label="审计视图"] [data-action="set-view"][data-view="requirements"]',
  ).getAttribute("aria-current") === "page" ||
    one(
      'nav[aria-label="审计视图"] [data-action="set-view"][data-view="requirements"]',
    ).getAttribute("aria-selected") === "true" ||
    one(
      'nav[aria-label="审计视图"] [data-action="set-view"][data-view="requirements"]',
    ).classList.contains("is-active"),
  true,
  "Hash restoration must activate the requirements view",
);
assert.equal(
  one('[data-requirement-id="2"]').getAttribute("aria-current") === "true" ||
    one('[data-requirement-id="2"]').getAttribute("aria-selected") === "true" ||
    one('[data-requirement-id="2"]').classList.contains("is-active"),
  true,
  "Hash restoration must activate requirement 2",
);
assert.match(one("[data-requirement-detail]").textContent, /重复|蚕食|主词|支持词/i);

assert.deepEqual(runtimeErrors, [], `Runtime errors:\n${runtimeErrors.join("\n")}`);

console.log(
  JSON.stringify(
    {
      artifact: artifactFile,
      bytes: Buffer.byteLength(html),
      requirements: audit.requirements.length,
      views: many('nav[aria-label="审计视图"] [data-view]', 4).length,
      decisions: [
        ...new Set(Array.from(audit.requirements, (item) => item.decision)),
      ],
      result: "PASS",
    },
    null,
    2,
  ),
);

dom.window.close();
