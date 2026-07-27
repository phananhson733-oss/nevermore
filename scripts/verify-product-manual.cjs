"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const defaultManualFile = path.join(
  repoRoot,
  "docs/artifacts/GenGrowth-Product-Manual.html",
);
const defaultArtifactFile = path.join(
  repoRoot,
  "docs/artifacts/GenGrowth-Interactive-Artifact.html",
);
const defaultWorkspaceDataFile =
  "/Users/wzb/.codex/visualizations/2026/07/20/019f7ff0-3874-7623-90f3-1ebdea7c313f/workspace-data.js";
const defaultDependencyRoot =
  "/tmp/gengrowth-artifact-jsdom-20260723";

const [
  manualArgument = defaultManualFile,
  dependencyRootArgument = defaultDependencyRoot,
  artifactArgument = defaultArtifactFile,
  workspaceDataArgument = defaultWorkspaceDataFile,
] = process.argv.slice(2);

const manualFile = path.resolve(manualArgument);
const dependencyRoot = path.resolve(dependencyRootArgument);
const artifactFile = path.resolve(artifactArgument);
const workspaceDataFile = path.resolve(workspaceDataArgument);

function readRequiredFile(file, label) {
  assert.equal(
    fs.existsSync(file),
    true,
    `${label} does not exist: ${file}`,
  );
  return fs.readFileSync(file, "utf8");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueAttributeValues(document, attribute) {
  const values = [...document.querySelectorAll(`[${attribute}]`)].map(
    (element) => normalizeText(element.getAttribute(attribute)),
  );
  assert.equal(
    values.some((value) => value.length === 0),
    false,
    `${attribute} values must not be empty`,
  );
  const duplicates = sorted(
    values.filter((value, index) => values.indexOf(value) !== index),
  );
  assert.deepEqual(
    [...new Set(duplicates)],
    [],
    `${attribute} index entries must be unique`,
  );
  return new Set(values);
}

function assertExactSet(actual, expected, label) {
  const missing = sorted([...expected].filter((value) => !actual.has(value)));
  const extra = sorted([...actual].filter((value) => !expected.has(value)));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    `${label} must match the current Artifact exactly`,
  );
}

function literalDataActions(artifactHtml) {
  return new Set(
    [...artifactHtml.matchAll(/data-action=(?:\\?["'])([^"'\\]+)(?:\\?["'])/g)]
      .map((match) => match[1])
      .filter((value) => value && !value.includes("${")),
  );
}

