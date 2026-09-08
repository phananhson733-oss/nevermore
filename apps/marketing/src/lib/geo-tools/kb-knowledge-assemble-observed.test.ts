import { describe, expect, it } from "vitest";

import {
  geoCoverageModule,
  geoEvidenceModule,
  geoJoinLimitations,
  geoMachineModule,
} from "./kb-knowledge-assemble-observed.ts";
import { buildGeoSourceCatalogue } from "./kb-knowledge-assemble-sources.ts";
import {
  buildGeoKnowledgeEvidenceV1,
  collectGeoKnowledgeEvidenceV1,
  type GeoKnowledgeEvidenceV1,
  type GeoKnowledgeResourceResult,
} from "./kb-knowledge-evidence.ts";
import {
  geoLabel,
  geoRefList,
  geoText,
  geoUnavailableReasonSchema,
  type GeoUnavailableReason,
} from "./kb-knowledge-shape.ts";
import { V2_AT, V2_HASH } from "./kb-knowledge-synthesis-v2-fixtures.ts";

// ---------------------------------------------------------------------------
// One site, varied one axis at a time.
//
// Everything here is built through `buildGeoKnowledgeEvidenceV1`, which runs
// the receipt's own integrity checks. A fixture that could not have come out
// of the collector therefore fails to build rather than passing a test about
// what the collector produces.
// ---------------------------------------------------------------------------

const TARGET = "https://observed.example/";
const PLANS = "https://observed.example/plans";
const CHANGELOG = "https://observed.example/changelog";
const HOME_ID = "source:own-home";
const PLANS_ID = "source:own-plans";
const CHANGELOG_ID = "source:own-changelog";
const ROBOTS_ID = "source:robots";
const SITEMAP_ID = "source:sitemap";
const LLMS_ID = "source:llms";

type Availability = "available" | "unavailable";

interface OwnPage {
  readonly id: string;
  readonly url: string;
  readonly excerpts: readonly string[];
  readonly availability?: Availability;
  readonly changelogLink?: boolean;
}

interface RobotsFixture {
  /** Lines exactly as the receipt keeps them, or a reason it holds none. */
  readonly excerpts?: readonly string[];
  readonly reason?: GeoUnavailableReason;
}

interface EvidenceOptions {
  readonly robots?: RobotsFixture;
  readonly sitemap?: { readonly reason: GeoUnavailableReason };
  readonly llmsPresent?: boolean;
  /** JSON-LD and hreflang observed on the home page. */
  readonly markup?: boolean;
  readonly own?: readonly OwnPage[];
}

const HOME: OwnPage = {
  id: HOME_ID,
  url: TARGET,
  excerpts: ["Observed Example is a product for teams."],
};

function ownSource(page: OwnPage) {
  const availability = page.availability ?? "available";
  return availability === "unavailable"
    ? {
        id: page.id, kind: "own_page" as const, label: "Own site page", url: page.url,
        competitor: null, availability, reason: "fetch_failed" as const,
        observedAt: null, bodyHash: null, excerpts: [],
      }
    : {
        id: page.id, kind: "own_page" as const, label: "Own site page", url: page.url,
        competitor: null, availability, reason: null,
        observedAt: V2_AT, bodyHash: V2_HASH, excerpts: [...page.excerpts],
      };
}

function robotsSource(fixture: RobotsFixture) {
  const base = {
    id: ROBOTS_ID, kind: "robots" as const, label: "robots", url: "https://observed.example/robots.txt",
    competitor: null,
  };
  return fixture.reason === undefined
    ? {
        ...base, availability: "available" as const, reason: null,
        observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: [...(fixture.excerpts ?? ["User-agent: *", "Allow: /"])],
      }
    : {
        ...base, availability: "unavailable" as const, reason: fixture.reason,
        observedAt: null, bodyHash: null, excerpts: [],
      };
}

/**
 * The status the receipt itself assigns a machine endpoint from its reason.
 * Read out of the producer by asking it to accept each answer in turn, so this
 * file never asserts a classification it invented.
 */
function receiptStatusFor(reason: GeoUnavailableReason): "absent" | "unreachable" | "rejected" {
  for (const status of ["absent", "unreachable"] as const) {
    try {
      evidence({ robots: { reason } }, status);
      return status;
    } catch {
      continue;
    }
  }
  return "rejected";
}

