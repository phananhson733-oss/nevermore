import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  DISCONNECT_ENDPOINT,
  DISCONNECT_NOTICE_KEYS,
  disconnectNoticeKey,
  requestDisconnect,
  type DisconnectOutcome,
} from "./disconnect-request.ts";

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function bundle(locale: "en" | "zh"): Record<string, Record<string, string>> {
  const path = fileURLToPath(
    new URL(`../../i18n/messages/${locale}.json`, import.meta.url),
  );
  return (
    JSON.parse(readFileSync(path, "utf8")) as {
      tools: Record<string, Record<string, string>>;
    }
  ).tools;
}

describe("requestDisconnect", () => {
  it("posts to the logout route with the visitor's own cookies", async () => {
    const fetchImpl = vi.fn(async () =>
      reply({ data: { signedOut: true, revokedAtGoogle: true } }),
    );

    await requestDisconnect(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(DISCONNECT_ENDPOINT);
    expect(call[1].method).toBe("POST");
    // The route rejects a cross-origin POST, and the cookies it clears are
    // this origin's.
    expect(call[1].credentials).toBe("same-origin");
  });

  it("reports a cleared browser when Google confirmed the revocation", async () => {
    const outcome = await requestDisconnect((async () =>
      reply({
        data: { signedOut: true, revokedAtGoogle: true },
      })) as unknown as typeof fetch);

    expect(outcome).toEqual({ kind: "cleared" });
  });

  it("reports a cleared browser when there was nothing to revoke", async () => {
    // `null` is not a failure: no credential was held, so nothing at Google
    // needed removing and the visitor has nothing left to do.
    const outcome = await requestDisconnect((async () =>
      reply({
        data: { signedOut: true, revokedAtGoogle: null },
      })) as unknown as typeof fetch);

    expect(outcome).toEqual({ kind: "cleared" });
  });

  it("does not call an unconfirmed revocation a success", async () => {
    // The credential is out of this browser either way. Whether it is still
    // live at Google is the part the visitor has to act on, and reporting it
    // as done would be the one claim they cannot check.
    const outcome = await requestDisconnect((async () =>
      reply({
        data: { signedOut: true, revokedAtGoogle: false },
      })) as unknown as typeof fetch);

    expect(outcome).toEqual({ kind: "cleared_not_revoked" });
  });

  it("treats a refused request as nothing having changed", async () => {
    const outcome = await requestDisconnect((async () =>
      reply(
        { error: { code: "cross_origin" } },
        403,
      )) as unknown as typeof fetch);

    expect(outcome).toEqual({ kind: "failed" });
  });

  it("treats a network failure as nothing having changed", async () => {
    const outcome = await requestDisconnect((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);

    expect(outcome).toEqual({ kind: "failed" });
  });

  it("keeps a 200 with an unreadable body on the cleared side", async () => {
    // The route already cleared the cookies before it wrote that body. Calling
    // it a failure would tell the visitor to retry a disconnect that happened.
    const outcome = await requestDisconnect(
      (async () =>
        new Response("not json", { status: 200 })) as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ kind: "cleared" });
  });
});

describe("disconnectNoticeKey", () => {
  it("says nothing before a disconnect has been attempted", () => {
    expect(disconnectNoticeKey(null)).toBeNull();
  });

  it("says nothing when the disconnect did everything it claims", () => {
    // A page that reloads into the connect panel has already said it.
    expect(disconnectNoticeKey({ kind: "cleared" })).toBeNull();
  });

  it("has something to say for every outcome the visitor must act on", () => {
    const outcomes: readonly DisconnectOutcome[] = [
      { kind: "cleared_not_revoked" },
      { kind: "failed" },
    ];

    for (const outcome of outcomes) {
      expect(disconnectNoticeKey(outcome), outcome.kind).not.toBeNull();
    }
  });
});

describe("disconnect copy", () => {
  const NAMESPACES = ["quickWins", "trafficDrop"] as const;

  it.each(["en", "zh"] as const)(
    "carries every disconnect key in %s, for both connected tools",
    (locale) => {
      const tools = bundle(locale);
      for (const namespace of NAMESPACES) {
        for (const key of DISCONNECT_NOTICE_KEYS) {
          const value = tools[namespace]?.[key];
          expect(value, `${locale}.tools.${namespace}.${key}`).toBeTruthy();
        }
      }
    },
  );

  it("keeps the Chinese copy in Chinese", () => {
    const tools = bundle("zh");
    for (const namespace of NAMESPACES) {
      for (const key of DISCONNECT_NOTICE_KEYS) {
        expect(tools[namespace]?.[key], `zh.tools.${namespace}.${key}`).toMatch(
          /[一-鿿]/,
        );
      }
    }
  });
});
