import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import pathGuard from "./artifact-path-guard.cjs";
import {
  repositoryRoot,
  resolveArtifactBuildPaths,
} from "./resolve-artifact-source.mjs";

const { assertRepositoryOwnedPath } = pathGuard;

const [sourceDirectoryArgument, outputFileArgument] = process.argv.slice(2);

let buildPaths;
try {
  buildPaths = resolveArtifactBuildPaths({
    sourceDirectoryArgument,
    outputFileArgument,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { sourceDirectory, outputFile } = buildPaths;
assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath: sourceDirectory,
  label: "Artifact source directory",
  mustExist: true,
  kind: "directory",
});

const sourceFiles = ["styles.css", "workspace-data.js", "client-app.js"].map(
  (fileName) =>
    assertRepositoryOwnedPath({
      repositoryRoot,
      candidatePath: path.join(sourceDirectory, fileName),
      label: `Artifact source ${fileName}`,
      mustExist: true,
      kind: "file",
    }),
);

const [styles, workspaceData, clientApp] = await Promise.all(
  sourceFiles.map((sourceFile) => readFile(sourceFile, "utf8")),
);

const protectInlineScript = (source) =>
  source.replaceAll("</script", "<\\/script");

const sanitizeCustomerSource = (source) =>
  source
    .replaceAll("Nevermore", "GenGrowth")
    .replaceAll("nevermore", "gengrowth");

const html = `<!doctype html>
<html lang="zh-CN" data-artifact-build="15.0-static">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="GenGrowth 客户增长工作台离线 Artifact：产品画像、多 URL 机会地图、关键词与竞品库、交付审核、发布与结果追踪。"
    />
    <meta name="theme-color" content="#f6efe4" />
    <meta name="gengrowth-artifact-build" content="15.0-static" />
    <title>GenGrowth · RelayOps 交互式产品 Artifact</title>
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='18' fill='%231f4d47'/%3E%3Cpath d='M18 46V18h8l12 17V18h8v28h-8L26 29v17z' fill='%23f6efe4'/%3E%3C/svg%3E"
    />
    <style>
${sanitizeCustomerSource(styles)}
    </style>
  </head>
  <body>
    <a class="skip-link" href="#route-content">跳到主要内容</a>
    <div id="app"></div>
    <noscript>
      <main class="boot-error">
        <h1>需要启用 JavaScript</h1>
        <p>这是一份完全离线的交互式 HTML Artifact；请在浏览器中启用 JavaScript 后重新打开。</p>
      </main>
    </noscript>
    <script>
${protectInlineScript(sanitizeCustomerSource(workspaceData))}
    </script>
    <script>
${protectInlineScript(sanitizeCustomerSource(clientApp))}
    </script>
  </body>
</html>
`;

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, html, "utf8");

const externalAssetPatterns = [
  /<script\b[^>]*\bsrc=/i,
  /<link\b[^>]*\brel=["']stylesheet["']/i,
  /@import\s/i,
  /\bfetch\s*\(/,
  /new\s+Worker\s*\(/,
];

const violations = externalAssetPatterns
  .map((pattern) => pattern.test(html) && pattern.toString())
  .filter(Boolean);

if (violations.length > 0) {
  console.error(`Static Artifact still contains external dependencies: ${violations.join(", ")}`);
  process.exit(1);
}

console.log(
  `Built standalone customer Artifact: ${outputFile} (${Buffer.byteLength(html).toLocaleString("en-US")} bytes)`,
);
