import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, type LogContext } from "../logger.ts";

/**
 * AC-040 runtime guard: the real logger must deep-redact `fields` before writing
 * the JSON line, so a secret passed as a log field can never reach stdout/stderr.
 * The logger writes directly to process streams (no injectable sink), so we spy
 * on the stream `write` and inspect the emitted line.
 */

const CONTEXT: LogContext = { service: "worker", environment: "test" };
// Obviously-fake credential values (secrets:scan must never flag these).
const FAKE_BEARER = "Bearer FAKE-not-a-real-token";
const FAKE_NESTED = "FAKE-nested-not-a-real-token";
const ORIGINAL_SENTINEL = "ORIGINAL-FIXTURE-MUST-NOT-APPEAR";
const FALLBACK_EVENT = "logger_emit_failed";
const FALLBACK_CODE = "LOG_EMIT_FAILED";

function captureStream(stream: NodeJS.WriteStream): { lines: () => string } {
  const writes: string[] = [];
  vi.spyOn(stream, "write").mockImplementation((chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  });
  return { lines: () => writes.join("") };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logger runtime redaction", () => {
  it("redacts secret fields before writing an info line to stdout", () => {
    const capture = captureStream(process.stdout);
    const logger = createLogger(CONTEXT, "debug");

    logger.info("token_exchange", {
      authorization: FAKE_BEARER,
      nested: { access_token: FAKE_NESTED },
      status: "ok",
    });

    const output = capture.lines();
    expect(output).not.toContain(FAKE_BEARER);
    expect(output).not.toContain(FAKE_NESTED);
    expect(output).toContain("[redacted]");

    const parsed = JSON.parse(output.trim()) as {
      authorization: unknown;
      nested: { access_token: unknown };
      status: unknown;
      event: unknown;
    };
    expect(parsed.authorization).toBe("[redacted]");
    expect(parsed.nested.access_token).toBe("[redacted]");
    // Non-secret correlation fields survive.
    expect(parsed.status).toBe("ok");
    expect(parsed.event).toBe("token_exchange");
  });

  it("redacts secret fields on error lines written to stderr", () => {
    const capture = captureStream(process.stderr);
    const logger = createLogger(CONTEXT, "debug");

    logger.error("oauth_failed", { cookie: FAKE_BEARER, api_key: FAKE_NESTED });

    const output = capture.lines();
    expect(output).not.toContain(FAKE_BEARER);
    expect(output).not.toContain(FAKE_NESTED);

    const parsed = JSON.parse(output.trim()) as {
      cookie: unknown;
      api_key: unknown;
    };
    expect(parsed.cookie).toBe("[redacted]");
    expect(parsed.api_key).toBe("[redacted]");
  });

  it("redacts OAuth/API-key/cookie/ciphertext values embedded in error.message", () => {
    const capture = captureStream(process.stderr);
    const logger = createLogger(CONTEXT, "debug");
    const oauthToken = `ya29.${"O".repeat(40)}`;
    const apiKey = `sk-${"A".repeat(32)}`;
    const cookie = `Cookie: sf_session=${"C".repeat(32)}`;
    const ciphertext = `token_cipher=${Buffer.from(
      "logger-ciphertext-fixture",
    ).toString("base64")}`;

    logger.error("provider_failed", {
      message: `upstream ${oauthToken} ${apiKey} ${cookie} ${ciphertext}`,
      code: "DEPENDENCY_UNAVAILABLE",
    });

    const output = capture.lines();
    for (const secret of [oauthToken, apiKey, cookie, ciphertext]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[redacted]");
    expect(output).toContain("DEPENDENCY_UNAVAILABLE");
  });

  it("does not leak labelled Bearer or Basic credential tails", () => {
    const capture = captureStream(process.stderr);
    const logger = createLogger(CONTEXT, "debug");
    const bearerValue = "B".repeat(36);
    const basicValue = Buffer.from("fake-basic-credential-fixture").toString(
      "base64",
    );

    logger.error("provider_failed", {
      message:
        `authorization=Bearer ${bearerValue}; ` +
        `authorization=Basic ${basicValue}`,
    });

    const output = capture.lines();
    expect(output).not.toContain(bearerValue);
    expect(output).not.toContain(basicValue);
    expect(output).toContain("[redacted]");
  });

  it("does not let caller fields override reserved log metadata", () => {
    const capture = captureStream(process.stderr);
    const logger = createLogger(CONTEXT, "debug");
    const fields: Record<string, unknown> = {
      timestamp: "attacker-controlled-time",
      level: "debug",
      event: "attacker_controlled_event",
      service: "web",
      environment: "production",
      status: "kept",
    };
    Reflect.defineProperty(fields, "__proto__", {
      enumerable: true,
      value: { safe: "prototype-field" },
    });

    logger.warn("trusted_event", fields);

    const parsed = JSON.parse(capture.lines().trim()) as Record<
      string,
      unknown
    >;
    expect(parsed["timestamp"]).not.toBe("attacker-controlled-time");
    expect(parsed["level"]).toBe("warn");
    expect(parsed["event"]).toBe("trusted_event");
    expect(parsed["service"]).toBe("worker");
    expect(parsed["environment"]).toBe("test");
    expect(parsed["status"]).toBe("kept");
    expect(parsed["__proto__"]).toEqual({ safe: "prototype-field" });
    expect(Object.prototype).not.toHaveProperty("safe");
  });

  it("normalizes environment levels, filters lower levels, and supports child context", () => {
    const stdout = captureStream(process.stdout);
    captureStream(process.stderr);

    for (const level of ["DEBUG", "info", "warn", "error", "invalid"]) {
      vi.stubEnv("LOG_LEVEL", level);
      createLogger(CONTEXT).debug(`level_${level}`);
    }
    vi.stubEnv("LOG_LEVEL", undefined);
    createLogger(CONTEXT).debug("level_default");

    const child = createLogger(CONTEXT, "debug").child({
      requestId: "request-child",
    });
    child.debug("child_debug");

    const lines = stdout
      .lines()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line["event"])).toEqual([
      "level_DEBUG",
      "child_debug",
    ]);
    expect(lines[1]?.["requestId"]).toBe("request-child");
  });

  it("marks a hostile root fields object without invoking its traps", () => {
    const capture = captureStream(process.stdout);
    const logger = createLogger(CONTEXT, "debug");
    const fields = new Proxy(Object.create(null), {
      ownKeys() {
        throw new Error(ORIGINAL_SENTINEL);
      },
    }) as Record<string, unknown>;

    expect(() => logger.info("root_proxy", fields)).not.toThrow();

    const parsed = JSON.parse(capture.lines().trim()) as Record<
      string,
      unknown
    >;
    expect(parsed["fields"]).toBe("[unavailable]");
    expect(capture.lines()).not.toContain(ORIGINAL_SENTINEL);
  });

  it("emits valid JSON for cycles, accessors, proxies, bigint, and binary fields", () => {
    const capture = captureStream(process.stdout);
    const logger = createLogger(CONTEXT, "debug");
    let getterCalls = 0;
    const fields: Record<string, unknown> = {
      bigint: 12n,
      bytes: new Uint8Array([1, 2, 3]),
      hostile: new Proxy(Object.create(null), {
        ownKeys() {
          throw new Error(ORIGINAL_SENTINEL);
        },
      }),
    };
    fields["self"] = fields;
    Object.defineProperty(fields, "computed", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(ORIGINAL_SENTINEL);
      },
    });

    expect(() => logger.info("hostile_fields", fields)).not.toThrow();

    const output = capture.lines();
    expect(output).not.toContain(ORIGINAL_SENTINEL);
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed["bigint"]).toBe("[unsupported]");
    expect(parsed["bytes"]).toBe("[binary]");
    expect(parsed["hostile"]).toBe("[unavailable]");
    expect(parsed["self"]).toBe("[circular]");
    expect(parsed["computed"]).toBe("[accessor]");
    expect(getterCalls).toBe(0);
  });

  it("uses a fixed secret-free fallback when serialization fails", () => {
    const capture = captureStream(process.stderr);
    vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error(ORIGINAL_SENTINEL);
    });
    const logger = createLogger(CONTEXT, "debug");

    expect(() =>
      logger.info(ORIGINAL_SENTINEL, { message: ORIGINAL_SENTINEL }),
    ).not.toThrow();

    const output = capture.lines();
    expect(output).toContain(FALLBACK_EVENT);
    expect(output).toContain(FALLBACK_CODE);
    expect(output).not.toContain(ORIGINAL_SENTINEL);
    expect(JSON.parse(output.trim())).toEqual({
      level: "error",
      event: FALLBACK_EVENT,
      code: FALLBACK_CODE,
    });
  });

  it("uses the fixed fallback when serialization returns no string", () => {
    const capture = captureStream(process.stderr);
    vi.spyOn(JSON, "stringify").mockImplementation(() => undefined as never);
    const logger = createLogger(CONTEXT, "debug");

    expect(() => logger.info(ORIGINAL_SENTINEL)).not.toThrow();

    expect(capture.lines()).toContain(FALLBACK_EVENT);
    expect(capture.lines()).not.toContain(ORIGINAL_SENTINEL);
  });

  it("uses the other process stream when the selected sink throws", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error(ORIGINAL_SENTINEL);
    });
    const capture = captureStream(process.stdout);
    const logger = createLogger(CONTEXT, "debug");

    expect(() =>
      logger.error(ORIGINAL_SENTINEL, { message: ORIGINAL_SENTINEL }),
    ).not.toThrow();

    const output = capture.lines();
    expect(output).toContain(FALLBACK_EVENT);
    expect(output).toContain(FALLBACK_CODE);
    expect(output).not.toContain(ORIGINAL_SENTINEL);
  });

  it("falls back to stderr when stdout throws", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => {
      throw new Error(ORIGINAL_SENTINEL);
    });
    const capture = captureStream(process.stderr);
    const logger = createLogger(CONTEXT, "debug");

    expect(() => logger.info(ORIGINAL_SENTINEL)).not.toThrow();

    expect(capture.lines()).toContain(FALLBACK_EVENT);
    expect(capture.lines()).not.toContain(ORIGINAL_SENTINEL);
  });

  it("swallows fallback sink failures without exposing the original record", () => {
    vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error(ORIGINAL_SENTINEL);
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error(ORIGINAL_SENTINEL);
    });
    const capture = captureStream(process.stdout);
    const logger = createLogger(CONTEXT, "debug");

    expect(() =>
      logger.info(ORIGINAL_SENTINEL, { message: ORIGINAL_SENTINEL }),
    ).not.toThrow();

    expect(capture.lines()).toContain(FALLBACK_EVENT);
    expect(capture.lines()).not.toContain(ORIGINAL_SENTINEL);
  });
});