function evidence(
  options: EvidenceOptions = {},
  robotsStatusOverride?: "absent" | "unreachable",
): GeoKnowledgeEvidenceV1 {
  const own = options.own ?? [HOME];
  const markup = options.markup === true;
  const robots = robotsSource(options.robots ?? {});
  const robotsStatus = robotsStatusOverride
    ?? (options.robots?.reason === undefined
      ? "present"
      : options.robots.reason === "not_found" || options.robots.reason === "not_published"
        ? "absent"
        : "unreachable");
  const ownRefs = own.map((page) => page.id);
  const readable = own.filter((page) => (page.availability ?? "available") !== "unavailable");
  const pages = readable.map((page) => ({
    url: page.url,
    canonicalUrl: null,
    title: "Observed Example",
    description: null,
    lang: "en",
    jsonLdTypes: markup && page.url === TARGET ? ["Organization"] : [],
    hreflangLocales: markup && page.url === TARGET ? ["en"] : [],
    hreflang: markup && page.url === TARGET ? [{ locale: "en", url: TARGET }] : [],
    faq: [],
    links: page.changelogLink === true ? [{ intent: "changelog" as const, url: CHANGELOG }] : [],
  }));
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1",
    collectedAt: V2_AT,
    targetUrl: TARGET,
    confirmedCompetitors: [],
    // The receipt's own rule: a run that read no own page at all is
    // `unavailable`, not `partial`.
    availability: readable.length === 0 ? "unavailable" : "partial",
    limitation: "Machine-readable endpoints vary by fixture.",
    pages,
    machine: {
      jsonLd: { status: markup ? "present" : "absent", types: markup ? ["Organization"] : [], sourceRefs: ownRefs },
      llms: { status: options.llmsPresent === true ? "present" : "absent", sourceRefs: [LLMS_ID] },
      robots: { status: robotsStatus, sourceRefs: [ROBOTS_ID] },
      sitemap: options.sitemap === undefined
        ? { status: "present", sourceRefs: [SITEMAP_ID], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false }
        : { status: options.sitemap.reason === "not_found" ? "absent" : "unreachable", sourceRefs: [SITEMAP_ID], urlCount: null, knowledgePagesListed: null },
      hreflang: { status: markup ? "present" : "absent", locales: markup ? ["en"] : [], sourceRefs: ownRefs },
    },
    sourceCatalogue: [
      ...own.map(ownSource),
      robots,
      options.sitemap === undefined
        ? {
            id: SITEMAP_ID, kind: "sitemap", label: "sitemap", url: "https://observed.example/sitemap.xml",
            competitor: null, availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
            excerpts: ["<urlset></urlset>"],
          }
        : {
            id: SITEMAP_ID, kind: "sitemap", label: "sitemap", url: "https://observed.example/sitemap.xml",
            competitor: null, availability: "unavailable", reason: options.sitemap.reason,
            observedAt: null, bodyHash: null, excerpts: [],
          },
      options.llmsPresent === true
        ? {
            id: LLMS_ID, kind: "llms", label: "llms", url: "https://observed.example/llms.txt",
            competitor: null, availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
            excerpts: ["# Observed Example"],
          }
        : {
            id: LLMS_ID, kind: "llms", label: "llms", url: "https://observed.example/llms.txt",
            competitor: null, availability: "unavailable", reason: "not_found",
            observedAt: null, bodyHash: null, excerpts: [],
          },
    ],
  });
}

function machine(options: EvidenceOptions = {}, snippetsBlocked: boolean | null = null) {
  const body = evidence(options);
  return geoMachineModule({
    evidence: body,
    index: buildGeoSourceCatalogue(body, null),
    robots: null,
    snippetsBlocked,
  });
}

function partialMachine(options: EvidenceOptions = {}, snippetsBlocked: boolean | null = null) {
  const module = machine(options, snippetsBlocked);
  if (module.status !== "partial") throw new Error(`expected partial, got ${module.status}`);
  return module;
}

function evidenceModule(options: EvidenceOptions = {}) {
  const body = evidence(options);
  return geoEvidenceModule({ evidence: body, offsite: null, index: buildGeoSourceCatalogue(body, null) });
}

const NO_RULES = "this site publishes no robots.txt rules";
const UNREADABLE = "robots.txt could not be read";
const TRUNCATED = "robots.txt was not read in full";

