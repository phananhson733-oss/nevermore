// @input  -- one knowledge base's identity, as any payload version stores it
// @output -- the deterministic list of pages one update observes, and the ledger seeds for the whole run
// @pos    -- pure: it fetches nothing, opens no gate, reads no clock and touches no store

/**
 * What a knowledge base update looks at, decided before anything is spent.
 *
 * Two properties this file exists to hold:
 *
 *  - **A key is derived from the draft, never from a position.** Resuming a run
 *    reads its rows by key, so a key that shifted when the plan changed would
 *    authorise a second charge for work already paid for. Every key here comes
 *    from the target's own URL.
 *
 *  - **One operation per crawl-gate target, not per URL.** `openCrawlGate`
 *    budgets four runs an hour against the *apex* host
 *    (`canonicalCrawlTargetKey` strips `www.`), and GEO shares that budget with
 *    the Profile scan, seo-audit and internal-link-audit. Two targets that
 *    differ only by `www.` are one allowance, so planning them as two
 *    operations would spend a site's whole hour on one update. They are
 *    collapsed here, and the first one planned wins.
 *
 * The URL kept is the one the draft names, `www.` included. Normalising it to
 * the apex is the mistake that made every www-only site's diagnostic fail: the
 * canonical host is the gate's budgeting identity, not the address that answers.
 *
 * What this plan does NOT list, and why
 * ------------------------------------
 * The site's own `/robots.txt`, `/sitemap.xml` and `/llms.txt` are observed by
 * every update, and no target here names them. They are read INSIDE the own
 * page's own operation, through the reader that operation already built, and
 * filed under the `robots` / `sitemap` / `llms` observation kinds -- see
 * `recordMachineSignals` in `kb-run-collect-executor.ts`.
 *
 * Planning them as targets of their own would be the same mistake this file
 * exists to prevent, one level down: each would become its own operation with
 * its own reader, and each reader opens the crawl gate afresh, so one update
 * would spend four of a site's four hourly admissions instead of one. (The
 * ledger's `kind` column is a CHECK over `fetch|serp|gsc|model` besides, so a
 * fourth kind would need a migration to say something that is not even true.)
 */

import { normalizeAccountWebsiteUrl } from "../account-websites/contracts.ts";
import type { GeoEvidenceObservationKind } from "./kb-evidence-observations.ts";
import { geoEvidenceGateKey } from "./kb-evidence-reuse.ts";
import type { GeoRunOperationSeed } from "./kb-run-ledger.ts";
import { geoRunOperationKey } from "./kb-run-plan.ts";

/**
 * Competitor pages one update observes.
 *
 * Each is a different host with its own hourly allowance, so the ceiling is
 * about the length of the update rather than about any one site's budget.
 * Matches the collection budget in the design's section 5.
 */
export const GEO_RUN_COLLECT_COMPETITOR_LIMIT = 5;

export type GeoRunCollectScope = "own" | "competitor";

export interface GeoRunCollectTarget {
  /** The operation key this target will be recorded under. */
  readonly key: string;
  readonly scope: GeoRunCollectScope;
  readonly kind: Extract<GeoEvidenceObservationKind, "own_page" | "competitor_page">;
  /** The address to read, exactly as the draft names it. */
  readonly url: string;
  /** The identity whose hourly crawl allowance reading this target spends. */
  readonly gateKey: string;
}

export interface GeoRunCollectInput {
  readonly targetUrl: string;
  readonly competitors: readonly {
    readonly domain: string;
    readonly confirmed: boolean;
  }[];
}

/**
 * The address to read for one target, or null when it is not a public site.
 *
 * `normalizeAccountWebsiteUrl` is the same admission the account uses, so a
 * loopback or private host is refused here rather than reaching a fetch. Its
 * `submittedUrl` is what is kept -- the host as submitted, `www.` included.
 * `origin` is the apex form and belongs to budgeting, not to addressing: a
 * site that answers only on `www` answers nothing at the bare domain, which is
 * how a whole class of diagnostics came to fail against real sites.
 */
function readableUrl(value: string): string | null {
  const normalized = normalizeAccountWebsiteUrl(value);
  if (normalized === null) return null;
  try {
    const parsed = new URL(normalized.submittedUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function planGeoRunCollection(input: GeoRunCollectInput): readonly GeoRunCollectTarget[] {
  const targets: GeoRunCollectTarget[] = [];
  const spent = new Set<string>();
  const add = (scope: GeoRunCollectScope, value: string): boolean => {
    const url = readableUrl(value);
    if (url === null) return false;
    const gateKey = geoEvidenceGateKey(url);
    // One allowance, one operation. A second target behind the same gate key
    // would be a second admission against a budget that has already been spent.
    if (gateKey === null || spent.has(gateKey)) return false;
    spent.add(gateKey);
    targets.push({
      key: geoRunOperationKey({ kind: "fetch", scope, url }),
      scope,
      kind: scope === "own" ? "own_page" : "competitor_page",
      url,
      gateKey,
    });
    return true;
  };

  // Without the site itself there is nothing to update, and a run made only of
  // competitor pages would observe everyone except the subject.
  if (!add("own", input.targetUrl)) return [];
  let planned = 0;
  for (const competitor of input.competitors) {
    if (planned >= GEO_RUN_COLLECT_COMPETITOR_LIMIT) break;
    // Model output is not evidence of a rival's identity. Only a competitor
    // somebody confirmed is worth a page fetch and a slot in the allowance.
    if (!competitor.confirmed) continue;
    if (add("competitor", competitor.domain)) planned += 1;
  }
  return targets;
}

export function geoRunCollectSeeds(
  targets: readonly GeoRunCollectTarget[],
): readonly GeoRunOperationSeed[] {
  return targets.map((target) => ({ key: target.key, kind: "fetch" as const }));
}

/**
 * The one model step an update dispatches, and the key its ledger row carries.
 *
 * `model:knowledge` is content-addressed by step name, exactly like every other
 * key here: it does not move when the collection plan changes, so a resumed run
 * finds the row its first invocation wrote instead of minting a second
 * authorisation to spend. `roles` and `questions` are deliberately absent --
 * nothing in this deployment builds a v3 roles-proposal input or a v3 question
 * set, and seeding a step no executor can perform would only add an operation
 * whose honest outcome is "unsupported".
 */
export const GEO_RUN_KNOWLEDGE_MODEL_SEED: GeoRunOperationSeed = {
  key: geoRunOperationKey({ kind: "model", step: "knowledge" }),
  kind: "model",
};

/**
 * Everything one update run holds: the pages it observes, then the model step
 * that turns them into knowledge.
 *
 * The order is the plan and is load-bearing in two places at once.
 * `planGeoRun` acts on the FIRST actionable operation it sees, and
 * `marketing_geo_kb_run_insert_operations` writes `seq` from this array's own
 * order, so collection finishes before the model step is ever handed out.
 *
 * An empty collection returns an empty run rather than a lone model step. A
 * plan with no targets means the draft names no site anything may read (see
 * `planGeoRunCollection`), and dispatching a paid synthesis about a site we
 * were not allowed to look at is the one thing worse than reporting nothing to
 * do -- which the caller does instead, as `invalid_input`.
 */
export function geoRunUpdateSeeds(
  targets: readonly GeoRunCollectTarget[],
): readonly GeoRunOperationSeed[] {
  const collected = geoRunCollectSeeds(targets);
  return collected.length === 0 ? collected : [...collected, GEO_RUN_KNOWLEDGE_MODEL_SEED];
}
