import { randomUUID } from "node:crypto";
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

/**
 * Create a project (+ primary site + default Crawl source) via `POST
 * /api/mvp/projects` and return its id. `example.com` resolves to a real public
 * IP so the server-side SSRF guard admits it (spec §7.1).
 */
export async function seedProject(
  request: APIRequestContext,
  overrides: Partial<{
    clientName: string;
    projectName: string;
    siteUrl: string;
  }> = {},
): Promise<SeededProject> {
  const siteUrl = overrides.siteUrl ?? "https://example.com";
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