describe("why AI crawler permission was not determined", () => {
  /**
   * The reason a real run carries for a site with no robots.txt.
   *
   * `createGeoKnowledgeResourceReader` maps 404 and 410 to `not_found`
   * (pinned in `kb-enrichment-deps.test.ts`), and this drives the collector
   * with exactly that result rather than asserting the row it wants. The
   * assembled sentence has to be about a file that is not there.
   */
  it("says a 404 robots.txt publishes no rules, end to end from the collector", async () => {
    const readResource = async ({ url }: { url: string }): Promise<GeoKnowledgeResourceResult> =>
      url === TARGET
        ? {
            kind: "ok", url, contentType: "text/html", observedAt: V2_AT,
            body: "<html><head><title>Observed Example</title></head><body><h1>Observed Example</h1><p>Observed Example is a product for teams.</p></body></html>",
          }
        : { kind: "unavailable", url, reason: "not_found" };
    const collected = await collectGeoKnowledgeEvidenceV1(
      { targetUrl: TARGET, competitors: [] },
      { readResource, now: () => new Date(V2_AT) },
    );

    const robots = collected.sourceCatalogue.find((source) => source.kind === "robots");
    expect(robots?.availability).toBe("unavailable");
    expect(robots?.reason).toBe("not_found");
    expect(collected.machine.robots.status).toBe("absent");

    const module = geoMachineModule({
      evidence: collected,
      index: buildGeoSourceCatalogue(collected, null),
      robots: null,
      snippetsBlocked: null,
    });
    if (module.status !== "partial") throw new Error(`expected partial, got ${module.status}`);
    expect(module.limitation).toContain(NO_RULES);
    expect(module.limitation).not.toContain(UNREADABLE);
    expect(module.limitation).not.toContain(TRUNCATED);
    expect(module.value.aiCrawlers.search).toEqual([]);
    expect(module.value.aiCrawlers.training).toEqual([]);
  });

  /**
   * The other half of the same predicate, and not a dead branch.
   *
   * A robots.txt served as an empty `text/plain` body is fetched, read whole
   * and found to state nothing, which the collector records as
   * `not_published` rather than `not_found`. Both reach the same sentence,
   * because both describe a site that publishes no rules.
   */
  it("says the same of an empty robots.txt, which the collector reads as not_published", async () => {
    const readResource = async ({ url }: { url: string }): Promise<GeoKnowledgeResourceResult> => {
      if (url === TARGET) {
        return {
          kind: "ok", url, contentType: "text/html", observedAt: V2_AT,
          body: "<html><head><title>Observed Example</title></head><body><h1>Observed Example</h1><p>Observed Example is a product for teams.</p></body></html>",
        };
      }
      if (url.endsWith("/robots.txt")) {
        return { kind: "ok", url, contentType: "text/plain", observedAt: V2_AT, body: "\n  \n" };
      }
      return { kind: "unavailable", url, reason: "not_found" };
    };
    const collected = await collectGeoKnowledgeEvidenceV1(
      { targetUrl: TARGET, competitors: [] },
      { readResource, now: () => new Date(V2_AT) },
    );
    expect(collected.sourceCatalogue.find((source) => source.kind === "robots")?.reason).toBe("not_published");

    const module = geoMachineModule({
      evidence: collected,
      index: buildGeoSourceCatalogue(collected, null),
      robots: null,
      snippetsBlocked: null,
    });
    if (module.status !== "partial") throw new Error(`expected partial, got ${module.status}`);
    expect(module.limitation).toContain(NO_RULES);
    expect(module.limitation).not.toContain(UNREADABLE);
  });

  /**
   * The two files must agree about which reasons mean "there was nothing to
   * read" -- the receipt turns them into `machine.robots.status: "absent"`,
   * and this module turns them into the sentence a reader acts on. A reason
   * classified one way there and the other way here puts two contradictory
   * statements about the same file on the same card.
   *
   * The receipt's classification is read back out of the receipt (a wrong
   * status fails its integrity check), never restated here.
   */
  it("uses the receipt's own reading of every reason, not a second opinion", () => {
    const seen: Record<string, string[]> = { absent: [], unreachable: [], rejected: [] };
    for (const reason of geoUnavailableReasonSchema.options) {
      const status = receiptStatusFor(reason);
      seen[status]!.push(reason);
      if (status === "rejected") continue;
      const module = partialMachine({ robots: { reason } });
      if (status === "absent") {
        expect(module.limitation, reason).toContain(NO_RULES);
        expect(module.limitation, reason).not.toContain(UNREADABLE);
      } else {
        expect(module.limitation, reason).toContain(UNREADABLE);
        expect(module.limitation, reason).not.toContain(NO_RULES);
      }
    }
    // Both halves of the predicate are exercised, and the only reasons the
    // receipt refuses outright are the two that describe an owner's decision
    // rather than a collection outcome. Without this the loop above would
    // still pass if every fixture had failed to build.
    expect([...seen.absent!].sort()).toEqual(["not_found", "not_published"]);
    expect([...seen.rejected!].sort()).toEqual(["owner_excluded_all", "owner_excluded_required"]);
    expect(seen.unreachable!.length).toBeGreaterThan(5);
  });

  it("keeps a truncated read apart from a file that was never there", () => {
    const module = partialMachine({
      robots: {
        // Eight lines is the receipt's per-source excerpt ceiling, written out
        // rather than derived from it: a fixture computed from the limit
        // passes whatever the limit becomes.
        excerpts: ["User-agent: *", "Allow: /", "Disallow: /a", "Disallow: /b", "Disallow: /c", "Disallow: /d", "Disallow: /e", "Disallow: /f"],
      },
    });
    expect(module.limitation).toContain(TRUNCATED);
    expect(module.limitation).not.toContain(NO_RULES);
    expect(module.limitation).not.toContain(UNREADABLE);
    expect(module.value.aiCrawlers.training).toEqual([]);
  });

  it("carries the endpoint's own status instead of assuming it was read", () => {
    expect(partialMachine({ robots: { reason: "fetch_failed" } }).value.robots.status).toBe("unreachable");
    expect(partialMachine({ robots: { reason: "not_found" } }).value.robots.status).toBe("absent");
    expect(partialMachine().value.robots.status).toBe("present");
  });

  /**
   * A module that measured every other signal is still not a complete answer
   * while the crawler question is open.
   *
   * The robots.txt here was *fetched* -- its endpoint reads `present`, so the
   * signal gate is satisfied -- and only the excerpt ceiling stopped the file
   * being read in full. Every other gate is cleared on purpose: the snippet
   * observation arrives, JSON-LD, hreflang, llms.txt and the sitemap are all
   * present. A fixture whose robots.txt was missing would fail the signal
   * gate first and prove nothing about this one.
   */
  it("will not call itself complete while crawler permission is undetermined", () => {
    const options = {
      robots: {
        excerpts: ["User-agent: *", "Allow: /", "Disallow: /a", "Disallow: /b", "Disallow: /c", "Disallow: /d", "Disallow: /e", "Disallow: /f"],
      },
      llmsPresent: true,
      markup: true,
    } as const;
    const undetermined = machine(options, false);
    if (undetermined.status !== "partial") throw new Error(`expected partial, got ${undetermined.status}`);
    expect(undetermined.value.robots.status).toBe("present");
    expect(undetermined.value.jsonLd.status).toBe("present");
    expect(undetermined.value.snippets.status).toBe("allowed");
    // Exact: the truncation sentence stands alone, so nothing else is
    // holding this module back.
    expect(undetermined.limitation).toBe("AI crawler permissions were not determined: robots.txt was not read in full.");

    // The same fixture with a robots.txt short enough to have been read whole
    // is available -- which is what shows the assertion above is about the
    // crawler gate and not about one the fixture never cleared.
    const determined = machine({ ...options, robots: { excerpts: ["User-agent: *", "Allow: /"] } }, false);
    expect(determined.status).toBe("available");
  });
});

