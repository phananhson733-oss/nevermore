import { describe, expect, it } from "vitest";
import {
  connectedSourceProviders,
  isConnectedSource,
  type ConnectableSource,
} from "./_connected-sources.ts";

function source(
  provider: string,
  state: string,
  id: string | null = `id-${provider}`,
): ConnectableSource {
  return { id, provider, state };
}

describe("isConnectedSource", () => {
  // The bug this pins: a source only sits at `connected` between the handshake
  // and its first collection. Counting that word alone reported zero connected
  // sources for a project whose sources were all working.
  it.each(["connected", "syncing", "available", "partial", "stale"])(
    "counts a live source in state %s",
    (state) => {
      expect(isConnectedSource(source("gsc", state))).toBe(true);
    },
  );

  it("counts a connection whose authorization or data went bad", () => {
    // The connection exists; it just cannot deliver right now. Dropping it here
    // would report "not connected" for something the operator must go and fix.
    expect(isConnectedSource(source("ga4", "permission_denied"))).toBe(true);
    expect(isConnectedSource(source("ga4", "unavailable"))).toBe(true);
  });

  it("does not count a handshake that has not completed", () => {
    expect(isConnectedSource(source("gsc", "connecting"))).toBe(false);
  });

  it("does not count a disconnected source", () => {
    expect(isConnectedSource(source("csv", "disconnected"))).toBe(false);
  });

  it("does not count a provider slot with no connection row", () => {
    expect(isConnectedSource(source("dataforseo", "disconnected", null))).toBe(
      false,
    );
    // Defence in depth: a slot without a row can never be reported as live.
    expect(isConnectedSource(source("dataforseo", "available", null))).toBe(
      false,
    );
  });
});

describe("connectedSourceProviders", () => {
  it("names the connected providers in wire order", () => {
    expect(
      connectedSourceProviders([
        source("crawl", "available"),
        source("gsc", "syncing"),
        source("ga4", "disconnected", null),
        source("csv", "connecting"),
        source("dataforseo", "stale"),
      ]),
    ).toEqual(["crawl", "gsc", "dataforseo"]);
  });

  it("is empty when nothing is connected", () => {
    expect(
      connectedSourceProviders([
        source("crawl", "disconnected", null),
        source("gsc", "connecting", null),
      ]),
    ).toEqual([]);
  });

  it("names each provider once", () => {
    expect(
      connectedSourceProviders([
        source("crawl", "available", "a"),
        source("crawl", "stale", "b"),
      ]),
    ).toEqual(["crawl"]);
  });
});
