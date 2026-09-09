// @input -- the own-site receipt, the offsite collection and the joined catalogue
// @output -- the three modules that never wait for a model: evidence, machine, coverage
// @pos -- pure projection: no fetch, no clock, no store

/**
 * Section 4.2's deterministic half. These modules are assembled from what was
 * collected and are visible the moment collection finishes, whether or not the
 * model step later succeeds.
 *
 * The rule they exist to keep is the one v1 broke: a group nobody looked for is
 * never reported as a group that was looked for and found nothing. `collected`
 * lists the groups this run actually attempted, and anything the budget or the
 * catalogue ceiling cut is said out loud in the module's limitation.
 */
import { matchRobotsRule, parseRobots, type RobotsGroup } from "@sf/sources/crawl-robots";

import { geoBoundText } from "./kb-first-party-proof.ts";
import type { GeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import {
  GEO_EVIDENCE_GROUPS,
  GEO_KNOWLEDGE_LIMITS,
  type GeoEvidenceGroup,
  type GeoKnowledgeSource,
  type GeoUnavailableReason,
} from "./kb-knowledge-shape.ts";
import type {
  GeoOffsiteCollection,
  GeoOffsiteEvidenceItem,
} from "./kb-offsite-collect.ts";
import type { GeoKnowledgeBodyV3 } from "./kb-v3-contract.ts";
import {
  geoItemIsCitable,
  geoReadableOwnPages,
  type GeoSourceIndex,
} from "./kb-knowledge-assemble-sources.ts";

type EvidenceModule = GeoKnowledgeBodyV3["evidence"];
type EvidenceValue = Extract<EvidenceModule, { status: "available" }>["value"];
type EvidenceItem = EvidenceValue["proof"][number];
type MachineModule = GeoKnowledgeBodyV3["machine"];
type MachineValue = Extract<MachineModule, { status: "available" }>["value"];
type CoverageModule = GeoKnowledgeBodyV3["coverage"];
type CoverageValue = Extract<CoverageModule, { status: "available" }>["value"];
type AnyModule = {
  readonly status: "available" | "partial" | "unavailable";
  readonly limitation?: string;
};

const LIMITATION_CODE_POINTS = 800;
const EVIDENCE_LABEL_CODE_POINTS = 120;
const EVIDENCE_SUMMARY_CODE_POINTS = 800;

/** Sentences, joined while they fit. A truncated sentence would misstate the limit. */
export function geoJoinLimitations(parts: readonly string[]): string {
  let joined = "";
  for (const part of parts) {
    const candidate = joined === "" ? part : `${joined} ${part}`;
    if (Array.from(candidate).length > LIMITATION_CODE_POINTS) break;
    joined = candidate;
  }
  return joined;
}

/**
 * The agents whose permission is reported, split by what the permission
 * governs. Blocking GPTBot does not remove a page from AI Overviews and
 * Google-Extended governs training only, so one combined verdict would state
 * something untrue about both.
 */
export const GEO_AI_CRAWLERS = {
  search: ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot"],
  training: ["GPTBot", "Google-Extended", "CCBot", "ClaudeBot"],
} as const;

type CrawlerAccess = "allowed" | "disallowed" | "unspecified";

/**
 * Whether the site's own rules let this agent read its home page.
 *
 * Read with `@sf/sources/crawl-robots` -- the parser the page-citability
 * checker answers this same question with and the crawler gates its own
 * fetches on. A second parser written here for the same question got four
 * shapes wrong that it gets right, and three of them resolved to `allowed`:
 * a permission claim about the owner's own site, drawn from rules that say
 * the opposite.
 *
 *   - `Disallow: /*` was compared as a literal path, matched nothing, and a
 *     site-wide block read as no block at all.
 *   - A comment line between two `User-agent` lines ended the record, so the
 *     rules below it stopped applying to the agent named above it.
 *   - A second record naming the same agent -- what appending a rule to a file
 *     produces -- was dropped; RFC 9309 2.2.1 obeys the union.
 *   - `Disallow: /` and `Allow: /` resolved by line order, in either
 *     direction. RFC 9309 2.2.2 gives an equally specific `Allow` priority.
 *
 * `unspecified` is still decided here rather than taken from the matcher. RFC
 * 9309 2.2.1 grants full access to a crawler no record names, and the matcher
 * says so; but "the standard would permit it" is a conclusion, and what this
 * module reports is what the file was observed to say -- which, for an agent
 * with neither its own record nor a `*` record, is nothing.
 */
function crawlerAccess(
  groups: readonly RobotsGroup[],
  agent: string,
): CrawlerAccess {
  const wanted = agent.toLocaleLowerCase("en");
  const governed = groups.some(
    (group) => group.agents.includes(wanted) || group.agents.includes("*"),
  );
  if (!governed) return "unspecified";
  return matchRobotsRule(groups, agent, "/").allowed ? "allowed" : "disallowed";
}

export interface GeoRobotsObservation {
  /** The whole file. Supplied by the collector, which still holds the body. */
  readonly text: string;
}

/**
 * Robots lines this run can prove it read in full.
 *
 * The receipt keeps at most eight excerpt lines, so a robots file that filled
 * them may have said something else further down. Reporting "allowed" from a
 * truncated read would be a permission claim built on the part we happened to
 * keep, so a possibly-truncated file yields no rows at all -- the reader sees
 * that nothing was determined instead of a confident wrong answer.
 */
function robotsLines(
  source: GeoKnowledgeSource | undefined,
  robots: GeoRobotsObservation | null,
): readonly string[] | null {
  if (robots !== null)
    return robots.text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "");
  if (source === undefined || source.availability === "unavailable")
    return null;
  return source.excerpts.length >= GEO_KNOWLEDGE_LIMITS.excerptsPerSource
    ? null
    : source.excerpts;
}

