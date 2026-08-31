// Deterministic offline fixture executed by the actual tsx CLI, not Vite/OXC.
import type { AddressInfo } from "node:net";
import { createCanonicalUrlGuard, createPinnedAgent } from "@sf/sources/url-safety";
import { fetchPublicResource } from "@sf/sources/public-http";
import { createCitabilityRendererServer, renderCitabilityPage } from "./citability-renderer.ts";
import { requestCitabilityRender } from "../src/lib/geo-tools/citability-render.ts";

const guard = createCanonicalUrlGuard({ lookup: async () => ["93.184.216.34"] });
const token = "offline-fixture-runtime-token";
const server = createCitabilityRendererServer(token, (input) => renderCitabilityPage(input, {
  guard,
  fetchResource: (url, options) => fetchPublicResource(url, options, {
    guard, createDispatcher: createPinnedAgent,
    fetch: async () => new Response("document.body.append(' external JS')", { headers: { "content-type": "text/javascript" } }),
  }),
}));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const result = await requestCitabilityRender({ url: "https://citability.test/", rawHtml: '<body>raw<script src="/code.js"></script><script>document.body.append(" real JS")</script></body>', bodyComplete: true }, {
    env: { CITABILITY_RENDERER_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/render`, CITABILITY_RENDERER_TOKEN: token },
  });
  process.stdout.write(`${JSON.stringify({ status: result.status, reason: result.reason, raw: result.raw.text, rendered: result.rendered?.text, ratio: result.rawToRenderedRatio })}\n`);
} finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