describe("what was not measured is not a measurement", () => {
  /**
   * A sitemap nobody could read has no URL count. `"0"` is a count, and a
   * count of zero is the answer for a sitemap that was read and listed
   * nothing -- a different site with a different fix.
   */
  it("gives an unread sitemap no URL count at all, rather than a count of zero", () => {
    const unread = partialMachine({ sitemap: { reason: "not_found" } });
    expect(unread.value.sitemap.urlCount).toBeNull();
    expect(unread.value.sitemap.knowledgePagesListed).toBeNull();

    // The same field, for a sitemap that was read and listed nothing.
    const empty = partialMachine();
    expect(empty.value.sitemap.urlCount).toBe("0");
    expect(empty.value.sitemap.knowledgePagesListed).toBe(false);
  });

  /**
   * "No JSON-LD on this site" is a claim about pages that were read. With one
   * of them unreadable the honest answer is that it could not be checked, and
   * `unreachable` is the third state that says so.
   */
  it("does not report structured data as absent when a page could not be read", () => {
    const partial = partialMachine({
      own: [HOME, { id: PLANS_ID, url: PLANS, excerpts: [], availability: "unavailable" }],
    });
    expect(partial.value.jsonLd.status).toBe("unreachable");
    expect(partial.value.hreflang.status).toBe("unreachable");

    // Every page read, and none of them carried any: that is an absence.
    const read = partialMachine({
      own: [HOME, { id: PLANS_ID, url: PLANS, excerpts: ["Plans for teams."] }],
    });
    expect(read.value.jsonLd.status).toBe("absent");
    expect(read.value.hreflang.status).toBe("absent");

    // And an observation on the readable page is still an observation.
    const observed = partialMachine({
      markup: true,
      own: [HOME, { id: PLANS_ID, url: PLANS, excerpts: [], availability: "unavailable" }],
    });
    expect(observed.value.jsonLd.status).toBe("present");
    expect(observed.value.jsonLd.types).toEqual(["Organization"]);
  });

  /**
   * A run whose only own page could not be read still has to describe what it
   * observed. The receipt calls such a run `unavailable`, and the two modules
   * answer differently on purpose: there is no evidence to show, and there are
   * still machine-readable endpoints that were fetched.
   */
  it("still reports the endpoints it read when no own page could be read", () => {
    const options = { own: [{ id: HOME_ID, url: TARGET, excerpts: [], availability: "unavailable" as const }] };
    const body = evidence(options);
    expect(body.availability).toBe("unavailable");

    const module = partialMachine(options);
    expect(module.value.robots.status).toBe("present");
    expect(module.value.jsonLd.status).toBe("unreachable");
    // Snippet permission is unchecked, and the row still has to name a source
    // it could have been checked against.
    expect(module.value.snippets.status).toBe("not_checked");
    expect(module.value.snippets.sourceRefs).toEqual([ROBOTS_ID]);

    // Nothing readable is not an empty result: the evidence module says why.
    expect(evidenceModule(options).module).toEqual({ status: "unavailable", reason: "insufficient_evidence" });
  });

  it("keeps snippet permission a third state while nothing has checked it", () => {
    const unchecked = partialMachine({ llmsPresent: true, markup: true });
    expect(unchecked.value.snippets.status).toBe("not_checked");
    // Exact, not `toContain`: the other two sentences being empty is what
    // shows this fixture reached the snippet gate rather than an earlier one.
    expect(unchecked.limitation).toBe("Snippet permission was not checked.");

    expect(machine({ llmsPresent: true, markup: true }, true).status).toBe("available");
    const blocked = machine({ llmsPresent: true, markup: true }, true);
    if (blocked.status !== "available") throw new Error("expected available");
    expect(blocked.value.snippets.status).toBe("blocked");
  });
});

