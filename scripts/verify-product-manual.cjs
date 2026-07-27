"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM, VirtualConsole } = require("jsdom");
const {
  assertRepositoryOwnedPath,
} = require("./artifact-path-guard.cjs");

const repoRoot = path.resolve(__dirname, "..");
const defaultManualFile = path.join(
  repoRoot,
  "docs/artifacts/GenGrowth-Product-Manual.html",
);
const defaultArtifactFile = path.join(
  repoRoot,
  "docs/artifacts/GenGrowth-Interactive-Artifact.html",
);
const [
  manualArgument,
  artifactArgument,
] = process.argv.slice(2);

function resolveRepositoryFile(argument, fallback, label) {
  const resolved = argument ? path.resolve(repoRoot, argument) : fallback;
  assertRepositoryOwnedPath({
    repositoryRoot: repoRoot,
    candidatePath: resolved,
    label,
    mustExist: true,
    kind: "file",
  });
  assert.doesNotMatch(
    resolved,
    /(?:^|[/\\])\.codex[/\\]visualizations(?:[/\\]|$)|(?:^|[/\\])tmp[/\\]gengrowth-artifact-jsdom-/i,
    `${label} must not use a historical workstation source`,
  );
  return resolved;
}

const manualFile = resolveRepositoryFile(
  manualArgument,
  defaultManualFile,
  "Product manual",
);
const artifactFile = resolveRepositoryFile(
  artifactArgument,
  defaultArtifactFile,
  "Interactive Artifact",
);

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
    "Embedded Artifact workspace must expose window.GenGrowthWorkspace.dataSources",
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
  const workspace = workspaceFromArtifact(artifactHtml);

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

  const forbiddenCustomerManualPatterns = [
    [
      "internal audience content",
      /\bdata-manual-audience\s*=\s*["']?internal\b/i,
    ],
    ["the internal reading entry", /内部查阅/],
    ["a /Users workstation path", /\/Users\//],
    ["a .codex/visualizations path", /\.codex\/visualizations/i],
    ["a signalframe-mvp-app workspace path", /signalframe-mvp-app/i],
  ];
  for (const [label, pattern] of forbiddenCustomerManualPatterns) {
    assert.equal(
      pattern.test(manualHtml),
      false,
      `Customer product manual must not contain ${label}`,
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
  assert.match(
    manualHtml,
    /@media\s*\(\s*max-width\s*:/i,
    "Product manual must provide responsive narrow-screen styles",
  );
  assert.equal(
    document.querySelectorAll("h1").length,
    1,
    "Product manual must have exactly one h1",
  );

  const bodyText = normalizeText(document.body.textContent);
  const chineseCharacterCount = (bodyText.match(/[\u3400-\u9fff]/g) || [])
    .length;
  assert.equal(
    document.querySelectorAll(
      [
        '[data-manual-audience="internal" i]',
        '[data-manual-mode]',
        '[data-manual-mode-select]',
        '[data-mode-filter]',
        '[data-audience-filter]',
      ].join(","),
    ).length,
    0,
    "Customer product manual must physically exclude internal content and reading-mode controls",
  );
  assert.equal(
    document.querySelectorAll(
      [
        "#sources",
        "#actions",
        "#forms",
        ".source-registry",
        "[data-action-id]",
        "[data-form-id]",
        "[data-source-id]",
      ].join(","),
    ).length,
    0,
    "Customer product manual must not expose Action, Form, or Source dictionaries",
  );
  for (const [label, pattern] of [
    ["Action index", /Action\s*\/\s*按钮索引|Action index/i],
    ["Form index", /Form\s*\/\s*表单索引|Form index/i],
    ["Source dictionary", /数据来源字典|内部来源字典|Source Dictionary/i],
  ]) {
    assert.equal(
      pattern.test(bodyText),
      false,
      `Customer product manual must not expose the ${label}`,
    );
  }
  const customerSources = workspace.dataSources.filter(
    (source) => source.audienceVisibility === "customer",
  );
  assert.ok(
    customerSources.length >= 3,
    "Embedded Artifact workspace must expose the customer connection set",
  );
  for (const source of customerSources) {
    assert.match(
      bodyText,
      new RegExp(
        source.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      ),
      `Customer product manual must explain the ${source.name} connection`,
    );
  }
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
      ].join(","),
    ),
  ];
  assert.ok(
    searchableItems.length >= 8,
    "Product manual must expose substantial searchable customer content",
  );
  const visibleBeforeSearch = searchableItems.filter(
    (element) => !isHidden(element),
  ).length;
  dispatchInput(dom.window, searchInput, "产品画像");
  await nextTurn();
  const targetSection = document.querySelector("#profile");
  assert.ok(targetSection, "Search fixture customer profile section must exist");
  assert.equal(
    isHidden(targetSection),
    false,
    "Search must keep the matching customer section visible",
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
    isHidden(document.querySelector("#overview")),
    false,
    "Clearing search must restore filtered customer sections",
  );

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
        workspaceData: "embedded Artifact workspace",
        customerExposure: {
          internalAudienceBlocks: 0,
          readingModeControls: 0,
          actionFormSourceDictionaries: 0,
          workstationPaths: 0,
        },
        connections: {
          customerVisible: workspace.dataSources.filter(
            (source) => source.audienceVisibility === "customer",
          ).length,
        },
        artifactRoutes: expectedRoutes.length,
        interactions: {
          search: "PASS",
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
