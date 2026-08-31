// Separate, authenticated service. Never import this file into a Next route.
// Run: CITABILITY_RENDERER_TOKEN=... pnpm exec tsx apps/marketing/scripts/citability-renderer.ts
// Deploy as an unprivileged service with Chromium sandbox enabled and OS memory/CPU limits.
import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { fetchPublicResource, type PublicResourceSuccess } from "@sf/sources/public-http";
import { canonicalUrlGuard } from "@sf/sources/url-safety";
import { z } from "zod";
import { measureCitabilityRender } from "../src/lib/geo-tools/citability-render.ts";
import { assertCitabilityRuntimeEnvelope } from "./citability-renderer-runtime.ts";
import { CITABILITY_CAPTURE_SCRIPT, CITABILITY_INIT_SCRIPT } from "./citability-renderer-browser.ts";
import {
  CITABILITY_RENDER_TIMEOUT_MS, CITABILITY_RENDER_MAX_BYTES, CITABILITY_RENDER_MAX_REQUESTS,
  CITABILITY_RENDER_RESOURCE_BYTES, type CitabilityRenderRequest, type CitabilityRenderEvidence,
  type CitabilityRenderReason, type CitabilityTextCapture, CITABILITY_RENDER_TEXT_CHARS,
} from "../src/lib/geo-tools/citability-render-contract.ts";

const MAX_HTML_BYTES = 1_500_000;
const requestSchema = z.object({ url: z.string().url().max(2048), rawHtml: z.string().max(MAX_HTML_BYTES), bodyComplete: z.boolean() }).strict();
const CSP = "worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'";
const TEXT_TYPES = /^(?:text\/(?:html|plain|css|javascript)|application\/(?:javascript|x-javascript|json|ld\+json))\b/i;

interface RendererDependencies {
  readonly fetchResource?: typeof fetchPublicResource;
  readonly guard?: typeof canonicalUrlGuard;
  readonly now?: () => Date;
}

/** Browser native networking is deliberately unusable. Every admitted request is
 * fulfilled by Node's existing public-URL/DNS/IP-pinned safe fetch. No cookies,
 * auth headers, request bodies or browser profile are forwarded. */
