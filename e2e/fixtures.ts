import { createHash, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";

/**
 * E2E seeding helpers. Under the dev-auth shim every request is the fixed local
 * operator, so a project can be created straight through the public HTTP API with
 * no login step (spec §14.1). The first call auto-provisions the singleton
 * "SignalFrame" workspace (apps/web/src/lib/auth/session.ts).
 */

/** The seven authenticated project screens reachable after create (spec §11). */
export const PROJECT_SCREENS = [
  "overview",
  "context",
  "sources",
  "diagnosis",
  "plan",
  "studio",
  "report",
] as const;

export type ProjectScreen = (typeof PROJECT_SCREENS)[number];

export interface SeededProject {
  readonly projectId: string;
  readonly siteUrl: string;
}

export interface ConfirmedProjectContextOverrides {
  readonly productName?: string;
  readonly oneLineDescription?: string;
}

/**
 * Public IP literals keep the SSRF guard exercised without depending on live DNS.
 * Hashing accepts human-readable deterministic seeds without collapsing them
 * through partial hexadecimal parsing. The 24-bit host space makes accidental
 * collisions negligible for this serial suite, but callers that require distinct
 * deterministic origins should still provide distinct seeds.
 */
export function publicFixtureOrigin(seed: string = randomUUID()): string {
  const digest = createHash("sha256").update(seed).digest();
  const octets = [digest[0], digest[1], digest[2]].map(
    (value) => ((value ?? 0) % 254) + 1,
  );
  return `https://11.${octets.join(".")}`;
}

/**
 * Create a project (+ primary site + default Crawl source) via `POST
 * /api/mvp/projects` and return its id. A public IP literal avoids transient DNS
 * failures while still exercising the server-side SSRF guard (spec §7.1).
 */
export async function seedProject(
  request: APIRequestContext,
  overrides: Partial<{
    clientName: string;
    projectName: string;
    siteUrl: string;
  }> = {},
): Promise<SeededProject> {
  const siteUrl = overrides.siteUrl ?? publicFixtureOrigin();
  const response = await request.post("/api/mvp/projects", {
    headers: { "Idempotency-Key": randomUUID() },
    data: {
      clientName: overrides.clientName ?? `E2E Client ${randomUUID().slice(0, 8)}`,
      projectName: overrides.projectName ?? `E2E Project ${randomUUID().slice(0, 8)}`,
      siteUrl,
      marketCodes: ["US"],
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
    },
  });
  if (!response.ok()) {
    throw new Error(
      `seedProject failed: ${response.status()} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { data: { id: string } };
  return { projectId: body.data.id, siteUrl };
}

/**
 * Confirm the manually supplied Product / ICP context before a fixture enters
 * Sources. Production enforces the same ordering at both the page and OAuth
 * service boundaries; browser fixtures must not bypass that customer workflow.
 */
export async function confirmSeededProjectContext(
  request: APIRequestContext,
  project: SeededProject,
  overrides: ConfirmedProjectContextOverrides = {},
): Promise<void> {
  const origin = new URL(project.siteUrl).origin;
  const response = await request.patch(
    `/api/mvp/projects/${project.projectId}/context`,
    {
      data: {
        mode: "complete",
        baseVersion: 0,
        profile: {
          productName: overrides.productName ?? "E2E Product",
          oneLineDescription:
            overrides.oneLineDescription ??
            "A manually confirmed product profile used for customer-flow verification.",
          customerModel: "b2b",
          businessProfile: "b2b_saas",
          businessProfileNote: null,
          marketCodes: ["US"],
          siteLanguageCodes: ["en"],
          defaultDeliveryLocale: "en",
          segments: ["Mid-market B2B teams"],
          personas: [
            {
              name: "Growth lead",
              roleOrContext: "Owns the product growth program",
              jobs: ["Prioritize evidence-backed growth work"],
              painPoints: ["Growth evidence is fragmented across systems"],
            },
          ],
          useCases: ["Connect first-party data to a product growth workspace"],
          offers: ["A connected growth operations workspace"],
          differentiators: ["Recommendations remain traceable to source evidence"],
          primaryConversion: {
            label: "Contact sales",
            type: "contact",
            targetUrl: `${origin}/contact`,
          },
          priorityProductsOrServices: ["Growth operations workspace"],
          priorityUrls: [origin],
          competitors: [],
          brandConstraints: [],
          complianceConstraints: [],
          technicalConstraints: [],
          resourceConstraints: [],
          growthQuestions: ["Which evidence-backed opportunity should ship next?"],
          ninetyDayGoals: ["Connect sources and ship the highest-impact work."],
        },
      },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `confirmSeededProjectContext failed: ${response.status()} ${await response.text()}`,
    );
  }
}