/**
 * Why no AI crawler permission was determined, in the site's own terms.
 *
 * Three different facts end up here and one sentence for all three sends two
 * thirds of readers looking for a truncated read that never happened: a site
 * with no robots.txt at all was read completely and there was nothing in it,
 * and a robots.txt whose fetch failed was not read at all. The evidence parser
 * already pins `machine.robots.status` to this source's own availability, so
 * the source is the one place the distinction is carried.
 *
 * None of the three infers a permission. An absent robots.txt permits every
 * crawler under the standard, but "nothing was stated" is what was observed and
 * "everything is allowed" is a conclusion this module does not draw.
 */
function robotsUndeterminedReason(source: GeoKnowledgeSource | undefined): string {
  if (source !== undefined && source.availability !== "unavailable") {
    return "AI crawler permissions were not determined: robots.txt was not read in full.";
  }
  return source?.reason === "not_found" || source?.reason === "not_published"
    ? "AI crawler permissions were not determined: this site publishes no robots.txt rules."
    : "AI crawler permissions were not determined: robots.txt could not be read.";
}

export interface GeoMachineInput {
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly index: GeoSourceIndex;
  readonly robots: GeoRobotsObservation | null;
  /** Snippet permission, when something actually read the page directives. */
  readonly snippetsBlocked: boolean | null;
}

