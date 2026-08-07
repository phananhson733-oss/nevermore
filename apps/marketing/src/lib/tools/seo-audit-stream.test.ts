import { describe, expect, it, vi } from "vitest";
import {
  readSeoAuditStream,
  type SeoAuditStreamEvent,
} from "./seo-audit-stream.ts";

function streamOf(...chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function ndjsonResponse(...chunks: readonly string[]): Response {
  return new Response(streamOf(...chunks), {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

async function collect(response: Response): Promise<SeoAuditStreamEvent[]> {
  const events: SeoAuditStreamEvent[] = [];
  await readSeoAuditStream(response, (event) => events.push(event));
  return events;
}

const payload = { run: { tool: "seo_audit" }, result: { pages: [] } };

describe("readSeoAuditStream", () => {
  it("reports each progress line then the terminal result", async () => {
    const events = await collect(
      ndjsonResponse(
        '{"progress":{"pagesCrawled":0,"requestsSent":1}}\n',
        '{"progress":{"pagesCrawled":0,"requestsSent":4}}\n',
        `${JSON.stringify({ data: payload })}\n`,
      ),
    );

    expect(events).toEqual([
      { kind: "progress", pagesCrawled: 0, requestsSent: 1 },
      { kind: "progress", pagesCrawled: 0, requestsSent: 4 },
      { kind: "result", payload },
    ]);
  });

  /**
   * The crawl ending is not the run ending: the report is built over up to
   * 2,000 pages, serialized and cached afterwards. That window is the server's
   * to report, because only the server knows when `crawlSite` returned.
   */
  it("reports the report-building stage without ending the run", async () => {
    const events = await collect(
      ndjsonResponse(
        '{"progress":{"pagesCrawled":3,"requestsSent":37}}\n',
        '{"stage":"building_report"}\n',
        `${JSON.stringify({ data: payload })}\n`,
      ),
    );

    expect(events).toEqual([
      { kind: "progress", pagesCrawled: 3, requestsSent: 37 },
      { kind: "stage", stage: "building_report" },
      { kind: "result", payload },
    ]);
  });

  /**
   * A stage this client has no copy for must not be rendered as one it does.
   * Skipping it leaves the panel on the last thing it can honestly say.
   */
  it("ignores a stage it does not know", async () => {
    const events = await collect(
      ndjsonResponse(
        '{"stage":"reticulating_splines"}\n',
        `${JSON.stringify({ data: payload })}\n`,
      ),
    );

    expect(events).toEqual([{ kind: "result", payload }]);
  });

  /**
   * The three shipped Playwright specs fulfil one JSON object with no trailing
   * newline. If the trailing buffer were dropped at reader-done the report
   * would never render and the only test that covers the rendered report would
   * go red — so this is the compatibility clause, not a nicety.
   */
  it("parses a single buffered object that never ends in a newline", async () => {
    const events = await collect(
      new Response(JSON.stringify({ data: payload }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(events).toEqual([{ kind: "result", payload }]);
  });

  it("reassembles one JSON value split across chunk boundaries", async () => {
    const line = JSON.stringify({ data: payload });
    const events = await collect(
      ndjsonResponse(
        line.slice(0, 9),
        line.slice(9, 20),
        `${line.slice(20)}\n`,
      ),
    );

    expect(events).toEqual([{ kind: "result", payload }]);
  });

  it("reports a mid-stream error line after the progress it already sent", async () => {
    const events = await collect(
      ndjsonResponse(
        '{"progress":{"pagesCrawled":0,"requestsSent":12}}\n',
        '{"error":{"code":"scan_timeout"}}\n',
      ),
    );

    expect(events).toEqual([
      { kind: "progress", pagesCrawled: 0, requestsSent: 12 },
      { kind: "error", code: "scan_timeout" },
    ]);
  });

  it("ignores a malformed segment rather than losing the run", async () => {
    const events = await collect(
      ndjsonResponse(
        "not json at all\n",
        '{"progress":{"pagesCrawled":0,"requestsSent":2}}\n',
        '{"unrecognised":true}\n',
        `${JSON.stringify({ data: payload })}\n`,
      ),
    );

    expect(events).toEqual([
      { kind: "progress", pagesCrawled: 0, requestsSent: 2 },
      { kind: "result", payload },
    ]);
  });

  it("tolerates CRLF framing", async () => {
    const events = await collect(
      ndjsonResponse(
        '{"progress":{"pagesCrawled":0,"requestsSent":3}}\r\n',
        `${JSON.stringify({ data: payload })}\r\n`,
      ),
    );

    expect(events).toEqual([
      { kind: "progress", pagesCrawled: 0, requestsSent: 3 },
      { kind: "result", payload },
    ]);
  });

  it("reads a non-ok error envelope, which the gate still returns unstreamed", async () => {
    const events = await collect(
      new Response(JSON.stringify({ error: { code: "rate_limited" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(events).toEqual([{ kind: "error", code: "rate_limited" }]);
  });

  /**
   * A stream that dies before its terminal line is an answer we did not get.
   * Saying so is what keeps today's behaviour — a body that could not be read
   * has always surfaced as the generic message, never as a blank success.
   */
  it("ends with an unknown error when no terminal line ever arrives", async () => {
    const events = await collect(
      ndjsonResponse('{"progress":{"pagesCrawled":0,"requestsSent":9}}\n'),
    );

    expect(events).toEqual([
      { kind: "progress", pagesCrawled: 0, requestsSent: 9 },
      { kind: "error", code: "unknown" },
    ]);
  });

  /**
   * The caller renders `payload.result`. A `data` object without one is not an
   * audit, and accepting it set an undefined report and reported success — a
   * finished run with no report and no error on screen.
   */
  it.each([
    ["no result key", { data: { run: { tool: "seo_audit" } } }],
    ["a null result", { data: { run: { tool: "seo_audit" }, result: null } }],
    ["a non-object result", { data: { result: "ok" } }],
  ])("refuses a terminal data line with %s", async (_label, line) => {
    const events = await collect(ndjsonResponse(`${JSON.stringify(line)}\n`));

    expect(events).toEqual([{ kind: "error", code: "unknown" }]);
  });

  it("reports an unknown error when the response carries no body", async () => {
    const events = await collect(new Response(null, { status: 502 }));

    expect(events).toEqual([{ kind: "error", code: "unknown" }]);
  });

  /**
   * The terminal line ends the run. Anything after it — a second result, a
   * late error — is not an answer the reader may act on, and the socket is
   * released rather than drained.
   */
  it("stops at the terminal line and cancels the rest of the body", async () => {
    const encoder = new TextEncoder();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ data: payload })}\n` +
              '{"error":{"code":"scan_failed"}}\n',
          ),
        );
      },
      cancel: cancelled,
    });

    const events = await collect(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      }),
    );

    expect(events).toEqual([{ kind: "result", payload }]);
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