function handledActions(artifactHtml) {
  return new Set(
    [...artifactHtml.matchAll(/\baction\s*===\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    ),
  );
}

function literalDataForms(artifactHtml) {
  return new Set(
    [...artifactHtml.matchAll(/data-form=\\?["']([^"'\\]+)\\?["']/g)].map(
      (match) => match[1],
    ),
  );
}

function handledForms(artifactHtml) {
  return new Set(
    [
      ...artifactHtml.matchAll(
        /\bform\.dataset\.form\s*===\s*["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]),
  );
}

function executeWorkspaceData(workspaceSource, filename) {
  const sandbox = {
    window: {},
  };
  vm.runInNewContext(workspaceSource, sandbox, {
    filename,
    timeout: 5_000,
  });
  const workspace = sandbox.window.GenGrowthWorkspace;
  assert.ok(
    workspace && Array.isArray(workspace.dataSources),
    "workspace-data.js must expose window.GenGrowthWorkspace.dataSources",
  );
  return workspace;
}

function workspaceFromArtifact(artifactHtml) {
  const scriptBlocks = [
    ...artifactHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
  ].map((match) => match[1]);
  const workspaceScript = scriptBlocks.find((script) =>
    script.includes("attachGenGrowthWorkspace"),
  );
  assert.ok(
    workspaceScript,
    "Could not find the embedded GenGrowth workspace data in the Artifact",
  );
  return executeWorkspaceData(workspaceScript, artifactFile);
}

function resolveWorkspace(artifactHtml) {
  if (fs.existsSync(workspaceDataFile)) {
    return executeWorkspaceData(
      fs.readFileSync(workspaceDataFile, "utf8"),
      workspaceDataFile,
    );
  }
  return workspaceFromArtifact(artifactHtml);
}

function loadJSDOM() {
  const candidates = [
    dependencyRoot,
    defaultDependencyRoot,
    repoRoot,
  ].filter((candidate, index, values) => values.indexOf(candidate) === index);

  for (const candidate of candidates) {
    const packageFile = path.join(candidate, "package.json");
    if (!fs.existsSync(packageFile)) continue;
    try {
      const dependencyRequire = createRequire(packageFile);
      return dependencyRequire("jsdom");
    } catch {
      // Try the next known dependency root.
    }
  }

  assert.fail(
    `jsdom is required. Pass its dependency root as argument 2 (tried: ${candidates.join(", ")})`,
  );
}

function isHidden(element) {
  let current = element;
  while (current && current.nodeType === 1) {
    const className =
      typeof current.className === "string" ? current.className : "";
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      current.getAttribute("data-hidden") === "true" ||
      current.style?.display === "none" ||
      current.style?.visibility === "hidden" ||
      /(?:^|\s)(?:is-hidden|is-filtered|is-filtered-out|u-hidden)(?:\s|$)/.test(
        className,
      )
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function dispatchInput(window, element, value) {
  element.value = value;
  element.dispatchEvent(
    new window.Event("input", { bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(
    new window.Event("change", { bubbles: true, cancelable: true }),
  );
}

function modeValue(element) {
  return (
    element.getAttribute("data-manual-mode") ||
    element.getAttribute("data-mode-filter") ||
    element.getAttribute("data-audience-filter") ||
    element.value ||
    ""
  ).toLowerCase();
}

function isActiveControl(element) {
  return (
    element.getAttribute("aria-pressed") === "true" ||
    element.getAttribute("aria-selected") === "true" ||
    element.getAttribute("data-active") === "true" ||
    element.classList.contains("is-active") ||
    element.classList.contains("active")
  );
}

function modeSignature(document) {
  const rootMode =
    document.documentElement.getAttribute("data-manual-mode") ||
    document.body.getAttribute("data-manual-mode") ||
    document.documentElement.getAttribute("data-mode") ||
    document.body.getAttribute("data-mode") ||
    "";
  const audienceItems = [
    ...document.querySelectorAll(
      [
        "[data-manual-audience]",
        "[data-audience]",
        "[data-content-mode]",
        "[data-mode-content]",
      ].join(","),
    ),
  ];
  return JSON.stringify({
    rootMode,
    hidden: audienceItems.map((item) => isHidden(item)),
    active: [
      ...document.querySelectorAll(
        "[data-manual-mode],[data-mode-filter],[data-audience-filter]",
      ),
    ].map((item) => isActiveControl(item)),
  });
}

function elementLabel(element) {
  return normalizeText(
    element.textContent ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title"),
  );
}

function findControl(document, selectors) {
  for (const selector of selectors) {
    const match = document.querySelector(selector);
    if (match) return match;
  }
  return null;
}

async function nextTurn() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const manualHtml = readRequiredFile(manualFile, "Product manual");
  const artifactHtml = readRequiredFile(
    artifactFile,
    "Interactive Artifact",
  );
  const workspace = resolveWorkspace(artifactHtml);
  const { JSDOM, VirtualConsole } = loadJSDOM();

  const forbiddenDocumentPatterns = [
    ["external script", /<script\b[^>]*\bsrc\s*=/i],
    [
      "external stylesheet",
      /<link\b[^>]*\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i,
    ],
    ["CSS import", /@import\s/i],
    [
      "remote CSS resource",
      /\burl\(\s*["']?(?:https?:)?\/\//i,
    ],
  ];
  for (const [label, pattern] of forbiddenDocumentPatterns) {
    assert.equal(
      pattern.test(manualHtml),
      false,
      `Product manual must not contain ${label}`,
    );
  }

  const inlineScripts = [
    ...manualHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
  ]
    .map((match) => match[1])
    .join("\n");
  const forbiddenRuntimePatterns = [
    ["network fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\s*\(/],
    ["EventSource", /\bEventSource\s*\(/],
    ["Web Worker", /\bnew\s+(?:Shared)?Worker\s*\(/],
    ["service worker", /\bserviceWorker\s*\.\s*register\s*\(/],
    ["dynamic import", /\bimport\s*\(/],
    ["module import", /\bimport\s+[^;]+?\s+from\s+["']/],
  ];
  for (const [label, pattern] of forbiddenRuntimePatterns) {
    assert.equal(
      pattern.test(inlineScripts),
      false,
      `Product manual must not contain ${label}`,
    );
  }

  const actionLiterals = literalDataActions(artifactHtml);
  const actionHandlers = handledActions(artifactHtml);
  const artifactActions = new Set([
    ...actionLiterals,
    ...actionHandlers,
  ]);
  assert.ok(
    artifactActions.size > 0,
    "The current Artifact must expose an action set",
  );
  assert.deepEqual(
    sorted(
      [...actionLiterals].filter((action) => !actionHandlers.has(action)),
    ),
    [],
    "Every literal Artifact data-action must have a handleAction branch",
  );

  const formLiterals = literalDataForms(artifactHtml);
  const formHandlers = handledForms(artifactHtml);
  const artifactForms = new Set([...formLiterals, ...formHandlers]);
  assert.ok(
    artifactForms.size > 0,
    "The current Artifact must expose a form set",
  );
  assert.deepEqual(
    sorted([...formLiterals].filter((form) => !formHandlers.has(form))),
    [],
    "Every literal Artifact data-form must have a handleForm branch",
  );

  const workspaceSourceIds = new Set(
    workspace.dataSources.map((source) => source.id),
  );
  assert.equal(
    workspaceSourceIds.size,
    workspace.dataSources.length,
    "Workspace data source ids must be unique",
  );

  const runtimeErrors = [];
  let printCalls = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", (message) =>
    runtimeErrors.push(`console.error: ${message}`),
  );
  virtualConsole.on("jsdomError", (error) => {
    if (!/Not implemented: navigation/.test(error.message)) {
      runtimeErrors.push(`jsdom: ${error.message}`);
    }
  });

  const dom = new JSDOM(manualHtml, {
    url: pathToFileURL(manualFile).href,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.addEventListener("error", (event) => {
        runtimeErrors.push(
          `window.error: ${event.error?.stack || event.message || "unknown error"}`,
        );
      });
      window.addEventListener("unhandledrejection", (event) => {
        runtimeErrors.push(
          `unhandledrejection: ${event.reason?.stack || event.reason || "unknown rejection"}`,
        );
      });
      window.scrollTo = () => {};
      window.print = () => {
        printCalls += 1;
      };
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
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.document.execCommand = () => true;
      if (!window.CSS) window.CSS = {};
      if (!window.CSS.escape) {
        window.CSS.escape = (value) =>
          String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }
      class ImmediateIntersectionObserver {
        constructor(callback) {
          this.callback = callback;
        }

        observe(target) {
          this.callback(
            [
              {
                target,
                isIntersecting: true,
                intersectionRatio: 1,
                boundingClientRect: target.getBoundingClientRect(),
              },
            ],
            this,
          );
        }

        unobserve() {}

        disconnect() {}

        takeRecords() {
          return [];
        }
      }
      window.IntersectionObserver = ImmediateIntersectionObserver;
      window.ResizeObserver = class ResizeObserver {
        observe() {}

        unobserve() {}

        disconnect() {}
      };
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.resolve(),
        },
      });
    },
  });

  if (dom.window.document.readyState !== "complete") {
    await new Promise((resolve) => {
      dom.window.addEventListener("load", resolve, { once: true });
    });
  }
  await nextTurn();

  const { document } = dom.window;
  assert.equal(
    document.documentElement.getAttribute("lang"),
    "zh-CN",
    "Product manual html lang must be zh-CN",
  );
  assert.match(
    normalizeText(document.title),
    /GenGrowth/i,
    "Product manual title must identify GenGrowth",
  );
  assert.match(
    normalizeText(document.title),
    /产品(?:说明书|手册)|产品全景/i,
    "Product manual title must identify itself as a product manual",
  );
  assert.ok(
    document.querySelector('meta[charset="UTF-8" i]'),
    "Product manual must declare UTF-8",
  );
  assert.ok(
    document.querySelector('meta[name="viewport"]'),
    "Product manual must declare a responsive viewport",
  );
  assert.equal(
    document.querySelectorAll("h1").length,
    1,
    "Product manual must have exactly one h1",
  );

  const bodyText = normalizeText(document.body.textContent);
  const chineseCharacterCount = (bodyText.match(/[\u3400-\u9fff]/g) || [])
    .length;
  assert.ok(
    bodyText.length >= 12_000,
    `Product manual must be detailed (got ${bodyText.length} text characters)`,
  );
  assert.ok(
    chineseCharacterCount >= 3_000,
    `Product manual must be Chinese-first (got ${chineseCharacterCount} Chinese characters)`,
  );

  const semanticHeadings = [
    ...document.querySelectorAll(
      "h1,h2,h3,h4,h5,h6,summary,[data-manual-section-title]",
    ),
  ].map((element) => normalizeText(element.textContent));
  const requiredChapters = [
    ["产品定义与优势", /产品(?:定位|定义|全景|总览)|核心优势|产品优势/],
    ["购买方演示路线", /购买方.*(?:演示|讲解)|演示(?:路线|脚本|路径)/],
    ["对象模型与生命周期", /对象(?:模型|关系|链路)|业务对象|完整闭环|生命周期/],
    ["概览 Overview", /(?:概览.*Overview|Overview.*概览|^概览$)/i],
    ["产品画像 / ICP", /产品画像|Product Profile|ICP/i],
    ["增长地图", /增长地图|Growth Map/i],
    ["执行中心", /执行中心|Execution/i],
    ["效果追踪", /效果追踪|Results|结果与归因/i],
    ["数据连接", /数据连接|Connections/i],
    ["弹窗与审计", /弹窗.*审计|审计.*弹窗|Overlay|Audit/i],
    ["数据来源", /数据来源|来源字典|Source Dictionary/i],
    ["Action / 按钮索引", /Action|按钮索引|动作索引|交互索引/i],
    ["Form / 表单索引", /Form|表单索引|表单与写操作/i],
    ["当前与未来能力边界", /能力边界|当前.*未来|未来.*当前/],
    ["场景真实性", /场景真实性|场景边界|Demo.*边界|演示数据/i],
  ];
  const missingChapters = requiredChapters
    .filter(([, pattern]) => !semanticHeadings.some((heading) => pattern.test(heading)))
    .map(([label]) => label);
  assert.deepEqual(
    missingChapters,
    [],
    "Product manual is missing required semantic chapters",
  );

  const manualActions = uniqueAttributeValues(document, "data-action-id");
  const manualForms = uniqueAttributeValues(document, "data-form-id");
  const manualSources = uniqueAttributeValues(document, "data-source-id");
  assertExactSet(manualActions, artifactActions, "Action index");
  assertExactSet(manualForms, artifactForms, "Form index");
  assertExactSet(manualSources, workspaceSourceIds, "Data source index");

  for (const element of document.querySelectorAll("[data-action-id]")) {
    assert.ok(
      normalizeText(element.textContent).length >=
        element.getAttribute("data-action-id").length + 12,
      `Action ${element.getAttribute("data-action-id")} needs a useful explanation`,
    );
  }
  for (const element of document.querySelectorAll("[data-form-id]")) {
    assert.ok(
      normalizeText(element.textContent).length >=
        element.getAttribute("data-form-id").length + 16,
      `Form ${element.getAttribute("data-form-id")} needs a useful explanation`,
    );
  }
  for (const element of document.querySelectorAll("[data-source-id]")) {
    assert.ok(
      normalizeText(element.textContent).length >=
        element.getAttribute("data-source-id").length + 16,
      `Source ${element.getAttribute("data-source-id")} needs a useful explanation`,
    );
  }

  const externalResources = [
    ...document.querySelectorAll(
      [
        "script[src]",
        "link[href]",
        "img[src]",
        "source[src]",
        "source[srcset]",
        "video[src]",
        "audio[src]",
        "iframe[src]",
        "object[data]",
      ].join(","),
    ),
  ].filter((element) => {
    const reference =
      element.getAttribute("src") ||
      element.getAttribute("srcset") ||
      element.getAttribute("href") ||
      element.getAttribute("data") ||
      "";
    return /^(?:https?:)?\/\//i.test(reference);
  });
  assert.deepEqual(
    externalResources.map((element) => element.outerHTML),
    [],
    "Product manual must not load external resources",
  );

  const expectedRoutes = [
    "overview",
    "growth-map",
    "execution",
    "results",
  ];
  const artifactRouteLinks = [
    ...document.querySelectorAll('a[href*="GenGrowth-Interactive-Artifact.html"]'),
  ];
  const linkedRoutes = new Set(
    artifactRouteLinks
      .map((link) => link.getAttribute("href"))
      .map((href) => {
        const match = href.match(
          /GenGrowth-Interactive-Artifact\.html#\/(overview|growth-map|execution|results)(?:$|[?&])/,
        );
        return match?.[1];
      })
      .filter(Boolean),
  );
  assert.deepEqual(
    sorted(linkedRoutes),
    sorted(expectedRoutes),
    "Product manual must link directly to all four Artifact routes",
  );

  const boundarySelectors = [
    ['[data-capability-boundary="current"]', /当前.*(?:已实现|可用|Artifact)/],
    ['[data-capability-boundary="future"]', /未来|后续|预留|规划/],
    ['[data-capability-boundary="scenario"]', /场景|演示|Demo/i],
  ];
  for (const [selector, pattern] of boundarySelectors) {
    const marked = document.querySelector(selector);
    assert.ok(marked, `Product manual must mark ${selector}`);
    assert.match(
      normalizeText(marked.textContent),
      pattern,
      `${selector} needs an explicit capability-boundary explanation`,
    );
  }
  assert.match(
    bodyText,
    /浏览器(?:内存|会话)|当前会话/,
    "Scenario boundary must explain browser-memory/session behavior",
  );
  assert.match(
    bodyText,
    /刷新(?:页面)?后(?:会|将)?重置|刷新即重置/,
    "Scenario boundary must explain refresh/reset behavior",
  );
  assert.match(
    bodyText,
    /不(?:会|做|代表).*真实.*(?:外部写入|CMS|GitHub)|无真实外部写入/,
    "Scenario boundary must state that the Artifact performs no real external writes",
  );
  assert.match(
    bodyText,
    /模拟发布|场景发布/,
    "Scenario boundary must label publishing as simulated",
  );

  const searchInput = findControl(document, [
    "[data-manual-search]",
    "#manual-search",
    'input[type="search"]',
  ]);
  assert.ok(searchInput, "Product manual must provide a search input");
  const searchableItems = [
    ...document.querySelectorAll(
      [
        "[data-manual-search-item]",
        "[data-search-item]",
        "[data-index-item]",
        "[data-action-id]",
        "[data-form-id]",
        "[data-source-id]",
      ].join(","),
    ),
  ];
  assert.ok(
    searchableItems.length >= artifactActions.size,
    "Product manual must expose searchable index content",
  );
  const visibleBeforeSearch = searchableItems.filter(
    (element) => !isHidden(element),
  ).length;
  dispatchInput(dom.window, searchInput, "review-finding");
  await nextTurn();
  const targetAction = document.querySelector(
    '[data-action-id="review-finding"]',
  );
  assert.ok(targetAction, "Search fixture action review-finding must exist");
  assert.equal(
    isHidden(targetAction),
    false,
    "Search must keep the matching action visible",
  );
  const visibleAfterSearch = searchableItems.filter(
    (element) => !isHidden(element),
  ).length;
  assert.ok(
    visibleAfterSearch < visibleBeforeSearch,
    "Search must filter non-matching manual content",
  );
  dispatchInput(dom.window, searchInput, "");
  await nextTurn();
  assert.equal(
    isHidden(document.querySelector('[data-action-id="nav"]')),
    false,
    "Clearing search must restore filtered action entries",
  );

  const modeControls = [
    ...document.querySelectorAll(
      "[data-manual-mode],[data-mode-filter],[data-audience-filter]",
    ),
  ];
  const modeControlMap = new Map(
    modeControls.map((element) => [modeValue(element), element]),
  );
  for (const mode of ["all", "buyer", "internal"]) {
    assert.ok(
      modeControlMap.has(mode),
      `Product manual must provide the ${mode} mode`,
    );
  }
  let priorModeSignature = modeSignature(document);
  for (const mode of ["buyer", "internal", "all"]) {
    const control = modeControlMap.get(mode);
    if (control.tagName === "OPTION") {
      control.parentElement.value = control.value;
      control.parentElement.dispatchEvent(
        new dom.window.Event("change", { bubbles: true }),
      );
    } else {
      control.click();
    }
    await nextTurn();
    const nextModeSignature = modeSignature(document);
    assert.ok(
      isActiveControl(control) || nextModeSignature !== priorModeSignature,
      `Switching to ${mode} mode must update the manual`,
    );
    priorModeSignature = nextModeSignature;
  }

  const expandControl =
    findControl(document, [
      "[data-manual-expand]",
      "[data-expand-all]",
      "button[aria-expanded][aria-controls]",
    ]) || document.querySelector("details > summary");
  assert.ok(
    expandControl,
    "Product manual must provide an expandable detail control",
  );
  if (expandControl.tagName === "SUMMARY") {
    const details = expandControl.closest("details");
    const wasOpen = details.open;
    expandControl.click();
    await nextTurn();
    assert.notEqual(
      details.open,
      wasOpen,
      "Details summary must toggle its expanded state",
    );
  } else {
    const beforeExpanded = expandControl.getAttribute("aria-expanded");
    const controlledId = expandControl.getAttribute("aria-controls");
    const controlled = controlledId
      ? document.getElementById(controlledId)
      : null;
    const beforeHidden = controlled ? isHidden(controlled) : null;
    const detailStatesBefore = [...document.querySelectorAll("details")].map(
      (details) => details.open,
    );
    expandControl.click();
    await nextTurn();
    const afterExpanded = expandControl.getAttribute("aria-expanded");
    const afterHidden = controlled ? isHidden(controlled) : null;
    const detailStatesAfter = [...document.querySelectorAll("details")].map(
      (details) => details.open,
    );
    assert.ok(
      beforeExpanded !== afterExpanded ||
        beforeHidden !== afterHidden ||
        JSON.stringify(detailStatesBefore) !==
          JSON.stringify(detailStatesAfter),
      "Expand control must change expanded state or target visibility",
    );
  }

  const manualNavLinks = [
    ...document.querySelectorAll(
      "[data-manual-nav],.manual-nav a[href^=\"#\"],nav a[href^=\"#\"]",
    ),
  ].filter((element) => /^#[A-Za-z0-9_-]+$/.test(element.getAttribute("href")));
  assert.ok(
    manualNavLinks.length >= 5,
    "Product manual must provide a substantial in-page chapter navigation",
  );
  for (const link of manualNavLinks) {
    const target = document.querySelector(link.getAttribute("href"));
    assert.ok(
      target,
      `Manual navigation target must exist: ${link.getAttribute("href")}`,
    );
  }
  manualNavLinks[Math.min(1, manualNavLinks.length - 1)].click();
  await nextTurn();

  const printControl =
    findControl(document, [
      "[data-manual-print]",
      'button[aria-label*="打印"]',
      'button[title*="打印"]',
    ]) ||
    [...document.querySelectorAll("button")].find((button) =>
      /打印/.test(elementLabel(button)),
    );
  assert.ok(printControl, "Product manual must provide a print button");
  printControl.click();
  await nextTurn();
  assert.equal(
    printCalls,
    1,
    "Print button must call window.print exactly once",
  );

  assert.deepEqual(
    runtimeErrors,
    [],
    `Product manual runtime errors:\n${runtimeErrors.join("\n")}`,
  );

  console.log(
    JSON.stringify(
      {
        manual: manualFile,
        bytes: Buffer.byteLength(manualHtml),
        chineseCharacters: chineseCharacterCount,
        artifact: artifactFile,
        workspaceData: fs.existsSync(workspaceDataFile)
          ? workspaceDataFile
          : "embedded Artifact workspace",
        actionIndex: {
          literalDataActions: actionLiterals.size,
          handledActions: actionHandlers.size,
          verifiedEntries: manualActions.size,
        },
        formIndex: {
          literalDataForms: formLiterals.size,
          handledForms: formHandlers.size,
          verifiedEntries: manualForms.size,
        },
        sourceIndex: {
          verifiedEntries: manualSources.size,
          customerVisible: workspace.dataSources.filter(
            (source) => source.audienceVisibility === "customer",
          ).length,
          internal: workspace.dataSources.filter(
            (source) => source.audienceVisibility === "internal",
          ).length,
        },
        artifactRoutes: expectedRoutes.length,
        interactions: {
          search: "PASS",
          modes: "PASS",
          expand: "PASS",
          navigation: "PASS",
          print: "PASS",
        },
        runtimeErrors,
        result: "PASS",
      },
      null,
      2,
    ),
  );

  dom.window.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
