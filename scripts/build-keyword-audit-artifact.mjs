import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pathGuard from "./artifact-path-guard.cjs";

const { assertRepositoryOwnedPath } = pathGuard;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultSourceDirectory = path.join(
  repositoryRoot,
  "docs",
  "keyword-audit-artifact-src",
);
const defaultOutputFile = path.join(
  repositoryRoot,
  "docs",
  "artifacts",
  "Nevermore-Keyword-Growth-Audit.html",
);
const [sourceDirectoryArgument, outputFileArgument] = process.argv.slice(2);

const resolveRepositoryPath = (argument, fallback, label) => {
  const resolved = argument
    ? path.resolve(repositoryRoot, argument)
    : fallback;
  assertRepositoryOwnedPath({
    repositoryRoot,
    candidatePath: resolved,
    label,
  });
  if (
    /(?:^|[/\\])\.codex[/\\]visualizations(?:[/\\]|$)|(?:^|[/\\])tmp(?:[/\\]|$)/i.test(
      resolved,
    )
  ) {
    throw new Error(`${label} must use a repository-owned source path`);
  }
  return resolved;
};

const sourceDirectory = resolveRepositoryPath(
  sourceDirectoryArgument,
  defaultSourceDirectory,
  "Keyword audit Artifact source directory",
);
const outputFile = resolveRepositoryPath(
  outputFileArgument,
  defaultOutputFile,
  "Keyword audit Artifact output",
);

assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath: sourceDirectory,
  label: "Keyword audit Artifact source directory",
  mustExist: true,
  kind: "directory",
});
assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath: outputFile,
  label: "Keyword audit Artifact output",
  kind: "file",
});

const sourceFileNames = ["styles.css", "audit-data.js", "audit-app.js"];
const sourceFiles = sourceFileNames.map((fileName) =>
  assertRepositoryOwnedPath({
    repositoryRoot,
    candidatePath: path.join(sourceDirectory, fileName),
    label: `Keyword audit Artifact source ${fileName}`,
    mustExist: true,
    kind: "file",
  }),
);
const [styles, auditData, auditApp] = await Promise.all(
  sourceFiles.map((sourceFile) => readFile(sourceFile, "utf8")),
);

const protectInlineScript = (source) =>
  source.replace(/<\/script/giu, "<\\/script");
const protectInlineStyle = (source) =>
  source.replace(/<\/style/giu, "<\\/style");

const html = `<!doctype html>
<html
  lang="zh-CN"
  data-keyword-audit-build="2.0-static"
  data-primary-experience="growth-workspace"
>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <meta
      name="description"
      content="Nevermore SEO/GEO 增长工作台：在概览、增长地图、执行中心和效果追踪中统一管理页面、关键词、竞品、技术证据与客户交付。"
    />
    <meta name="theme-color" content="#f4eee3" />
    <meta name="nevermore-keyword-growth-build" content="2.0-static" />
    <title>Nevermore · SEO/GEO 增长工作台</title>
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23173832'/%3E%3Cpath d='M17 46V18h8l14 18V18h8v28h-8L25 28v18z' fill='%23f4eee3'/%3E%3C/svg%3E"
    />
    <style>
${protectInlineStyle(styles)}
    </style>
  </head>
  <body>
    <a class="skip-link" href="#product-content">跳到工作台正文</a>
    <div id="app"></div>
    <noscript>
      <main class="boot-error">
        <h1>需要启用 JavaScript</h1>
        <p>这是一份完全离线的 Nevermore SEO/GEO 增长工作台 Artifact；请启用 JavaScript 后重新打开。</p>
        <p>客户主体验由概览、增长地图、执行中心和效果追踪组成；需求审核仅作为辅助证据。</p>
      </main>
    </noscript>
    <script>
${protectInlineScript(auditData)}
    </script>
    <script>
window.NevermoreKeywordAudit = window.NevermoreKeywordAudit;
    </script>
    <script>
${protectInlineScript(auditApp)}
    </script>
  </body>
</html>
`;

const forbiddenContent = [
  ["external script", /<script\b[^>]*\bsrc\s*=/i],
  [
    "external stylesheet",
    /<link\b[^>]*\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i,
  ],
  ["CSS import", /@import\s/i],
  ["remote CSS asset", /url\s*\(\s*["']?https?:/i],
  ["remote media asset", /<(?:img|audio|video|source)\b[^>]*\bsrc\s*=\s*["']https?:/i],
  ["network fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["worker", /\b(?:Shared)?Worker\s*\(/],
  ["importScripts", /\bimportScripts\s*\(/],
  ["WebSocket", /\bWebSocket\s*\(/],
  ["EventSource", /\bEventSource\s*\(/],
  ["sendBeacon", /\bsendBeacon\s*\(/],
  [
    "compatibility package name",
    /(?:\bSignalFrame\b|signalframe-mvp-app|@sf\/)/i,
  ],
  [
    "absolute workstation path",
    /(?:\/Users\/|\/home\/|\/var\/folders\/|\/private\/(?:tmp|var)\/|[A-Za-z]:\\Users\\|\.codex[/\\]visualizations|file:\/\/)/i,
  ],
  [
    "credential",
    /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^/\s:@]+:[^@\s/]+@|https?:\/\/[^/\s:@]+:[^@\s/]+@|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/,
  ],
  [
    "generic toast action",
    /\b(?:showToast|createToast|toast\s*\()/i,
  ],
  ["legacy RelayOps scenario", /\bRelayOps\b/i],
  [
    "legacy mock business metric",
    /(?:\bDEMO DATA\b|场景数据\s*[·•|]\s*\d{4}|2,486\s+keywords|126\s+URLs|28\s+domains|1,240\s+(?:clicks|点击)|1,842\s+words|\b37\s+total\b|\b92%|产品画像\s*100%|data-evidence-status\s*=\s*["'](?:mock|scenario)["'])/i,
  ],
];

const violations = forbiddenContent
  .filter(([, pattern]) => pattern.test(html))
  .map(([label]) => label);
if (violations.length > 0) {
  throw new Error(
    `Keyword audit Artifact contains forbidden content: ${violations.join(", ")}`,
  );
}

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, html, "utf8");

console.log(
  `Built standalone Nevermore SEO/GEO growth workspace Artifact: ${outputFile} (${Buffer.byteLength(html).toLocaleString("en-US")} bytes)`,
);