export function geoMachineModule(input: GeoMachineInput): MachineModule {
  const { evidence, index } = input;
  const machine = evidence.machine;
  const unreadable = (refs: readonly string[]) =>
    refs.some((ref) => index.byId.get(ref)?.availability === "unavailable");
  const robotsRef = machine.robots.sourceRefs[0];
  const robotsSource =
    robotsRef === undefined ? undefined : index.byId.get(robotsRef);
  const lines = robotsLines(robotsSource, input.robots);
  const groups =
    lines === null
      ? null
      : parseRobots(lines.join("\n"), evidence.targetUrl, true).groups;
  const rows = (agents: readonly string[]) =>
    groups === null
      ? []
      : agents.map((agent) => ({
          agent,
          access: crawlerAccess(groups, agent),
        }));
  // `robotsRef` is always present in parsed evidence -- the evidence contract
  // gives `machine.robots` exactly one source reference -- so this refusal is
  // defensive only. A fixture built to reach it has to bypass the parser, and a
  // test that claims to exercise "machine unavailable" through
  // `assembleGeoKnowledgeBodyV3` is asserting nothing.
  const snippetRef = geoReadableOwnPages(index)[0]?.id ?? robotsRef;
  if (snippetRef === undefined)
    return { status: "unavailable", reason: "insufficient_evidence" };
  const value: MachineValue = {
    jsonLd: {
      status:
        machine.jsonLd.status === "absent" &&
        unreadable(machine.jsonLd.sourceRefs)
          ? "unreachable"
          : machine.jsonLd.status,
      types: [...machine.jsonLd.types],
      sourceRefs: [...machine.jsonLd.sourceRefs],
    },
    llms: {
      status: machine.llms.status,
      sourceRefs: [...machine.llms.sourceRefs],
    },
    robots: {
      status: machine.robots.status,
      sourceRefs: [...machine.robots.sourceRefs],
    },
    sitemap: {
      status: machine.sitemap.status,
      // A decimal string: the v3 payload's canonical form has no number type,
      // and a numeric count made every site with a sitemap unsaveable.
      urlCount:
        machine.sitemap.urlCount === null
          ? null
          : String(machine.sitemap.urlCount),
      knowledgePagesListed: machine.sitemap.knowledgePagesListed,
      sourceRefs: [...machine.sitemap.sourceRefs],
    },
    hreflang: {
      status:
        machine.hreflang.status === "absent" &&
        unreadable(machine.hreflang.sourceRefs)
          ? "unreachable"
          : machine.hreflang.status,
      locales: [...machine.hreflang.locales],
      sourceRefs: [...machine.hreflang.sourceRefs],
    },
    aiCrawlers: {
      search: rows(GEO_AI_CRAWLERS.search),
      training: rows(GEO_AI_CRAWLERS.training),
      sourceRefs: [...machine.robots.sourceRefs],
    },
    snippets: {
      status:
        input.snippetsBlocked === null
          ? "not_checked"
          : input.snippetsBlocked
            ? "blocked"
            : "allowed",
      sourceRefs: [snippetRef],
    },
  };
  const signals = [
    value.jsonLd,
    value.llms,
    value.robots,
    value.sitemap,
    value.hreflang,
  ];
  /**
   * Every signal measured, or the module says which one was not.
   *
   * `snippets` has no producer in this deployment -- nothing passes a non-null
   * `snippetsBlocked`, and nothing can: the page reader keeps no response
   * headers, so `X-Robots-Tag` is unreadable, and the evidence contract's page
   * shape carries no meta-robots observation and is strict, so adding one is a
   * versioned change to a persisted, content-hashed contract. Until a producer
   * exists this module is therefore always `partial`, always for the same
   * reason, and the limitation below is where the reader is told so.
   *
   * Relaxing this predicate is the tempting fix and the wrong one: it would
   * report one measured-and-passed module and six measured signals as a
   * complete answer about seven, which is the unmeasured state rendered as a
   * pass. `not_checked` stays a third state all the way to the reader.
   */
  const complete =
    signals.every((signal) => signal.status === "present") &&
    groups !== null &&
    value.snippets.status !== "not_checked";
  if (complete) return { status: "available", value };
  const parts = [
    signals.some((signal) => signal.status !== "present")
      ? "Some machine-readable visibility signals were absent or unavailable."
      : "",
    groups === null ? robotsUndeterminedReason(robotsSource) : "",
    value.snippets.status === "not_checked"
      ? "Snippet permission was not checked."
      : "",
  ].filter((part) => part !== "");
  return { status: "partial", limitation: geoJoinLimitations(parts), value };
}

