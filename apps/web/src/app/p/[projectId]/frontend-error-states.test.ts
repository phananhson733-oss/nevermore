import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  csvPreviewEntries,
  sourceCollectLabelKey,
  sourceHintMessageKey,
  oauthCallbackMessageKey,
  resolveSourceRunId,
  sourceRunQueryOutcome,
  studioRunQueryOutcome,
  exportErrorMessageKey,
} from "./_frontend-error-state.ts";

function apiError(code: string, detail = "provider-secret-detail"): ApiError {
  return new ApiError({
    type: "about:blank",
    title: "Request failed",
    status: code === "RUN_ALREADY_ACTIVE" ? 409 : 503,
    code,
    detail,
    requestId: "test-request",
  });
}

describe("front-end run failure state", () => {
  it("treats a Sources query error as settled even if stale active data exists", () => {
    expect(
      sourceRunQueryOutcome(
        { status: "running" },
        apiError("DEPENDENCY_UNAVAILABLE"),
      ),
    ).toBe("query_error");
    expect(sourceRunQueryOutcome({ status: "completed" }, null)).toBe(
      "terminal",
    );
    expect(sourceRunQueryOutcome({ status: "running" }, null)).toBe("active");
    expect(sourceRunQueryOutcome(undefined, null)).toBe("loading");
  });

  it("does not re-seed a failed Sources run from a stale server projection", () => {
    expect(resolveSourceRunId(null, "run-1", "run-1")).toBeNull();
    expect(resolveSourceRunId("run-1", "run-1", "run-1")).toBe("run-1");
    expect(resolveSourceRunId(null, "run-2", "run-1")).toBe("run-2");
  });

  it("lets Studio error handling win over stale run data without changing terminal handling", () => {
    expect(
      studioRunQueryOutcome(
        { status: "running" },
        apiError("DEPENDENCY_UNAVAILABLE"),
      ),
    ).toBe("query_error");
    expect(studioRunQueryOutcome({ status: "failed" }, null)).toBe("terminal");
    expect(studioRunQueryOutcome({ status: "running" }, null)).toBe("active");
    expect(studioRunQueryOutcome(undefined, null)).toBe("loading");
  });

  it("maps source recovery hints and retry labels from stable UI state only", () => {
    expect(
      sourceHintMessageKey({
        state: "syncing",
        activeRun: {
          progress: { phase: "retry_wait" },
          lastError: { code: "RATE_LIMITED" },
        },
      }),
    ).toBe("rateLimitRetryScheduled");
    expect(
      sourceHintMessageKey({
        state: "permission_denied",
        activeRun: null,
      }),
    ).toBe("permissionReconnectRequired");
    expect(
      sourceHintMessageKey({
        state: "available",
        activeRun: null,
      }),
    ).toBeNull();

    expect(sourceCollectLabelKey("connected")).toBe("collectNow");
    expect(sourceCollectLabelKey("syncing")).toBe("collectNow");
    expect(sourceCollectLabelKey("available")).toBe("retryCollection");
    expect(sourceCollectLabelKey("partial")).toBe("retryCollection");
    expect(sourceCollectLabelKey("stale")).toBe("retryCollection");
    expect(sourceCollectLabelKey("unavailable")).toBe("retryCollection");
  });
});

describe("allowlisted front-end error guidance", () => {
  it.each([
    ["OAUTH_STATE_REPLAYED", "oauthStateReplayed"],
    ["OAUTH_STATE_EXPIRED", "oauthStateExpired"],
    ["OAUTH_CONSENT_DENIED", "oauthConsentDenied"],
    ["OAUTH_EXCHANGE_FAILED", "oauthExchangeFailed"],
  ] as const)("maps OAuth callback %s to %s", (code, expected) => {
    expect(oauthCallbackMessageKey(code)).toBe(expected);
  });

  it("maps unknown or attacker-controlled OAuth callback text to a generic key", () => {
    expect(oauthCallbackMessageKey("<img src=x onerror=alert(1)>")).toBe(
      "oauthError",
    );
    expect(oauthCallbackMessageKey(null)).toBe("oauthError");
  });

  it("distinguishes active and unavailable export failures with a generic fallback", () => {
    expect(exportErrorMessageKey(apiError("RUN_ALREADY_ACTIVE"))).toBe(
      "exportAlreadyActive",
    );
    expect(exportErrorMessageKey(apiError("DEPENDENCY_UNAVAILABLE"))).toBe(
      "exportDependencyUnavailable",
    );
    expect(exportErrorMessageKey(apiError("UNKNOWN_PROVIDER_DETAIL"))).toBe(
      "exportFailed",
    );
    expect(exportErrorMessageKey(new Error("raw provider response"))).toBe(
      "exportFailed",
    );
  });
});

describe("CSV preview accessibility", () => {
  it("builds labelled fields for every mobile preview row", () => {
    expect(
      csvPreviewEntries(
        ["keyword", "search_volume"],
        [{ keyword: "signal frame", search_volume: 120 }],
      ),
    ).toEqual([
      {
        rowNumber: 1,
        fields: [
          { label: "keyword", value: "signal frame" },
          { label: "search_volume", value: "120" },
        ],
      },
    ]);
  });

  it("renders a semantic table caption and a mobile definition-list alternative", () => {
    const source = readFileSync(
      new URL("./sources/_sources.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/<caption>\{caption\}<\/caption>/);
    expect(source).toMatch(/<ol[^>]*className=\{styles\.previewCards\}/);
    expect(source).toMatch(/<dl[^>]*className=\{styles\.previewCardFields\}/);
    expect(source).toMatch(/<dt[^>]*>\{field\.label\}<\/dt>/);
    expect(source).toMatch(/<dd[^>]*>\{field\.value\}<\/dd>/);
  });

  it("switches from cards to the table at the wide-screen breakpoint", () => {
    const css = readFileSync(
      new URL("./sources/sources.module.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(/\.previewCards\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.previewWrap\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(
      /@media\s*\(min-width:\s*640px\)[\s\S]*\.previewWrap\s*\{[^}]*display:\s*block[\s\S]*\.previewCards\s*\{[^}]*display:\s*none/s,
    );
  });
});
