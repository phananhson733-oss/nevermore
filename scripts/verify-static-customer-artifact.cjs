const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const [artifactArgument, dependencyRootArgument] = process.argv.slice(2);

if (!artifactArgument || !dependencyRootArgument) {
  console.error(
    "Usage: node scripts/verify-static-customer-artifact.cjs <artifact-html> <directory-with-jsdom-dependency>",
  );
  process.exit(1);
}

const artifactFile = path.resolve(artifactArgument);
const dependencyRoot = path.resolve(dependencyRootArgument);
const dependencyRequire = createRequire(path.join(dependencyRoot, "package.json"));
const { JSDOM, VirtualConsole } = dependencyRequire("jsdom");
const html = fs.readFileSync(artifactFile, "utf8");

const forbiddenDependencies = [
  ["external script", /<script\b[^>]*\bsrc=/i],
  ["external stylesheet", /<link\b[^>]*\brel=["']stylesheet["']/i],
  ["CSS import", /@import\s/i],
  ["network fetch", /\bfetch\s*\(/],
  ["worker", /new\s+Worker\s*\(/],
];

for (const [label, pattern] of forbiddenDependencies) {
  assert.equal(pattern.test(html), false, `Artifact must not contain ${label}`);
}

assert.match(html, /data-artifact-build="15\.0-static"/);
assert.match(html, /<style>[\s\S]+<\/style>/);
assert.match(html, /window\.GenGrowthWorkspace/);
assert.match(html, /function startClientWorkspace/);
assert.doesNotMatch(html, /https:\/\/preview\.gengrowth\.ai/i);
assert.match(
  html,
  /\.client-verification-list\.client-verification-list--expanded\s*>\s*button\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  "Expanded Results verification cards must use one full-width column",
);

const runtimeErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", (message) => runtimeErrors.push(`console.error: ${message}`));
virtualConsole.on("jsdomError", (error) => {
  if (!/Not implemented: navigation/.test(error.message)) {
    runtimeErrors.push(`jsdom: ${error.message}`);
  }
});

const dom = new JSDOM(html, {
  url: pathToFileURL(artifactFile).href,
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.scrollTo = () => {};
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
    window.HTMLElement.prototype.focus = function focus() {
      this.setAttribute("data-test-focused", "true");
    };
    window.HTMLElement.prototype.scrollIntoView = () => {};
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => new Promise(() => {}) },
    });
  },
});

const { document, Event, KeyboardEvent } = dom.window;
const exercisedActions = new Set();
const exercisedForms = new Set();

const one = (selector, root = document) => {
  const matches = root.querySelectorAll(selector);
  assert.equal(matches.length, 1, `Expected exactly one match for ${selector}; got ${matches.length}`);
  return matches[0];
};

const many = (selector, minimum = 1, root = document) => {
  const matches = [...root.querySelectorAll(selector)];
  assert.ok(matches.length >= minimum, `Expected at least ${minimum} matches for ${selector}; got ${matches.length}`);
  return matches;
};

const click = (selector, root = document) => {
  const element = one(selector, root);
  assert.notEqual(element.disabled, true, `${selector} must be enabled`);
  if (element.dataset.action) exercisedActions.add(element.dataset.action);
  element.click();
  return element;
};

const clickElement = (element) => {
  assert.ok(element, "Expected an element to click");
  assert.notEqual(element.disabled, true, "Element must be enabled");
  if (element.dataset.action) exercisedActions.add(element.dataset.action);
  element.click();
  return element;
};

const submit = (selector) => {
  const form = one(selector);
  exercisedForms.add(form.dataset.form);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};