export interface GeoEvidenceInput {
  readonly evidence: GeoKnowledgeEvidenceV1;
  readonly offsite: GeoOffsiteCollection | null;
  readonly index: GeoSourceIndex;
}

export interface GeoEvidenceAssembly {
  readonly module: EvidenceModule;
  /** Items the citation rules refused, so the caller can report them. */
  readonly dropped: readonly {
    readonly group: GeoEvidenceGroup;
    readonly id: string;
    readonly reason: string;
  }[];
}

function ownSiteGroups(input: GeoEvidenceInput): {
  readonly proof: EvidenceItem[];
  readonly changelog: EvidenceItem[];
} {
  const pages = geoReadableOwnPages(input.index);
  const changelogUrls = new Set(
    input.evidence.pages.flatMap((page) =>
      page.links
        .filter((link) => link.intent === "changelog")
        .map((link) => link.url),
    ),
  );
  const item = (source: GeoKnowledgeSource): EvidenceItem => ({
    id: `evidence:${source.id}`,
    label: geoBoundText(source.label, EVIDENCE_LABEL_CODE_POINTS),
    // Bounded the same way the offsite collector bounds its own summaries: a
    // page excerpt may run to 1 200 code points and an evidence summary holds
    // 800. A cut that leaves a half-written number is caught below, because the
    // resulting literal occurs in no excerpt and the item is dropped.
    summary: geoBoundText(source.excerpts[0] ?? "", EVIDENCE_SUMMARY_CODE_POINTS),
    url: source.url,
    sourceRefs: [source.id],
    independence: "first_party",
  });
  return {
    proof: pages
      .filter((source) => source.url === null || !changelogUrls.has(source.url))
      .map(item),
    changelog: pages
      .filter((source) => source.url !== null && changelogUrls.has(source.url))
      .map(item),
  };
}

export function geoEvidenceModule(
  input: GeoEvidenceInput,
): GeoEvidenceAssembly {
  const dropped: { group: GeoEvidenceGroup; id: string; reason: string }[] = [];
  const own = ownSiteGroups(input);
  const offsite = input.offsite;
  const keep = (
    group: GeoEvidenceGroup,
    items: readonly EvidenceItem[],
  ): EvidenceItem[] =>
    items
      .flatMap((item) => {
        if (
          item.sourceRefs.some((ref) => input.index.droppedSourceRefs.has(ref))
        ) {
          dropped.push({ group, id: item.id, reason: "source_catalogue_full" });
          return [];
        }
        if (
          !geoItemIsCitable(
            item.sourceRefs,
            [
              { text: item.label, sourceRefs: item.sourceRefs },
              { text: item.summary, sourceRefs: item.sourceRefs },
            ],
            input.index,
          )
        ) {
          dropped.push({ group, id: item.id, reason: "literals_unsupported" });
          return [];
        }
        return [item];
      })
      .slice(0, GEO_KNOWLEDGE_LIMITS.evidenceItems);
  // The offsite collector's rows are read-only; the module's own rows are not.
  const offsiteItems = (items: readonly GeoOffsiteEvidenceItem[]): EvidenceItem[] =>
    items.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] }));
  const value: EvidenceValue = {
    proof: keep("proof", own.proof),
    changelog: keep("changelog", own.changelog),
    press: keep("press", offsiteItems(offsite?.evidence.press ?? [])),
    thirdPartyProfiles: keep(
      "thirdPartyProfiles",
      offsiteItems(offsite?.evidence.thirdPartyProfiles ?? []),
    ),
    firstPartyProof: keep(
      "firstPartyProof",
      offsiteItems(offsite?.evidence.firstPartyProof ?? []),
    ),
    // `proof` is looked for wherever any own page was read at all. `changelog`
    // is not: a changelog item exists only where a page's own links named one
    // (`changelogUrls` above), so a bundle in which no page body was parsed --
    // every source reused from the observation ledger, `pages` empty -- never
    // looked for one. Listing it as collected there renders on the card as
    // "Collected · nothing found": we looked and there is none, about a group
    // nothing could have found. The offsite collector reports for itself which
    // of its three it actually reached.
    collected: [
      "proof",
      ...(input.evidence.pages.length > 0 ? (["changelog"] as const) : []),
      ...(offsite?.evidence.collected ?? []),
    ],
  };
  if (value.proof.length === 0 && value.changelog.length === 0) {
    return {
      module: { status: "unavailable", reason: "insufficient_evidence" },
      dropped,
    };
  }
  const missing = GEO_EVIDENCE_GROUPS.filter(
    (group) => !value.collected.includes(group),
  );
  const parts = [
    missing.length > 0
      ? `Not collected in this run: ${missing.join(", ")}.`
      : "",
    dropped.length > 0
      ? `${dropped.length} collected item(s) could not be shown with their evidence.`
      : "",
    // A page that was fetched and could not be read was reached; saying it was
    // "not reached" would misdescribe the one failure the reader can act on.
    ...(offsite?.incomplete ?? []).map((entry) =>
      entry.stage === "landing_page_reads"
        ? `${entry.pending} off-site page(s) were fetched but could not be read (${entry.reason}).`
        : `Off-site ${entry.stage} stopped early (${entry.reason}), ${entry.pending} item(s) not reached.`,
    ),
  ].filter((part) => part !== "");
  return parts.length === 0
    ? { module: { status: "available", value }, dropped }
    : {
        module: {
          status: "partial",
          limitation: geoJoinLimitations(parts),
          value,
        },
        dropped,
      };
}