describe("AI crawler permission, read the way a crawler reads it", () => {
  function access(lines: readonly string[]) {
    const module = partialMachine({ robots: { excerpts: lines } });
    return Object.fromEntries(
      [...module.value.aiCrawlers.search, ...module.value.aiCrawlers.training]
        .map((row) => [row.agent, row.access]),
    );
  }

  it("reports a site-wide block written with a wildcard as a block", () => {
    expect(access(["User-agent: GPTBot", "Disallow: /*"]).GPTBot).toBe("disallowed");
    expect(access(["User-agent: GPTBot", "Disallow: /"]).GPTBot).toBe("disallowed");
    // A rule about one directory is not a rule about the site.
    expect(access(["User-agent: GPTBot", "Disallow: /admin"]).GPTBot).toBe("allowed");
  });

  it("does not let a comment between two agent lines end the record", () => {
    const rows = access([
      "User-agent: GPTBot",
      "# everything below applies to both",
      "User-agent: CCBot",
      "Disallow: /",
    ]);
    expect(rows.GPTBot).toBe("disallowed");
    expect(rows.CCBot).toBe("disallowed");
  });

  it("obeys every record naming the agent, not only the first", () => {
    const rows = access([
      "User-agent: GPTBot",
      "Disallow: /private",
      "User-agent: GPTBot",
      "Disallow: /",
    ]);
    expect(rows.GPTBot).toBe("disallowed");
  });

  it("resolves an equally specific Allow and Disallow the same way in either order", () => {
    expect(access(["User-agent: GPTBot", "Disallow: /", "Allow: /"]).GPTBot).toBe("allowed");
    expect(access(["User-agent: GPTBot", "Allow: /", "Disallow: /"]).GPTBot).toBe("allowed");
  });

  /**
   * A file that names neither this agent nor `*` states nothing about it. The
   * standard would grant access, but that is a conclusion; the observation is
   * that the file is silent, and silence is this module's third state.
   */
  it("says nothing was stated rather than granting access the file never granted", () => {
    const rows = access(["User-agent: GPTBot", "Disallow: /"]);
    expect(rows.GPTBot).toBe("disallowed");
    expect(rows["OAI-SearchBot"]).toBe("unspecified");
    expect(rows.ClaudeBot).toBe("unspecified");

    // A `*` record does state something about every agent.
    expect(access(["User-agent: *", "Disallow: /"])["OAI-SearchBot"]).toBe("disallowed");
  });

  it("keeps the two permissions apart: blocking a trainer says nothing about search", () => {
    const module = partialMachine({ robots: { excerpts: ["User-agent: GPTBot", "Disallow: /", "User-agent: OAI-SearchBot", "Allow: /"] } });
    expect(module.value.aiCrawlers.training).toContainEqual({ agent: "GPTBot", access: "disallowed" });
    expect(module.value.aiCrawlers.search).toContainEqual({ agent: "OAI-SearchBot", access: "allowed" });
  });
});

