import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fetchPublicResource, type PublicResourceFetchDependencies } from "@sf/sources/public-http";
import { createCanonicalUrlGuard, createPinnedAgent } from "@sf/sources/url-safety";
import { createCitabilityRendererServer, renderCitabilityPage } from "./citability-renderer.ts";
import { measureCitabilityRender, requestCitabilityRender } from "../src/lib/geo-tools/citability-render.ts";

function offline(html: string, resource = "document.body.append(' hydrated copy')") {
  const seen: string[] = [];
  const deps: PublicResourceFetchDependencies = {
    guard: createCanonicalUrlGuard({ lookup: async (host) => host === "private.test" ? ["127.0.0.1"] : ["93.184.216.34"] }),
    createDispatcher: createPinnedAgent,
    fetch: async (url, init) => {
      seen.push(url);
      expect(Object.keys(init.headers)).toEqual(["user-agent"]);
      expect(init.redirect).toBe("manual");
      return new Response(url.endsWith(".js") ? resource : html, { headers: { "content-type": url.endsWith(".js") ? "text/javascript" : "text/html" } });
    },
  };
  return { seen, guard: deps.guard, fetchResource: (url: string, options: Parameters<typeof fetchPublicResource>[1]) => fetchPublicResource(url, options, deps) };
}

