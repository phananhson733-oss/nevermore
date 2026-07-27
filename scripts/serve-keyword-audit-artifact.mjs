import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pathGuard from "./artifact-path-guard.cjs";

const { assertRepositoryOwnedPath } = pathGuard;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactFile = path.join(
  repositoryRoot,
  "docs",
  "artifacts",
  "Nevermore-Keyword-Growth-Audit.html",
);
const portIndex = process.argv.indexOf("--port");
const rawPort = portIndex >= 0 ? process.argv[portIndex + 1] : "4175";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid --port value: ${String(rawPort)}`);
}

assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath: artifactFile,
  label: "Keyword audit Artifact",
  mustExist: true,
  kind: "file",
});

const securityHeaders = {
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const server = createServer((request, response) => {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? `127.0.0.1:${port}`}`,
  );

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      ...securityHeaders,
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Method Not Allowed");
    return;
  }

  if (requestUrl.pathname === "/healthz") {
    response.writeHead(200, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : "ok");
    return;
  }

  if (
    requestUrl.pathname !== "/" &&
    requestUrl.pathname !== "/Nevermore-Keyword-Growth-Audit.html"
  ) {
    response.writeHead(404, {
      ...securityHeaders,
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not Found");
    return;
  }

  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/html; charset=utf-8",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(artifactFile);
  stream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(500, {
        ...securityHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      });
    }
    response.end("Internal Server Error");
  });
  stream.pipe(response);
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Serving Nevermore keyword audit Artifact at http://127.0.0.1:${port}/`,
  );
});
