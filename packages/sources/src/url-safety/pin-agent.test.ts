import type { LookupFunction } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createPinnedAgent } from "./pin-agent.ts";

const agentState = vi.hoisted(() => ({
  options: [] as unknown[],
}));

vi.mock("undici", () => ({
  Agent: class FakeAgent {
    constructor(options: unknown) {
      agentState.options.push(options);
    }
  },
}));

interface CapturedConnectOptions {
  readonly servername?: string;
  readonly rejectUnauthorized?: boolean;
  readonly checkServerIdentity?: unknown;
  readonly lookup?: LookupFunction;
}

function capturedConnectOptions(): CapturedConnectOptions {
  const options = agentState.options.at(-1);
  const connect =
    typeof options === "object" && options !== null
      ? Reflect.get(options, "connect")
      : null;
  if (typeof connect !== "object" || connect === null) {
    throw new Error("expected pinned Agent connect options");
  }
  return connect as CapturedConnectOptions;
}

function resolveWithLookup(
  lookup: LookupFunction,
  hostname: string,
  all: boolean,
): Promise<{
  address: string | readonly { address: string; family: number }[];
  family?: number;
}> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all }, (error, address, family) => {
      if (error) reject(error);
      else if (family === undefined) resolve({ address });
      else resolve({ address, family });
    });
  });
}

describe("createPinnedAgent", () => {
  it("forces every socket lookup to the guard-validated IP instead of resolving the hostname again", async () => {
    createPinnedAgent("rebind.example", "93.184.216.34");
    const connect = capturedConnectOptions();

    expect(connect.servername).toBe("rebind.example");
    expect(connect.rejectUnauthorized).not.toBe(false);
    expect(connect.checkServerIdentity).toBeUndefined();
    expect(connect.lookup).toBeTypeOf("function");
    const lookup = connect.lookup as LookupFunction;
    await expect(resolveWithLookup(lookup, "rebind.example", false)).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    });
    await expect(resolveWithLookup(lookup, "rebind.example", true)).resolves.toEqual({
      address: [{ address: "93.184.216.34", family: 4 }],
      family: undefined,
    });
  });

  it("keeps the original HTTPS hostname as SNI when an IPv6 address is pinned", async () => {
    createPinnedAgent("secure.example", "2606:2800:220:1:248:1893:25c8:1946");
    const connect = capturedConnectOptions();

    expect(connect.servername).toBe("secure.example");
    const lookup = connect.lookup as LookupFunction;
    await expect(resolveWithLookup(lookup, "secure.example", false)).resolves.toEqual({
      address: "2606:2800:220:1:248:1893:25c8:1946",
      family: 6,
    });
  });

  it("omits SNI for an IP-literal URL while retaining the validated address", async () => {
    createPinnedAgent(
      "[2606:2800:220:1:248:1893:25c8:1946]",
      "2606:2800:220:1:248:1893:25c8:1946",
    );
    const connect = capturedConnectOptions();

    expect(connect.servername).toBeUndefined();
    const lookup = connect.lookup as LookupFunction;
    await expect(
      resolveWithLookup(
        lookup,
        "2606:2800:220:1:248:1893:25c8:1946",
        false,
      ),
    ).resolves.toMatchObject({ family: 6 });
  });

  it("fails closed instead of handing an invalid pin back to DNS", () => {
    expect(() => createPinnedAgent("secure.example", "not-an-ip")).toThrow(
      "not an IP address",
    );
  });
});
