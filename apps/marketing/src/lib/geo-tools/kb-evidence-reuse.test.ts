import { describe, expect, it } from "vitest";
import { parseGeoEvidenceObservation, type GeoEvidenceObservation } from "./kb-evidence-observations.ts";
import {
  geoEvidenceGateKey,
  geoEvidenceTargetKey,
  planGeoEvidenceReuse,
  type GeoEvidenceTarget,
} from "./kb-evidence-reuse.ts";

const WEBSITE_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-07T12:00:00.000Z");
const FRESH = "2026-09-07T06:00:00.000Z";
const STALE = "2026-09-05T06:00:00.000Z";

let nextId = 0;
function observed(
  url: string,
  observedAt: string,
  kind: GeoEvidenceObservation["kind"] = "own_page",
): GeoEvidenceObservation {
  nextId += 1;
  return parseGeoEvidenceObservation({
    schemaVersion: "marketing-website-evidence-observation.v1",
    observationId: `33333333-3333-4333-8333-${String(nextId).padStart(12, "0")}`,
    websiteId: WEBSITE_ID,
    kind,
    url,
    observedAt,
    status: "ok",
    statusReason: null,
    bodyHash: "b".repeat(64),
    excerpts: ["Body."],
    structured: {},
    independence: kind === "third_party" ? "undetermined" : null,
  });
}

function ownPage(path: string): GeoEvidenceTarget {
  return { kind: "own_page", url: `https://acme.test${path}`, gateKey: "acme.test" };
}

describe("evidence reuse planning", () => {
  it("reuses a target observed inside its TTL and sends nothing", () => {
    const plan = planGeoEvidenceReuse({
      targets: [ownPage("/")],
      observations: [observed("https://acme.test/", FRESH)],
      now: NOW,
    });
    expect(plan.entries.map((entry) => entry.decision)).toEqual(["reuse"]);
    expect(plan.entries[0]?.reused?.observedAt).toBe(FRESH);
    expect(plan.gateOpenings).toEqual([]);
    expect(plan).toMatchObject({ reuseCount: 1, fetchCount: 0 });
  });

  it("re-fetches past the TTL and keeps the expired observation as superseded", () => {
    const stale = observed("https://acme.test/", STALE);
    const plan = planGeoEvidenceReuse({ targets: [ownPage("/")], observations: [stale], now: NOW });
    expect(plan.entries[0]).toMatchObject({ decision: "fetch", reused: null, opensGate: true });
    expect(plan.entries[0]?.superseded?.observedAt).toBe(STALE);
    expect(plan.gateOpenings).toEqual(["acme.test"]);
  });

  it("fetches a target that was never observed", () => {
    const plan = planGeoEvidenceReuse({ targets: [ownPage("/pricing")], observations: [], now: NOW });
    expect(plan.entries[0]).toMatchObject({ decision: "fetch", superseded: null, opensGate: true });
  });

  it("opens the gate once for a whole site, not once per page", () => {
    const targets = ["/", "/about", "/pricing", "/product", "/integrations", "/docs", "/faq", "/changelog"].map(ownPage);
    const plan = planGeoEvidenceReuse({ targets, observations: [], now: NOW });
    expect(plan.fetchCount).toBe(8);
    expect(plan.entries.filter((entry) => entry.opensGate)).toHaveLength(1);
    expect(plan.gateOpenings).toEqual(["acme.test"]);
    expect(plan.entries[0]?.opensGate).toBe(true);
  });

  it("charges the gate to the first page that actually has to be fetched", () => {
    const plan = planGeoEvidenceReuse({
      targets: [ownPage("/"), ownPage("/pricing"), ownPage("/docs")],
      observations: [observed("https://acme.test/", FRESH)],
      now: NOW,
    });
    expect(plan.entries.map((entry) => entry.opensGate)).toEqual([false, true, false]);
    expect(plan.gateOpenings).toEqual(["acme.test"]);
  });

  it("opens no gate at all when every target is reusable", () => {
    const plan = planGeoEvidenceReuse({
      targets: [ownPage("/"), ownPage("/pricing")],
      observations: [observed("https://acme.test/", FRESH), observed("https://acme.test/pricing", FRESH)],
      now: NOW,
    });
    expect(plan.gateOpenings).toEqual([]);
    expect(plan.fetchCount).toBe(0);
  });

  it("gives every distinct target its own single admission", () => {
    const plan = planGeoEvidenceReuse({
      targets: [
        ownPage("/"),
        ownPage("/pricing"),
        { kind: "competitor_page", url: "https://rival.test/", gateKey: "rival.test" },
        { kind: "competitor_page", url: "https://rival.test/pricing", gateKey: "rival.test" },
      ],
      observations: [],
      now: NOW,
    });
    expect(plan.gateOpenings).toEqual(["acme.test", "rival.test"]);
    expect(plan.entries.filter((entry) => entry.opensGate)).toHaveLength(2);
  });

  it("spends no crawl admission on a target that has no crawl gate", () => {
    const plan = planGeoEvidenceReuse({
      targets: [{ kind: "gsc", url: "sc-domain:acme.test#2026-06-09..2026-09-06", gateKey: null }],
      observations: [],
      now: NOW,
    });
    expect(plan.entries[0]).toMatchObject({ decision: "fetch", opensGate: false });
    expect(plan.gateOpenings).toEqual([]);
  });

  it("asks for a repeated target once", () => {
    const plan = planGeoEvidenceReuse({
      targets: [ownPage("/"), ownPage("/"), ownPage("/pricing")],
      observations: [],
      now: NOW,
    });
    expect(plan.entries).toHaveLength(2);
    expect(plan.duplicateTargetCount).toBe(1);
    expect(plan.fetchCount).toBe(2);
    expect(plan.gateOpenings).toEqual(["acme.test"]);
  });

  it("judges freshness against the newest observation, not the first one loaded", () => {
    const plan = planGeoEvidenceReuse({
      targets: [ownPage("/")],
      observations: [observed("https://acme.test/", STALE), observed("https://acme.test/", FRESH)],
      now: NOW,
    });
    expect(plan.entries[0]).toMatchObject({ decision: "reuse" });
    expect(plan.entries[0]?.reused?.observedAt).toBe(FRESH);
  });

  it("does not let one kind's observation stand in for another kind of the same url", () => {
    const url = "https://acme.test/robots.txt";
    const plan = planGeoEvidenceReuse({
      targets: [{ kind: "robots", url, gateKey: "acme.test" }],
      observations: [observed(url, FRESH, "own_page")],
      now: NOW,
    });
    expect(plan.entries[0]).toMatchObject({ decision: "fetch" });
  });

  it("honours an injected TTL", () => {
    const plan = planGeoEvidenceReuse({
      targets: [ownPage("/")],
      observations: [observed("https://acme.test/", FRESH)],
      now: NOW,
      ttlMs: () => 60_000,
    });
    expect(plan.entries[0]).toMatchObject({ decision: "fetch" });
  });

  it("keeps two targets apart even when one url contains the other's key text", () => {
    const a = geoEvidenceTargetKey({ kind: "own_page", url: 'https://acme.test/a","own_page","https://acme.test/b' });
    const b = geoEvidenceTargetKey({ kind: "own_page", url: "https://acme.test/b" });
    expect(a).not.toBe(b);
  });

  it("takes its gate identity from the gate's own rule", () => {
    expect(geoEvidenceGateKey("https://www.acme.test/pricing")).toBe("acme.test");
    expect(geoEvidenceGateKey("https://acme.test/pricing")).toBe("acme.test");
    expect(geoEvidenceGateKey("not a url")).toBeNull();
  });
});