describe("real isolated Chromium renderer", () => {
  it("actually executes JS fetched through the guarded transport", async () => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://citability.test/guide", rawHtml: '<body>raw<script src="/app.js"></script></body>', bodyComplete: true }, fixture);
    expect(fixture.seen).toEqual(["https://citability.test/app.js"]);
    expect(result.status).toBe("measured");
    expect(result.rendered?.text).toContain("hydrated copy");
    expect(result.rawToRenderedRatio).toBeLessThan(1);
  }, 20_000);
  it("keeps a real textual comparison when an ordinary public image is intentionally omitted", async () => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: '<body>visible body<img src="https://images.test/photo.png"></body>', bodyComplete: true }, fixture);
    expect(result.status).toBe("measured");
    expect(result.rawToRenderedRatio).toBe(1);
    expect(result.omittedRequests).toBeGreaterThan(0);
    expect(result.blockedRequests).toBe(0);
    expect(fixture.seen).toEqual([]);
  }, 20_000);
  it.each(["image.onload = update", "image.addEventListener('load', update)"])("does not call omitted-image-dependent hydration complete: %s", async (attach) => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: `<body>raw<script>const image=new Image(); const update=()=>document.body.append('hydrated after image'); ${attach}; document.body.append(image); image.src='https://images.test/photo.png';</script></body>`, bodyComplete: true }, fixture);
    expect(result.status).toBe("partial");
    expect(result.rawToRenderedRatio).toBeNull();
    expect(result.omittedRequests).toBeGreaterThan(0);
  }, 20_000);
  it("does not call hidden text visible on either side of the comparison", async () => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: '<body><div style="display:none">hidden-only</div></body>', bodyComplete: true }, fixture);
    expect(result.status).toBe("measured");
    expect(result.raw.textChars).toBe(0);
    expect(result.rendered?.textChars).toBe(0);
    expect(result.rawToRenderedRatio).toBeNull();
  }, 20_000);
  it("measures CSS and JS visibility with the same body-text definition", async () => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: '<body>shown<div style="visibility:hidden">concealed</div><script>document.querySelector("div").style.visibility="visible"</script></body>', bodyComplete: true }, fixture);
    expect(result.raw.text).toBe("shown");
    expect(result.rendered?.text).toContain("concealed");
    expect(result.rawToRenderedRatio).toBeLessThan(1);
    expect(result.raw.method).toBe("browser_visible_text");
    expect(result.rendered?.method).toBe("browser_visible_text");
  }, 20_000);
  it("blocks private, credentials, downgrade, websocket, worker and non-GET requests before native egress", async () => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://citability.test/guide", bodyComplete: true, rawHtml: `<body>raw<script>
      fetch('https://private.test/data').catch(()=>{});
      fetch('http://citability.test/data').catch(()=>{});
      fetch('https://citability.test/data', {method:'POST', body:'secret'}).catch(()=>{});
      fetch('http://127.0.0.1/').catch(()=>{});
      try { new WebSocket('wss://private.test/socket'); } catch {}
      try { new Worker('https://citability.test/worker.js'); } catch {}
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
      document.body.append(' safe hydrated');
    </script></body>` }, fixture);
    expect(fixture.seen).toEqual([]);
    expect(result.status).toBe("partial");
    expect(result.blockedRequests).toBeGreaterThan(0);
    expect(result.rendered?.text).toContain("safe hydrated");
    expect(result.rawToRenderedRatio).toBeNull();
  }, 20_000);
  it("never executes a truncated response as complete script evidence", async () => {
    const fixture = offline("", "x".repeat(600_000));
    const result = await renderCitabilityPage({ url: "https://citability.test/guide", rawHtml: '<body>raw<script src="/large.js"></script></body>', bodyComplete: true }, fixture);
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("resource_limit");
    expect(result.bytes).toBeLessThanOrEqual(2_000_000);
    expect(result.rawToRenderedRatio).toBeNull();
  }, 20_000);
  it("rejects private initial URLs even if an authenticated caller supplies raw HTML", async () => {
    const fixture = offline("");
    const result = await renderCitabilityPage({ url: "https://private.test/", rawHtml: "<body>private</body>", bodyComplete: true }, fixture);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("blocked");
    expect(result.rendered).toBeNull();
    expect(fixture.seen).toEqual([]);
  });
  it("does not send a native browser request to an actual loopback listener", async () => {
    let hits = 0;
    const listener = createServer((_req, res) => { hits += 1; res.end("private"); });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    try {
      const port = (listener.address() as AddressInfo).port;
      const fixture = offline("");
      await renderCitabilityPage({ url: "https://citability.test/", rawHtml: `<body><script>fetch('http://127.0.0.1:${port}/').catch(()=>{});</script>public</body>`, bodyComplete: true }, fixture);
      expect(hits).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())); }
  }, 20_000);
  it.each(["new Worker('/worker.js')", "navigator.serviceWorker.register('/sw.js').catch(()=>{})"])("reports an isolated %s refusal as partial evidence", async (script) => {
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: `<body>copy<script>${script}</script></body>`, bodyComplete: true }, offline(""));
    expect(result.status).toBe("partial");
    expect(result.reason).toBe("blocked");
    expect(result.blockedRequests).toBeGreaterThan(0);
    expect(result.rawToRenderedRatio).toBeNull();
  }, 20_000);
  it("cannot hide policy refusals by replacing the page-visible diagnostic binding", async () => {
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: "<body>copy<script>window.__citabilityPolicyBlocked=async()=>{}; navigator.serviceWorker.register('/sw.js').catch(()=>{});</script></body>", bodyComplete: true }, offline(""));
    expect(result.status).toBe("partial");
    expect(result.blockedRequests).toBeGreaterThan(0);
    expect(result.rawToRenderedRatio).toBeNull();
  }, 20_000);
  it("caps a script-created request fanout and the aggregate response budget", async () => {
    const fixture = offline("x".repeat(350_000));
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: `<body>raw<script>for(let i=0;i<100;i++)fetch('/data'+i).catch(()=>{});</script></body>`, bodyComplete: true }, fixture);
    expect(result.requestCount).toBeLessThanOrEqual(40);
    expect(result.bytes).toBeLessThanOrEqual(2_000_000);
    // A fanout may also prevent a settled DOM; either outcome must remain
    // incomplete, with the limit as its first observed cause.
    expect(["partial", "unavailable"]).toContain(result.status);
    expect(result.reason).toBe("resource_limit");
    expect(result.rawToRenderedRatio).toBeNull();
  }, 20_000);
  it("terminates a hostile infinite script at the deadline", async () => {
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: "<body>raw<script>while(true){}</script></body>", bodyComplete: true }, offline(""));
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("timeout");
    expect(result.rendered).toBeNull();
  }, 20_000);
  it("does not let page script forge or unbound the DOM capture by replacing browser prototypes", async () => {
    const result = await renderCitabilityPage({ url: "https://citability.test/", rawHtml: `<body>actual copy<script>
      Object.defineProperty(Element.prototype, 'outerHTML', {get(){return '<body>forged copy</body>'}});
    </script></body>`, bodyComplete: true }, offline(""));
    expect(result.status).toBe("measured");
    expect(result.rendered?.text).toContain("actual copy");
    expect(result.rendered?.text).not.toContain("forged copy");
  }, 20_000);
});

describe("internal render service boundary", () => {
  it("runs the actual tsx service without transpiler helpers in browser code", async () => {
    // The container installs Chromium outside the user's default cache. Keep
    // this non-secret path without forwarding provider credentials to fixtures.
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.resolve("tsx/cli")), fileURLToPath(new URL("./citability-renderer-fixture.ts", import.meta.url))], { timeout: 20_000, maxBuffer: 100_000, env: { PATH: process.env["PATH"], NODE_ENV: "test", PLAYWRIGHT_BROWSERS_PATH: process.env["PLAYWRIGHT_BROWSERS_PATH"] } });
    const captured = JSON.parse(result.stdout.trim());
    expect(captured.status).toBe("measured");
    expect(captured.raw).toBe("raw");
    expect(captured.rendered).toContain("external JS");
    expect(captured.rendered).toContain("real JS");
    expect(captured.ratio).toBeLessThan(1);
  }, 25_000);
  it("rejects unauthenticated callers and unknown payload fields before rendering", async () => {
    let calls = 0;
    const token = "local-fixture-service-token";
    const server = createCitabilityRendererServer(token, async (input) => { calls += 1; return measureCitabilityRender(input, input.rawHtml); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/render`;
    try {
      expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://citability.test/", rawHtml: "", bodyComplete: true, cookies: "secret" }) })).status).toBe(400);
      expect(calls).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
  it("roundtrips a real Chromium capture through the same HTTP adapter used by Next", async () => {
    const token = "local-fixture-service-token";
    const server = createCitabilityRendererServer(token, (input) => renderCitabilityPage(input, offline("")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await requestCitabilityRender({ url: "https://citability.test/", rawHtml: "<body>raw<script>document.body.append(' rendered in chromium')</script></body>", bodyComplete: true }, { env: { CITABILITY_RENDERER_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/render`, CITABILITY_RENDERER_TOKEN: token } });
      expect(result.status).toBe("measured");
      expect(result.rendered?.text).toContain("rendered in chromium");
      expect(result.rawToRenderedRatio).toBeLessThan(1);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }, 20_000);
});
