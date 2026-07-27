import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const artifactFile = path.join(
  repositoryRoot,
  "docs",
  "artifacts",
  "GenGrowth-Interactive-Artifact.html",
);
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 4174);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid --port value: ${String(process.argv[portIndex + 1])}`);
}

await access(artifactFile);

const server = createServer((request, response) => {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? `127.0.0.1:${port}`}`,
  );

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  if (requestUrl.pathname === "/healthz") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : "ok");
    return;
  }

  if (
    requestUrl.pathname !== "/" &&
    requestUrl.pathname !== "/GenGrowth-Interactive-Artifact.html"
  ) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not Found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(artifactFile).pipe(response);
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
    `Serving GenGrowth customer Artifact at http://127.0.0.1:${port}/`,
  );
});