const COVERAGE_LABELS = {
  entity: "Entity",
  facts: "Facts",
  qa: "Q&A",
  comparisons: "Comparisons",
  scope: "Scope",
  evidence: "Evidence",
  machine: "Machine visibility",
} as const;

const COVERAGE_ACTION =
  "Review available evidence before relying on this section.";

function coverageRow(
  key: keyof typeof COVERAGE_LABELS,
  module: AnyModule,
  refs: readonly string[],
): CoverageValue[number] {
  const sourceRefs = [...new Set(refs)].slice(
    0,
    GEO_KNOWLEDGE_LIMITS.sourceRefs,
  );
  if (module.status === "available") {
    return {
      id: `coverage:${key}`,
      label: COVERAGE_LABELS[key],
      status: "covered",
      summary: "Supported content is available.",
      nextAction: null,
      sourceRefs,
    };
  }
  if (module.status === "partial") {
    return {
      id: `coverage:${key}`,
      label: COVERAGE_LABELS[key],
      status: "partial",
      summary: module.limitation ?? "",
      nextAction: COVERAGE_ACTION,
      sourceRefs,
    };
  }
  return {
    id: `coverage:${key}`,
    label: COVERAGE_LABELS[key],
    status: "missing",
    summary: "This content is currently unavailable.",
    nextAction: COVERAGE_ACTION,
    sourceRefs,
  };
}

export function geoCoverageModule(
  modules: Readonly<Record<keyof typeof COVERAGE_LABELS, AnyModule>>,
  refs: Readonly<Record<keyof typeof COVERAGE_LABELS, readonly string[]>>,
): CoverageModule {
  const rows = (
    Object.keys(COVERAGE_LABELS) as (keyof typeof COVERAGE_LABELS)[]
  ).map((key) => coverageRow(key, modules[key], refs[key]));
  return rows.every((row) => row.status === "covered")
    ? { status: "available", value: rows }
    : {
        status: "partial",
        limitation: "Some customer knowledge sections are incomplete.",
        value: rows,
      };
}

export type { GeoUnavailableReason };