// A page excerpt runs to 1 200 code points and an evidence summary holds 800,
// so the cut below is the one production reaches. Both strings are written to
// a fixed length rather than derived from either limit.
const NO_DIGITS = "ab ".repeat(300);
const SPLIT_NUMBER = `${"x".repeat(795)} 9876543210 tail`;

describe("evidence groups say what was collected and what was cut", () => {
  it("files a linked changelog page under changelog, not under proof", () => {
    const assembly = evidenceModule({
      own: [
        { ...HOME, changelogLink: true },
        { id: CHANGELOG_ID, url: CHANGELOG, excerpts: ["Release notes for Observed Example."] },
      ],
    });
    if (assembly.module.status === "unavailable") throw new Error("evidence unavailable");
    expect(assembly.module.value.proof.map((item) => item.url)).toEqual([TARGET]);
    expect(assembly.module.value.changelog.map((item) => item.url)).toEqual([CHANGELOG]);
    // Both groups were looked for, which is what lets an empty one mean
    // "nothing found" instead of "never checked".
    expect(assembly.module.value.collected).toEqual(["proof", "changelog"]);
  });

  it("cuts a summary to what the payload can store", () => {
    const assembly = evidenceModule({
      own: [{ id: PLANS_ID, url: PLANS, excerpts: [NO_DIGITS] }],
    });
    if (assembly.module.status === "unavailable") throw new Error("evidence unavailable");
    const summary = assembly.module.value.proof[0]?.summary ?? "";
    // The contract is the oracle, not a repeated constant: the excerpt as
    // collected is too long for the field, and what is emitted is not.
    expect(geoText.safeParse(NO_DIGITS).success).toBe(false);
    expect(geoText.safeParse(summary).success).toBe(true);
    expect(geoLabel.safeParse(assembly.module.value.proof[0]?.label ?? "").success).toBe(true);
    expect(NO_DIGITS.startsWith(summary)).toBe(true);
  });

  /**
   * The cut can land inside a number, and half a number is a figure the page
   * never printed. Such an item is refused and counted, never shown.
   */
  it("drops an item whose cut summary asserts a number no excerpt carries, and says how many", () => {
    const assembly = evidenceModule({
      own: [HOME, { id: PLANS_ID, url: PLANS, excerpts: [SPLIT_NUMBER] }],
    });
    if (assembly.module.status !== "partial") throw new Error("evidence should be partial");
    expect(assembly.module.value.proof.map((item) => item.url)).toEqual([TARGET]);
    expect(assembly.dropped).toEqual([
      { group: "proof", id: `evidence:${PLANS_ID}`, reason: "literals_unsupported" },
    ]);
    expect(assembly.module.limitation).toContain("1 collected item(s) could not be shown with their evidence.");
  });

  it("names the groups this run never looked for", () => {
    const assembly = evidenceModule();
    if (assembly.module.status !== "partial") throw new Error("evidence should be partial");
    expect(assembly.module.limitation).toContain("Not collected in this run: press, thirdPartyProfiles, firstPartyProof.");
    expect(assembly.dropped).toEqual([]);
  });
});

