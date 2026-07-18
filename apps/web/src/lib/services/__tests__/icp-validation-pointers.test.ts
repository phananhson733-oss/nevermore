import type { NextRequest } from "next/server";
import { UpdateContextRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { describe, expect, it } from "vitest";
import { parseJsonBody } from "@/lib/http/validate";

/**
 * AC-008 (spec §6.2, §11.1): a `mode=complete` ICP save with missing required
 * fields must fail as `application/problem+json` 422 (`VALIDATION_ERROR`) whose
 * `errors` is a POINTER ARRAY — one entry per missing field, each addressed by a
 * JSON pointer at the field's instance path (`/profile/<field>`), and each entry
 * shaped `{ pointer, code, message }` to match the OpenAPI `Problem.errors` item.
 *
 * This drives the real route-contract path (`parseJsonBody` + `UpdateContextRequest`),
 * so it asserts the envelope shape the client actually receives, not just status.
 * Validation is pure (Zod), so this is a unit test with no database.
 */

/** A minimal request whose body is `obj` serialized as JSON (only `.text()`/headers are used). */
function jsonRequest(obj: unknown): NextRequest {
  const body = JSON.stringify(obj);
  return new Request("http://localhost/api/mvp/projects/p/context", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  }) as unknown as NextRequest;
}

/** A fully valid complete-mode profile (positive control). */
const completeProfile = () => ({
  productName: "Acme Analytics",
  oneLineDescription: "Product analytics for B2B SaaS teams.",
  customerModel: "b2b" as const,
  businessProfile: "b2b_saas" as const,
  businessProfileNote: null,
  marketCodes: ["US", "GB"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
  segments: ["Growth teams"],
  personas: [
    {
      name: "PM Pat",
      roleOrContext: "Product manager",
      jobs: ["ship features"],
      painPoints: ["no data"],
    },
  ],
  useCases: ["Funnel analysis"],
  offers: ["Self-serve plan"],
  differentiators: ["Warehouse-native"],
  primaryConversion: { label: "Book a demo", type: "demo" as const, targetUrl: null },
  priorityProductsOrServices: ["Dashboards"],
  priorityUrls: [],
  competitors: [],
  brandConstraints: [],
  complianceConstraints: [],
  technicalConstraints: [],
  resourceConstraints: [],
  growthQuestions: ["How to grow signups?"],
  ninetyDayGoals: ["Double organic signups"],
});

/** Run `parseJsonBody` and return the thrown ProblemError, or fail if none was thrown. */
async function expectProblem(obj: unknown): Promise<ProblemError> {
  let caught: unknown;
  try {
    await parseJsonBody(jsonRequest(obj), UpdateContextRequest);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProblemError);
  return caught as ProblemError;
}

describe("AC-008 — complete ICP validation surfaces a pointer array", () => {
  it("accepts a full valid complete profile (positive control)", async () => {
    const parsed = await parseJsonBody(
      jsonRequest({ mode: "complete", baseVersion: 0, profile: completeProfile() }),
      UpdateContextRequest,
    );
    expect(parsed.mode).toBe("complete");
  });

  it("accepts a partial/null draft patch (positive control)", async () => {
    const parsed = await parseJsonBody(
      jsonRequest({
        mode: "draft",
        baseVersion: 0,
        profile: { productName: "x", oneLineDescription: null },
      }),
      UpdateContextRequest,
    );
    expect(parsed.mode).toBe("draft");
  });

  it("rejects a near-empty complete profile with a 422 problem+json pointer array", async () => {
    const problem = await expectProblem({
      mode: "complete",
      baseVersion: 0,
      profile: { productName: "only this" },
    });

    // Envelope: 422 VALIDATION_ERROR (spec §11.1).
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.status).toBe(422);

    const errors = problem.fieldErrors;
    expect(Array.isArray(errors)).toBe(true);
    const pointers = (errors ?? []).map((e) => e.pointer);

    // One entry per missing field — each a JSON pointer at the field instance path.
    for (const field of [
      "/profile/oneLineDescription",
      "/profile/customerModel",
      "/profile/businessProfile",
      "/profile/marketCodes",
      "/profile/siteLanguageCodes",
      "/profile/defaultDeliveryLocale",
      "/profile/segments",
      "/profile/personas",
      "/profile/useCases",
      "/profile/offers",
      "/profile/differentiators",
      "/profile/primaryConversion",
      "/profile/priorityProductsOrServices",
      "/profile/growthQuestions",
      "/profile/ninetyDayGoals",
    ]) {
      expect(pointers).toContain(field);
    }

    // A pointer ARRAY, not a single generic error, and one entry per field (no dups).
    expect(pointers.length).toBeGreaterThanOrEqual(15);
    expect(new Set(pointers).size).toBe(pointers.length);

    // Every entry matches the OpenAPI Problem.errors item shape: pointer/code/message.
    for (const e of errors ?? []) {
      expect(typeof e.pointer).toBe("string");
      expect(e.pointer.startsWith("/profile/")).toBe(true);
      expect(typeof e.code).toBe("string");
      expect(typeof e.message).toBe("string");
    }
  });

  it("points at /profile/businessProfileNote when businessProfile is 'other' but the note is absent", async () => {
    const problem = await expectProblem({
      mode: "complete",
      baseVersion: 0,
      profile: {
        ...completeProfile(),
        businessProfile: "other",
        businessProfileNote: null,
      },
    });
    expect(problem.code).toBe("VALIDATION_ERROR");
    expect(problem.status).toBe(422);
    const pointers = (problem.fieldErrors ?? []).map((e) => e.pointer);
    expect(pointers).toContain("/profile/businessProfileNote");
  });

  it("addresses nested array items with an indexed pointer (e.g. a persona missing jobs)", async () => {
    const profile = completeProfile();
    const problem = await expectProblem({
      mode: "complete",
      baseVersion: 0,
      profile: {
        ...profile,
        personas: [{ name: "P", roleOrContext: "PM", jobs: [], painPoints: ["x"] }],
      },
    });
    const pointers = (problem.fieldErrors ?? []).map((e) => e.pointer);
    expect(pointers).toContain("/profile/personas/0/jobs");
  });
});