const setValue = (selector, value) => {
  const input = one(selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

assert.equal(document.title, "GenGrowth · RelayOps 交互式产品 Artifact");
assert.equal(document.documentElement.lang, "zh-CN");
assert.equal(document.querySelector(".boot-error"), null);
assert.match(one("#route-content > .client-page-header h1").textContent, /今天先做这 3 件事/);
assert.equal(many('nav [data-action="nav"]', 4).length, 4);
assert.equal(many(".v13-priority-item", 3).length, 3);
assert.equal(many(".v13-connection-item", 3).length, 3);
assert.equal(many(".client-asset-strip > div", 4).length, 4);
assert.match(one(".client-profile-meta").textContent, /低置信度 2/);
assert.match(one(".v13-source-panel").textContent, /数据可用/);
assert.match(one(".client-scenario-notice").textContent, /离线演示场景/);
assert.match(one(".client-scenario-notice").textContent, /不代表已连接真实 GSC、GA4/);
assert.match(one(".client-scenario-notice").textContent, /刷新页面后重置/);

const routeExpectations = {
  overview: "今天先做这 3 件事",
  "growth-map": "从全站数据里找到下一批增长机会",
  execution: "直接查看并处理交付物",
  results: "改前、改后与归因边界",
};

for (const [route, title] of Object.entries(routeExpectations)) {
  click(`.primary-nav [data-action="nav"][data-route="${route}"]`);
  assert.match(one("#route-content > .client-page-header h1").textContent, new RegExp(title));
  assert.equal(dom.window.location.hash, `#/${route}`);
}

click('.primary-nav [data-action="nav"][data-route="overview"]');
click('[data-action="toggle-nav"][aria-label="打开导航"]');
assert.equal(one(".client-shell").classList.contains("is-nav-open"), true);
assert.equal(one(".client-menu-button").getAttribute("aria-expanded"), "true");
assert.equal(one(".client-menu-button").getAttribute("aria-controls"), "primary-navigation");
click('.client-nav-scrim[data-action="toggle-nav"]');
assert.equal(one(".client-shell").classList.contains("is-nav-open"), false);

click('.v13-context-panel [data-action="open-profile"]');
assert.match(one("#overlay-title").textContent, /产品与客户画像/);
assert.equal(one("main.workspace").hasAttribute("inert"), true);
assert.equal(one("main.workspace").getAttribute("aria-hidden"), "true");
assert.equal(document.querySelectorAll('a[href]').length, 1);
click('.client-profile-site[data-action="open-page"]');
assert.match(one("#overlay-title").textContent, /RelayOps/);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
assert.equal(one("main.workspace").hasAttribute("inert"), false);

click('.v13-context-panel [data-action="open-profile"]');
click('[data-action="open-profile-evidence"]');
assert.match(one("#overlay-title").textContent, /字段证据/);
assert.equal(many(".client-evidence-list article", 11).length, 11);
assert.match(one(".client-overlay").textContent, /信息冲突/);
assert.match(one(".client-overlay").textContent, /缺少信息|待补充/);
click('[data-action="open-profile-history"]');
assert.match(one("#overlay-title").textContent, /版本历史/);
assert.equal(many('[data-action="open-profile-version"]', 2).length, 2);
const historicalProfileVersion = many('[data-action="open-profile-version"]', 2).find(
  (element) => /历史版本/.test(element.textContent),
);
clickElement(historicalProfileVersion);
assert.match(one("#overlay-title").textContent, /产品画像 v3/);
assert.match(one(".client-overlay").textContent, /只读历史版本/);
click('[data-action="open-profile-history"]');
click('.client-overlay__footer [data-action="open-profile"]');
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('.v13-context-panel [data-action="open-profile"]');
click('[data-action="go-competitors"]');
assert.equal(dom.window.location.hash, "#/growth-map");
assert.equal(one('[data-action="map-tab"][data-tab="competitors"]').getAttribute("aria-selected"), "true");
click('.primary-nav [data-action="nav"][data-route="overview"]');

const findingTask = one('.v13-priority-item[data-kind="finding"]');
clickElement(findingTask);
assert.match(one("#overlay-title").textContent, /证据|审核|待处理|风险|安全/i);
click('[data-action="task-go"][data-kind="finding"]');
assert.equal(one('form[data-form="finding-review"]').id, "finding-review-form");
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('.v13-context-panel [data-action="open-profile"]');
click('[data-action="edit-profile"]');
assert.equal(one('form[data-form="profile-edit"]').id, "profile-edit-form");
setValue('form[data-form="profile-edit"] input[name="champion"]', "客户运营负责人");
submit('form[data-form="profile-edit"]');
assert.match(one("#overlay-title").textContent, /已完成|已保存|已记录|产品画像|回执|审核/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('.v13-context-panel [data-action="open-profile"]');
click('[data-action="open-profile-history"]');
assert.equal(many('[data-action="open-profile-version"]', 3).length, 3);
assert.match(one(".client-version-list").textContent, /产品画像 v5/);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

const overviewSource = many(".v13-connection-item", 3)[0];
clickElement(overviewSource);
assert.match(one("#overlay-title").textContent, /Google|GitHub/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="open-connections"]');
assert.match(one("#overlay-title").textContent, /数据连接/);
assert.equal(many('.client-overlay [data-action="open-source"]', 3).length, 3);
click('.client-overlay [data-action="start-sync"]');
assert.equal(one('form[data-form="sync-run"]').id, "sync-run-form");
submit('form[data-form="sync-run"]');
assert.match(one("#overlay-title").textContent, /更新|同步|已完成|已记录/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('.primary-nav [data-action="nav"][data-route="growth-map"]');
assert.equal(many('.v14-map-tabs [role="tab"]', 3).length, 3);
click('[data-action="map-tab"][data-tab="pages"]');
assert.equal(many('tr[data-action="select-map-page"]', 1).length, 8);

click('[data-action="open-page-filters"]');
assert.equal(one('form[data-form="page-filters"]').id, "page-filter-form");
one('form[data-form="page-filters"] select[name="template"]').value = "editorial-article";
one('form[data-form="page-filters"] select[name="lens"]').value = "webtech";
submit('form[data-form="page-filters"]');
assert.equal(many('tr[data-action="select-map-page"]', 1).length, 2);
click('[data-action="toggle-page-rows"]');
assert.equal(many(".v14-expanded-row", 2).length, 2);
click('[data-action="page-view"][data-view="opportunity"]');
const templateOpportunityRow = one('tr[data-action="select-map-opportunity"][data-id="opp-editorial-template"]');
clickElement(templateOpportunityRow);
assert.match(one(".v13-detail-panel").textContent, /主要 Finding/);
assert.match(one(".v13-detail-panel").textContent, /支撑证据/);
assert.match(one(".v13-detail-panel").textContent, /覆盖范围与限制/);
assert.match(one(".v13-detail-panel").textContent, /下一步决定/);
click('[data-action="decide-opportunity"][data-id="opp-editorial-template"]');
assert.equal(one('form[data-form="opportunity-decision"]').id, "opportunity-decision-form");
one('form[data-form="opportunity-decision"] select[name="decision"]').value = "needs_data";
submit('form[data-form="opportunity-decision"]');
assert.match(one("#overlay-title").textContent, /审核|决定|已记录|回执/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('[data-action="page-view"][data-view="url"]');
click('[data-action="open-page-filters"]');
click('[data-action="clear-page-filters"]');
assert.equal(many('tr[data-action="select-map-page"]', 1).length, 8);

const firstPageRow = many('tr[data-action="select-map-page"]', 1)[0];
const firstPageId = firstPageRow.dataset.id;
clickElement(firstPageRow);
assert.equal(one("[data-selected-page-id]").dataset.selectedPageId, firstPageId);

const nextPageButton = one('[data-action="page-change"][data-kind="pages"][data-delta="1"]');
assert.equal(nextPageButton.disabled, false);
clickElement(nextPageButton);
assert.ok(many('tr[data-action="select-map-page"]', 1).length >= 1);
const secondPageRow = many('tr[data-action="select-map-page"]', 1)[0];
const secondPageId = secondPageRow.dataset.id;
clickElement(secondPageRow);
assert.equal(one("[data-selected-page-id]").dataset.selectedPageId, secondPageId);
assert.notEqual(secondPageId, firstPageId);

setValue('[data-search="pages"]', "security");
click('[data-action="page-search"]');
const securityPageRow = one('tr[data-action="select-map-page"][data-id="url-security"]');
clickElement(securityPageRow);
click('.v14-external-button[data-action="open-page"]');
assert.equal(one('[data-action="evidence-tab"][data-tab="summary"]').getAttribute("aria-selected"), "true");
click('[data-action="review-finding"][data-id="fnd-security-proof-gap"]');
assert.equal(one('form[data-form="finding-review"]').id, "finding-review-form");
submit('form[data-form="finding-review"]');
assert.match(one("#overlay-title").textContent, /审核|已记录|已确认|回执/i);
click('.client-receipt [data-action="open-opportunity"][data-id="opp-proof-request"]');
assert.match(one("#overlay-title").textContent, /安全|证据/);
click('.client-overlay__footer [data-action="create-artifact"][data-id="opp-proof-request"]');
assert.equal(one('form[data-form="artifact-create"]').id, "artifact-create-form");
submit('form[data-form="artifact-create"]');
assert.equal(dom.window.location.hash, "#/execution");
assert.match(one(".client-generated-artifact").textContent, /执行目标/);
assert.match(one(".client-generated-artifact").textContent, /验收条件/);
const createdArtifactId = one(".client-work-item.is-active").dataset.id;
click(`[data-action="open-artifact-history"][data-id="${createdArtifactId}"]`);
assert.match(one("#overlay-title").textContent, /版本历史/);
assert.equal(many('[data-action="open-artifact-revision"]', 1).length, 1);
clickElement(many('[data-action="open-artifact-revision"]', 1)[0]);
assert.match(one(".client-overlay").textContent, /只读快照/);
assert.match(one(".client-overlay").textContent, /门禁快照/);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('.primary-nav [data-action="nav"][data-route="growth-map"]');
setValue('[data-search="pages"]', "");
click('[data-action="page-search"]');

setValue('[data-search="pages"]', "salesforce");
click('[data-action="page-search"]');
assert.ok(many('tr[data-action="select-map-page"]', 1).length >= 1);
setValue('[data-search="pages"]', "");

click('.v14-external-button[data-action="open-page"]');
assert.match(one("#overlay-title").textContent, /Customer|Salesforce|Pricing|Security|Onboarding|Getting Started/i);
click('[data-action="evidence-tab"][data-tab="crawl"]');
assert.equal(one('[data-action="evidence-tab"][data-tab="crawl"]').getAttribute("aria-selected"), "true");
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="page-view"][data-view="cluster"]');
assert.ok(many('tr[data-action="select-map-cluster"]', 1).length >= 1);
const clusterRow = many('tr[data-action="select-map-cluster"]', 1)[0];
clickElement(clusterRow);
assert.match(one(".v13-detail-panel").textContent, /SearchQuery|搜索查询/);
assert.match(one(".v13-detail-panel").textContent, /GenerativeQuery|生成式查询/);
assert.match(one(".v13-detail-panel").textContent, /Coverage Gap|覆盖缺口/);
assert.match(one(".v13-detail-panel").textContent, /Primary CTA|主要 CTA/);
const clusterPageLink = many('[data-action="open-cluster-page"]', 1)[0];
clickElement(clusterPageLink);
assert.equal(one('[data-action="page-view"][data-view="url"]').getAttribute("aria-selected"), "true");

click('[data-action="page-view"][data-view="opportunity"]');
assert.ok(many('tr[data-action="select-map-opportunity"]', 1).length >= 1);
const opportunityRow = one('tr[data-action="select-map-opportunity"][data-id="opp-cluster-consolidation"]');
clickElement(opportunityRow);
click('[data-action="create-artifact"][data-id="opp-cluster-consolidation"]');
assert.equal(one('form[data-form="artifact-create"]').id, "artifact-create-form");
assert.match(one(".client-confirm-object").textContent, /整合|价值实现|搜索意图/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="page-view"][data-view="opportunity"]');
clickElement(one('tr[data-action="select-map-opportunity"][data-id="opp-commercial-intent"]'));
const opportunityPageLink = many('[data-action="open-opportunity-page"]', 1)[0];
clickElement(opportunityPageLink);
assert.equal(one('[data-action="page-view"][data-view="url"]').getAttribute("aria-selected"), "true");

click('[data-action="page-view"][data-view="opportunity"]');
clickElement(one('tr[data-action="select-map-opportunity"][data-id="opp-commercial-intent"]'));
click('[data-action="go-artifact"]');
assert.equal(dom.window.location.hash, "#/execution");
click('.primary-nav [data-action="nav"][data-route="growth-map"]');

click('[data-action="map-tab"][data-tab="keywords"]');
assert.match(one("#panel-map-keywords").textContent, /入库路径/);
click('[data-action="keyword-source"][data-source="competitor_gap"]');
assert.equal(one('[data-action="keyword-source"][data-source="competitor_gap"]').classList.contains("is-active"), true);
assert.ok(many('[data-action="select-map-keyword"]', 1).length >= 1);
const keywordButton = many('[data-action="select-map-keyword"]', 1)[0];
const keywordId = keywordButton.dataset.id;
clickElement(keywordButton);
assert.ok(document.querySelector(`[data-action="open-keyword"][data-id="${keywordId}"]`));
click(`.v13-detail-actions [data-action="open-keyword"][data-id="${keywordId}"]`);
assert.match(one("#overlay-title").textContent, /onboarding|customer|software|automation/i);
click('.client-overlay [data-action="go-keyword-artifact"]');
assert.ok(["#/execution", "#/growth-map"].includes(dom.window.location.hash));
if (dom.window.location.hash === "#/growth-map") {
  assert.match(one("#overlay-title").textContent, /交付物|已记录|尚无/i);
  click('.client-overlay__header .icon-button[data-action="close-overlay"]');
} else {
  click('.primary-nav [data-action="nav"][data-route="growth-map"]');
  click('[data-action="map-tab"][data-tab="keywords"]');
}
click('[data-action="add-keyword"]');
assert.equal(one('form[data-form="keyword-add"]').id, "keyword-add-form");
setValue('form[data-form="keyword-add"] input[name="text"]', "customer onboarding risk signals");
setValue('form[data-form="keyword-add"] textarea[name="note"]', "Customer interview and Search Console opportunity.");
submit('form[data-form="keyword-add"]');
assert.match(one("#overlay-title").textContent, /已完成|已入库|已记录|回执|Keyword/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('[data-action="keyword-source"][data-source="all"]');
setValue('[data-search="keywords"]', "customer onboarding risk signals");
assert.match(one("#panel-map-keywords").textContent, /未连接/);
setValue('[data-search="keywords"]', "");

click('[data-action="map-tab"][data-tab="competitors"]');
assert.ok(many('[data-action="select-map-competitor"]', 1).length >= 1);
const competitorStatusFilter = one('select[data-filter="competitors"]');
competitorStatusFilter.value = "candidate";
competitorStatusFilter.dispatchEvent(new Event("change", { bubbles: true }));
const competitorButton = one('[data-action="select-map-competitor"][data-id="cmp-guidecx"]');
const competitorId = competitorButton.dataset.id;
clickElement(competitorButton);
assert.ok(document.querySelector(`[data-action="open-competitor"][data-id="${competitorId}"]`));
click(`.v13-detail-actions [data-action="open-competitor"][data-id="${competitorId}"]`);
assert.match(one("#overlay-title").textContent, /GuideCX/i);
click('.client-overlay [data-action="review-competitor"]');
assert.equal(one('form[data-form="competitor-review"]').id, "competitor-review-form");
submit('form[data-form="competitor-review"]');
assert.match(one("#overlay-title").textContent, /审核|已记录|已确认|回执/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="add-competitor"]');
setValue('form[data-form="competitor-add"] input[name="name"]', "Dockline");
setValue('form[data-form="competitor-add"] input[name="domain"]', "dockline.example");
setValue('form[data-form="competitor-add"] textarea[name="note"]', "Repeated SERP overlap in the target market.");
submit('form[data-form="competitor-add"]');
assert.match(one("#overlay-title").textContent, /竞品|已完成|已入库|已记录|已创建|回执|Competitor/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
setValue('[data-search="competitors"]', "Dockline");
assert.match(one("#panel-map-competitors").textContent, /数据不足/);
assert.doesNotMatch(one("#panel-map-competitors").textContent, /null%/);
setValue('[data-search="competitors"]', "");

click('.primary-nav [data-action="nav"][data-route="execution"]');
click('[data-action="artifact-filter"][data-filter="metadata"]');
assert.equal(many('[data-action="select-artifact"]', 1).length, 1);
const artifactButton = one('[data-action="select-artifact"][data-id="art-meta-onboarding"]');
clickElement(artifactButton);
assert.ok(one(".client-document-body.v13-document-body").textContent.trim().length > 80);
const shareButton = one('[data-action="share-artifact"]');
clickElement(shareButton);
assert.equal(one('form[data-form="artifact-share"]').id, "artifact-share-form");
assert.match(one('form[data-form="artifact-share"]').textContent, /不会创建真实可访问链接/);
submit('form[data-form="artifact-share"]');
assert.match(one("#overlay-title").textContent, /分享|已完成|已记录|回执/i);
assert.match(one(".client-receipt").textContent, /不可外部访问/);
assert.match(one(".client-receipt code").textContent, /^local-artifact:\/\//);
click('[data-action="copy-receipt-link"]');
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('.v13-quality-link[data-action="open-opportunity"]');
assert.match(one("#overlay-title").textContent, /商业|Search|Generative|客户|Onboarding/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="approve-artifact"][data-id="art-meta-onboarding"]');
assert.equal(one('form[data-form="artifact-approve"]').id, "artifact-approve-form");
one('form[data-form="artifact-approve"] input[name="confirmed"]').checked = true;
submit('form[data-form="artifact-approve"]');
assert.match(one("#overlay-title").textContent, /审核|已记录|已确认|回执/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="publish-artifact"][data-id="art-meta-onboarding"]');
assert.equal(one('form[data-form="artifact-publish"]').id, "artifact-publish-form");
one('form[data-form="artifact-publish"] input[name="confirmed"]').checked = true;
submit('form[data-form="artifact-publish"]');
assert.match(one("#overlay-title").textContent, /发布|已完成|已记录|回执/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="open-receipt"][data-id="art-meta-onboarding"]');
assert.match(one("#overlay-title").textContent, /模拟发布回执/);
assert.match(one(".client-receipt").textContent, /没有发生真实 CMS、GitHub 或第三方服务写入/);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

click('[data-action="edit-artifact"][data-id="art-meta-onboarding"]');
assert.equal(one('form[data-form="artifact-edit"]').id, "artifact-edit-form");
setValue('form[data-form="artifact-edit"] textarea[name="revisionSummary"]', "Clarify the implementation proof and preserve the customer-visible search intent.");
submit('form[data-form="artifact-edit"]');
assert.match(one("#overlay-title").textContent, /审核|Revision|已记录|回执/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
assert.match(one(".client-approval-invalidated").textContent, /旧版批准已失效/);
assert.match(one(".v13-document-kicker").textContent, /Revision 3/);
assert.match(one(".client-revision-note").textContent, /implementation proof/);

click('.primary-nav [data-action="nav"][data-route="results"]');
assert.equal(many('.client-results-tabs [role="tab"]', 3).length, 3);
assert.equal(many(".client-recheck-values", 3).length, 3);
assert.match(one(".client-result-overview").textContent, /旧值/);
assert.match(one(".client-result-overview").textContent, /验收值/);
assert.match(one(".client-result-overview").textContent, /回执不等于效果/);
assert.match(one(".client-change-timeline").textContent, /动作回执与结果时间线/);
const auditEventButton = many('[data-action="open-audit-event"]', 1)[0];
clickElement(auditEventButton);
assert.match(one("#overlay-title").textContent, /复查|结果|发布|观察|记录/);
assert.match(one(".client-overlay").textContent, /事件 ID/);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('[data-action="result-tab"][data-tab="pages"]');
assert.ok(many('[data-action="open-result-page"]', 1).length >= 1);
assert.match(one(".client-result-page-table").textContent, /来源/);
assert.match(one(".client-result-page-table").textContent, /更新/);
const resultButton = many('[data-action="open-result-page"]', 1)[0];
clickElement(resultButton);
assert.match(one("#overlay-title").textContent, /Customer|Pricing|Onboarding|RelayOps|Salesforce/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('[data-action="result-tab"][data-tab="campaigns"]');
assert.ok(many('[data-action="open-campaign"]', 1).length >= 1);
assert.match(one(".client-campaign-table").textContent, /来源/);
assert.match(one(".client-campaign-table").textContent, /更新/);
const campaignButton = many('[data-action="open-campaign"]', 1)[0];
clickElement(campaignButton);
assert.match(one("#overlay-title").textContent, /onboarding|linkedin|newsletter|partner|referral/i);
click('.client-overlay__header .icon-button[data-action="close-overlay"]');
click('[data-action="share-report"]');
assert.equal(one('form[data-form="report-share"]').id, "report-share-form");
assert.match(one('form[data-form="report-share"]').textContent, /不会创建真实可访问链接/);
submit('form[data-form="report-share"]');
assert.match(one("#overlay-title").textContent, /分享|已完成|已记录|回执/i);
assert.match(one(".client-receipt").textContent, /不可外部访问/);
assert.match(one(".client-receipt code").textContent, /^local-artifact:\/\//);
click('[data-action="copy-receipt-link"]');
click('.client-overlay__header .icon-button[data-action="close-overlay"]');

document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

const actionValues = new Set(
  [...html.matchAll(/data-action=(?:\\?["'])([^"'\\]+)(?:\\?["'])/g)]
    .map((match) => match[1])
    .filter((value) => !value.includes("${")),
);
const handledActions = new Set(
  [...html.matchAll(/action === '([^']+)'/g)].map((match) => match[1]),
);
const missingActionHandlers = [...actionValues].filter(
  (action) => !handledActions.has(action),
);
assert.deepEqual(missingActionHandlers, [], "Every declared data-action needs a handler");

const formValues = new Set(
  [...html.matchAll(/data-form=\\?["']([^"'\\]+)\\?["']/g)].map(
    (match) => match[1],
  ),
);
const handledForms = new Set(
  [...html.matchAll(/form\.dataset\.form === '([^']+)'/g)].map(
    (match) => match[1],
  ),
);
const missingFormHandlers = [...formValues].filter(
  (form) => !handledForms.has(form),
);
assert.deepEqual(missingFormHandlers, [], "Every declared data-form needs a handler");

const unexercisedActions = [...actionValues].filter(
  (action) => !exercisedActions.has(action),
);
const unexercisedForms = [...formValues].filter(
  (form) => !exercisedForms.has(form),
);

assert.deepEqual(unexercisedActions, [], "Every declared data-action must be exercised");
assert.deepEqual(unexercisedForms, [], "Every declared data-form must be exercised");
assert.deepEqual(runtimeErrors, [], `Runtime errors:\n${runtimeErrors.join("\n")}`);

console.log(
  JSON.stringify(
    {
      artifact: artifactFile,
      bytes: Buffer.byteLength(html),
      primaryRoutes: Object.keys(routeExpectations).length,
      declaredActions: actionValues.size,
      handledForms: handledForms.size,
      exercisedActions: exercisedActions.size,
      unexercisedActions,
      exercisedForms: exercisedForms.size,
      unexercisedForms,
      urlPortfolioRowsExercised: 2,
      result: "PASS",
    },
    null,
    2,
  ),
);

dom.window.close();