describe("the coverage table", () => {
  const REFS = {
    entity: [], facts: [], qa: [], comparisons: [], scope: [], evidence: [], machine: [],
  } as const;
  const all = (module: { status: "available" | "partial" | "unavailable"; limitation?: string }) => ({
    entity: module, facts: module, qa: module, comparisons: module, scope: module,
    evidence: module, machine: module,
  });

  it("does not report a partial section as covered", () => {
    const table = geoCoverageModule(all({ status: "partial", limitation: "Half of it was readable." }), REFS);
    if (table.status === "unavailable") throw new Error("coverage unavailable");
    expect(table.value.every((row) => row.status === "partial")).toBe(true);
    expect(table.status).toBe("partial");
    expect(table.value[0]?.summary).toBe("Half of it was readable.");
  });

  it("is available only when every row is covered", () => {
    const complete = geoCoverageModule(all({ status: "available" }), REFS);
    expect(complete.status).toBe("available");

    const oneShort = geoCoverageModule(
      { ...all({ status: "available" }), machine: { status: "partial", limitation: "Snippet permission was not checked." } },
      REFS,
    );
    if (oneShort.status === "unavailable") throw new Error("coverage unavailable");
    expect(oneShort.status).toBe("partial");
    expect(oneShort.value.filter((row) => row.status === "covered")).toHaveLength(6);
    expect(oneShort.value.find((row) => row.id === "coverage:machine")?.status).toBe("partial");
  });

  it("cites at most what the payload can hold, and never the same source twice", () => {
    const many = Array.from({ length: 20 }, (_, index) => `source:ref-${index}`);
    const table = geoCoverageModule(all({ status: "available" }), { ...REFS, machine: [...many, ...many] });
    if (table.status === "unavailable") throw new Error("coverage unavailable");
    const row = table.value.find((entry) => entry.id === "coverage:machine");
    expect(new Set(row?.sourceRefs).size).toBe(row?.sourceRefs.length);
    // The contract's own ceiling on a reference list is the oracle.
    expect(geoRefList(0).safeParse(row?.sourceRefs).success).toBe(true);
    expect(geoRefList(0).safeParse(many).success).toBe(false);
  });

  it("marks an unavailable section missing, with something to do about it", () => {
    const table = geoCoverageModule(all({ status: "unavailable" }), REFS);
    if (table.status === "unavailable") throw new Error("coverage unavailable");
    expect(table.value.every((row) => row.status === "missing")).toBe(true);
    expect(table.value.every((row) => row.nextAction !== null)).toBe(true);
  });
});

describe("joining limitation sentences", () => {
  const A = "A".repeat(500);
  const B = "B".repeat(400);
  const C = "C".repeat(100);

  it("keeps whole sentences and stops, rather than cutting one in half", () => {
    // 500 + 1 + 400 does not fit; the second sentence is dropped whole.
    expect(geoJoinLimitations([A, B])).toBe(A);
    // ...and the third is not slipped in behind it: a reader who sees two
    // sentences must not be missing the one between them.
    expect(geoJoinLimitations([A, B, C])).toBe(A);
    expect(geoJoinLimitations([C, A])).toBe(`${C} ${A}`);
  });

  it("joins everything that fits", () => {
    expect(geoJoinLimitations([C, C, C])).toBe(`${C} ${C} ${C}`);
    expect(geoJoinLimitations([])).toBe("");
  });

  /**
   * A single sentence too long to fit yields nothing at all, and a `partial`
   * module with an empty limitation is refused by the payload contract. No
   * caller can reach it today -- every sentence the assembler produces is a
   * fixed phrase of well under a hundred characters, and the only variable
   * parts are group names and small counts -- but a future sentence built
   * from site content would.
   */
  it("returns nothing for a sentence that does not fit, which the contract will refuse", () => {
    expect(geoJoinLimitations(["D".repeat(900)])).toBe("");
    expect(geoText.safeParse("").success).toBe(false);
  });
});