export async function renderCitabilityPage(input: CitabilityRenderRequest, dependencies: RendererDependencies = {}): Promise<CitabilityRenderEvidence> {
  const now = dependencies.now ?? (() => new Date());
  const started = Date.now();
  let browser: Browser | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let reason: CitabilityRenderReason | null = null;
  let requestCount = 0;
  let blockedRequests = 0;
  let omittedRequests = 0;
  let presentationDependency = false;
  let bytes = Buffer.byteLength(input.rawHtml);
  let rawCapture: CitabilityTextCapture | undefined;
  let renderedCapture: CitabilityTextCapture | undefined;
  const resourceCache = new Map<string, PublicResourceSuccess>();
  const block = (why: CitabilityRenderReason): void => {
    blockedRequests = Math.min(10_000, blockedRequests + 1);
    reason ??= why;
  };
  try {
    const target = new URL(input.url);
    if (!requestSchema.safeParse(input).success || bytes > MAX_HTML_BYTES ||
      target.username || target.password || target.port || target.hash || !target.hostname.includes(".") || isIP(target.hostname) !== 0 || !["http:", "https:"].includes(target.protocol)) {
      return measureCitabilityRender(input, null, { now, reason: "blocked", bytes: Math.min(bytes, CITABILITY_RENDER_MAX_BYTES) });
    }
    const guarded = await (dependencies.guard ?? canonicalUrlGuard)(input.url);
    if (!guarded.safe || !guarded.pinnedIp) return measureCitabilityRender(input, null, { now, reason: "blocked" });
    browser = await chromium.launch({
      headless: true, chromiumSandbox: true, timeout: 4_000,
      // Even a network API Playwright cannot route must fail closed, not use a
      // local/private address. Explicitly disable Chromium's loopback bypass.
      proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
      args: ["--disable-background-networking", "--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
    for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, serviceWorkers: "block", acceptDownloads: false, permissions: [], viewport: { width: 1280, height: 900 } });
    deadline = setTimeout(() => { reason ??= "timeout"; void context.close().catch(() => undefined); }, Math.max(1, CITABILITY_RENDER_TIMEOUT_MS - (Date.now() - started)));
    await context.exposeBinding("__citabilityPolicyBlocked", () => block("blocked"));
    await context.exposeBinding("__citabilityPresentationDependency", () => { presentationDependency = true; });
    await context.addInitScript(CITABILITY_INIT_SCRIPT);
    await context.routeWebSocket("**", (socket) => { block("blocked"); socket.close(); });
    const page = await context.newPage();
    context.on("page", (extra) => { if (extra !== page) { block("navigation"); void extra.close().catch(() => undefined); } });
    page.on("download", (download) => { block("blocked"); void download.cancel().catch(() => undefined); });
    page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => undefined); });
    let mainServed = false;
    let queue = Promise.resolve();
    await context.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (requestCount >= CITABILITY_RENDER_MAX_REQUESTS || Date.now() - started >= CITABILITY_RENDER_TIMEOUT_MS) {
        block("resource_limit"); await route.abort(); return;
      }
      if (!mainServed && main && request.url() === input.url && request.method() === "GET") {
        mainServed = true;
        requestCount += 1;
        await route.fulfill({ status: 200, body: input.rawHtml, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "no-store" } });
        return;
      }
      requestCount += 1;
      if (request.isNavigationRequest() || request.method() !== "GET" || requestUrl.username || requestUrl.password ||
        requestUrl.port || !["http:", "https:"].includes(requestUrl.protocol) ||
        (target.protocol === "https:" && requestUrl.protocol !== "https:")) {
        block(request.isNavigationRequest() ? "navigation" : "blocked"); await route.abort(); return;
      }
      if (["image", "media", "font"].includes(request.resourceType())) {
        // Omit presentation bytes deliberately, but do not launder private URLs
        // as harmless omissions: they still go through the public DNS/IP guard.
        const safe = await (dependencies.guard ?? canonicalUrlGuard)(request.url());
        if (safe.safe && safe.pinnedIp) omittedRequests += 1;
        else block("blocked");
        await route.abort(); return;
      }
      if (!["script", "stylesheet", "fetch", "xhr"].includes(request.resourceType())) { block("blocked"); await route.abort(); return; }
      // Serial resource fetches enforce a hard aggregate byte ceiling, not an
      // optimistic remaining budget repeated across concurrent requests.
      queue = queue.then(async () => {
        const remaining = CITABILITY_RENDER_MAX_BYTES - bytes;
        const timeoutMs = CITABILITY_RENDER_TIMEOUT_MS - (Date.now() - started);
        if (remaining <= 0 || timeoutMs <= 0) { block("resource_limit"); await route.abort(); return; }
        const cached = resourceCache.get(request.url());
        const resource = cached ?? await (dependencies.fetchResource ?? fetchPublicResource)(request.url(), {
          maxRedirects: 0, maxBodyBytes: Math.min(remaining, CITABILITY_RENDER_RESOURCE_BYTES), timeoutMs: Math.min(timeoutMs, 4_000),
        });
        if (resource.kind === "error") { block(resource.code === "timeout" ? "timeout" : "blocked"); await route.abort(); return; }
        if (!cached) bytes += resource.bytes;
        if (!resource.bodyComplete) { block("resource_limit"); await route.abort(); return; }
        if (resource.finalStatus < 200 || resource.finalStatus >= 300 || !TEXT_TYPES.test(resource.contentType ?? "")) { block("blocked"); await route.abort(); return; }
        resourceCache.set(request.url(), resource);
        await route.fulfill({ status: resource.finalStatus, body: resource.body, headers: {
          "content-type": resource.contentType ?? "text/plain", "cache-control": "no-store",
          "content-security-policy": CSP,
        } });
      }).catch(() => { block("blocked"); void route.abort().catch(() => undefined); });
      await queue;
    });
    await page.goto(input.url, { waitUntil: "networkidle", timeout: Math.max(1, CITABILITY_RENDER_TIMEOUT_MS - (Date.now() - started)) });
    await queue;
    if (page.url() !== input.url) { block("navigation"); throw new Error("navigation"); }
    // A separate JavaScript world prevents hostile page code from replacing
    // outerHTML/slice and forging the evidence or bypassing the output bound.
    const session = await context.newCDPSession(page);
    const { frameTree } = await session.send("Page.getFrameTree");
    const { executionContextId } = await session.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "citability-capture", grantUniveralAccess: false });
    const captured = await session.send("Runtime.evaluate", {
      contextId: executionContextId,
      expression: `(${CITABILITY_CAPTURE_SCRIPT})(${CITABILITY_RENDER_TEXT_CHARS})`,
      returnByValue: true,
    });
    const value = z.object({ text: z.string().max(CITABILITY_RENDER_TEXT_CHARS), complete: z.boolean(), presentationDependent: z.boolean() }).strict().safeParse(captured.result.value);
    if (captured.exceptionDetails || !value.success) throw new Error("capture_failed");
    if (omittedRequests > 0 && (presentationDependency || value.data.presentationDependent)) block("blocked");
    const capture: CitabilityTextCapture = { method: "browser_visible_text", text: value.data.text, textChars: value.data.text.replace(/\s+/g, "").length, complete: value.data.complete && input.bodyComplete };
    if (javaScriptEnabled) renderedCapture = capture;
    else rawCapture = capture;
    if (deadline !== undefined) clearTimeout(deadline);
    await context.close();
    }
  } catch {
    reason ??= Date.now() - started >= CITABILITY_RENDER_TIMEOUT_MS ? "timeout" : "service_failed";
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    await browser?.close().catch(() => undefined);
  }
  return measureCitabilityRender(input, null, { now, reason, requestCount, blockedRequests, omittedRequests, bytes, ...(rawCapture ? { rawCapture } : {}), ...(renderedCapture ? { renderedCapture } : {}) });
}

