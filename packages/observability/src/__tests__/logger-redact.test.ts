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
});
