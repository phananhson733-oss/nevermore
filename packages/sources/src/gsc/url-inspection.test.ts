// @input  -- stubbed URL Inspection responses, whole and partial
// @output -- proof the census is all-or-nothing and stays under the site rate
// @pos    -- unit coverage for the producer behind A1

import { describe, expect, it } from "vitest";

import { inspectUrlIndexStatus } from "./url-inspection.ts";

const SITE = "sc-domain:acme.test";
const urls = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://acme.test/p${i}`);

function respond(verdict: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      inspectionResult: { indexStatusResult: { verdict } },
    }),
  } as unknown as Response;
}

const FAILED = { ok: false, status: 500 } as unknown as Response;

/**
 * A clock that moves when the code sleeps AND when a request goes out.
 *
 * Requests have to cost time or the budget test is vacuous: with fetches free,
 * a run that skips its pacing sleeps finishes five hundred URLs at t=0 and the
 * wall-clock ceiling is never reached in the fake even though it always would
 * be in production.
 */
function fakeClock(perRequestMs = 40) {
  let t = 0;
  let slept = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      slept += ms;
    },
    tick: () => {
      t += perRequestMs;
    },
    slept: () => slept,
  };
}

async function run(
  responses: readonly Response[],
  overrides: Partial<Parameters<typeof inspectUrlIndexStatus>[0]> = {},
) {
  let call = 0;
  const clock = fakeClock();
  const result = await inspectUrlIndexStatus({
    siteUrl: SITE,
    accessToken: "token",
    urls: urls(responses.length),
    fetchImpl: async () => {
      clock.tick();
      return responses[call++] ?? FAILED;
    },
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  });
  return { result, clock };
}

describe("URL Inspection census", () => {
  it("returns every verdict when every URL answered", async () => {
    const { result } = await run([
      respond("PASS"),
      respond("NEUTRAL"),
      respond("PASS"),
    ]);

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.statuses).toHaveLength(3);
  });

  it("refuses the whole census when even one URL went unanswered", async () => {
    // The defect this exists to prevent: one indexed page plus a pile of
    // failed requests renders as 100% index coverage and clears the 90% rail,
    // because the denominator becomes "the URLs Google felt like answering".
    const { result } = await run([
      respond("PASS"),
      FAILED,
      respond("PASS"),
    ]);

    expect(result).toEqual({
      status: "unavailable",
      reason: "provider_unavailable",
    });
  });

  it("refuses on a malformed verdict rather than dropping the row", async () => {
    const bad = {
      ok: true,
      status: 200,
      json: async () => ({
        inspectionResult: { indexStatusResult: { verdict: "SOMETHING_NEW" } },
      }),
    } as unknown as Response;

    expect((await run([respond("PASS"), bad])).result.status).toBe(
      "unavailable",
    );
  });

  it("names an exhausted quota rather than calling it unavailable", async () => {
    const throttled = { ok: false, status: 429 } as unknown as Response;
    const { result } = await run([respond("PASS"), throttled]);

    expect(result).toEqual({ status: "unavailable", reason: "quota_exhausted" });
  });

  it("names a rejected grant", async () => {
    const denied = { ok: false, status: 403 } as unknown as Response;

    expect(await run([denied]).then((r) => r.result)).toEqual({
      status: "unavailable",
      reason: "not_authorized",
    });
  });

  it("paces itself under the published per-site rate", async () => {
    // Concurrency is not a rate limit. The ceiling is per SITE and shared with
    // every other tool the customer points at the property, so running flat out
    // spends quota their other workflows were relying on.
    const calls = 50;
    const { clock } = await run(
      Array.from({ length: calls }, () => respond("PASS")),
      { budgetMs: 10 * 60_000 },
    );

    // The rate that matters is requests per minute of wall clock, not how long
    // the code chose to sleep — pacing correctly subtracts however long the
    // requests themselves took, so asserting the sleep total would move every
    // time the fake's per-request cost changed.
    const perMinute = (calls / clock.now()) * 60_000;
    // Asserted against Google's published per-site ceiling, which is the
    // contract. The module aims at half of it as a margin for the customer's
    // other tools, but a short run measures a little over that half because
    // the final batch needs no trailing pause — over-specifying the margin
    // would make this test fail on arithmetic that is working as intended.
    expect(perMinute).toBeLessThan(600);
    // And it is genuinely paced, not just concurrency-limited: unpaced, fifty
    // requests at 40ms each would clear in two seconds, i.e. 1500/min.
    expect(perMinute).toBeLessThan(400);
  });

  it("stops rather than overrunning its wall-clock budget", async () => {
    const { result } = await run(
      Array.from({ length: 500 }, () => respond("PASS")),
      { budgetMs: 1_000 },
    );

    expect(result.status).toBe("unavailable");
  });
});