/** Internal service auth is separate from the anonymous public tool. */
export function createCitabilityRendererServer(token: string, render = renderCitabilityPage): Server {
  if (token.length < 16) throw new Error("CITABILITY_RENDERER_TOKEN must contain at least 16 characters");
  let active = false;
  return createServer(async (request, response) => {
    const send = (status: number, value: unknown): void => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
    const expected = Buffer.from(`Bearer ${token}`);
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { send(401, { error: "unauthorized" }); return; }
    if (request.method !== "POST" || request.url !== "/render") { send(404, { error: "not_found" }); return; }
    if (!request.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "json_required" }); return; }
    if (active) { send(429, { error: "busy" }); return; }
    active = true;
    const timer = setTimeout(() => request.destroy(), 5_000);
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 2_000_000) { send(413, { error: "too_large" }); return; }
        chunks.push(buffer);
      }
      clearTimeout(timer);
      const parsed = requestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!parsed.success || Buffer.byteLength(parsed.data.rawHtml) > MAX_HTML_BYTES) { send(400, { error: "invalid_request" }); return; }
      send(200, await render(parsed.data));
    } catch { if (!response.headersSent) send(400, { error: "invalid_request" }); }
    finally { clearTimeout(timer); active = false; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env["CITABILITY_RENDERER_TOKEN"] ?? "";
  const port = Number(process.env["CITABILITY_RENDERER_PORT"] ?? "4318");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid renderer port");
  const production = process.env["NODE_ENV"] === "production";
  if (production) assertCitabilityRuntimeEnvelope();
  const hostname = production && process.env["CITABILITY_RENDERER_HOST"] === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  createCitabilityRendererServer(token).listen(port, hostname);
}
