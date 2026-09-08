import { describe, expect, it } from "vitest";

import { geoItemKey } from "./kb-item-key.ts";
import {
  assembleGeoKnowledgeBodyV3,
  GEO_REVIEW_PERIOD_MS,
} from "./kb-knowledge-assemble.ts";
import {
  assembledPayload,
  assembleFixture,
  assemblyEvidence,
  assemblyInput,
  assemblyOffsite,
  assemblySynthesisInput,
  ASSEMBLED_AT,
  OWN_SOURCE,
  PLANS_SOURCE,
  THIRD_PARTY_SOURCE,
  THIRD_PARTY_URL,
} from "./kb-knowledge-assemble.test-fixtures.ts";
import { buildGeoSourceCatalogue } from "./kb-knowledge-assemble-sources.ts";
import { geoMachineModule } from "./kb-knowledge-assemble-observed.ts";
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { geoV2NarrativeFixture, V2_AT, V2_HASH } from "./kb-knowledge-synthesis-v2-fixtures.ts";
import { geoV3Items, parseGeoKbPayloadV3 } from "./kb-v3-contract.ts";

type Narrative = ReturnType<typeof geoV2NarrativeFixture>;

const PRO_KEY = geoItemKey({
  module: "facts", type: "price", subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Pro plan"],
});
const TEAM_KEY = geoItemKey({
  module: "facts", type: "price", subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Team plan"],
});

function facts(knowledge: ReturnType<typeof assembleFixture>["knowledge"]) {
  const module = knowledge.facts;
  if (module.status === "unavailable") throw new Error("facts unavailable");
  return module.value;
}

describe("assembleGeoKnowledgeBodyV3", () => {
  it("produces a body the v3 parser accepts", () => {
    const payload = assembledPayload();
    expect(payload.schemaVersion).toBe("marketing-geo-kb.v3");
    expect(geoV3Items(payload.knowledge).length).toBeGreaterThan(0);
  });

  it("derives every item key from content alone, so re-evidencing keeps identity", () => {
    const fromHome = facts(assembleFixture().knowledge).find((fact) => fact.itemKey === PRO_KEY);
    const fromPlans = facts(assembleFixture({
      plansExcerpts: ["Pro is $9 per month on the plans page."],
      narrative: (value: Narrative) => ({
        ...value,
        facts: value.facts.map((fact) => fact.id === "fact:pro-price"
          ? { ...fact, statement: "The Pro plan costs $9 per month.", sourceRefs: [PLANS_SOURCE] }
          : fact),
      }),
    }).knowledge).find((fact) => fact.itemKey === PRO_KEY);
    expect(fromHome?.sourceRefs).toEqual([OWN_SOURCE]);
    expect(fromPlans?.sourceRefs).toEqual([PLANS_SOURCE]);
    // Same claim, different page, same identity: the owner's decision survives.
    expect(fromPlans?.itemKey).toBe(fromHome?.itemKey);
  });

  it("keeps two plans' prices apart, because their qualifiers differ", () => {
    const value = facts(assembleFixture().knowledge);
    expect(value.map((fact) => fact.itemKey)).toContain(PRO_KEY);
    expect(value.map((fact) => fact.itemKey)).toContain(TEAM_KEY);
    expect(PRO_KEY).not.toBe(TEAM_KEY);
  });

  it("labels a checked citation only when the cited excerpts carry the claim's numbers", () => {
    const value = facts(assembleFixture().knowledge);
    expect(value.every((fact) => fact.evidenceChecks === "cited_and_literals_match")).toBe(true);
  });

  it("labels a declared value the excerpts do not carry as not applicable, and says so", () => {
    const evidence = assemblyEvidence();
    const assembly = assembleGeoKnowledgeBodyV3({
      ...assemblyInput(),
      evidence,
      // The confirmed Profile says the brand is "Pine Cloud 24"; no observed
      // page carries that number.
      identity: { ...assemblyInput().identity, officialName: "Pine Cloud 24" },
      synthesisInput: assemblySynthesisInput(evidence, "Pine Cloud 24"),
    });
    const entity = assembly.knowledge.entity;
    if (entity.status === "unavailable") throw new Error("entity unavailable");
    const name = entity.value.fields.find((field) => field.field === "name");
    expect(name?.origin).toBe("declared_profile");
    expect(name?.evidenceChecks).toBe("not_applicable");
    expect(assembly.dropped).toContainEqual({ module: "entity", id: "name", reason: "literals_unsupported" });
  });

  it("dates the next review 90 days after the observation the fact rests on", () => {
    const fact = facts(assembleFixture().knowledge)[0];
    expect(fact?.observedAt).toBe(V2_AT);
    expect(fact?.nextReviewAt).toBe(new Date(Date.parse(V2_AT) + GEO_REVIEW_PERIOD_MS).toISOString());
  });

  it("carries the site's own question-and-answer markup as observed items", () => {
    const knowledge = assembleFixture({
      faq: [{ question: "How do approvals work?", answer: "Every workflow requires human approval." }],
    }).knowledge;
    if (knowledge.qa.status === "unavailable") throw new Error("qa unavailable");
    const observed = knowledge.qa.value.find((item) => item.origin === "observed_own");
    expect(observed?.question).toBe("How do approvals work?");
    expect(observed?.sourceRefs).toEqual([OWN_SOURCE]);
    expect(observed?.itemKey).toBe(geoItemKey({ module: "qa", intent: "other", canonicalQuestion: "How do approvals work?" }));
  });

  it("keeps the observed modules when the model step fails", () => {
    const assembly = assembleFixture({
      narrativeFailureReason: "outcome_unknown",
      faq: [{ question: "How do approvals work?", answer: "Every workflow requires human approval." }],
    });
    const knowledge = assembly.knowledge;
    expect(knowledge.entity).toEqual({ status: "unavailable", reason: "outcome_unknown" });
    expect(knowledge.facts).toEqual({ status: "unavailable", reason: "outcome_unknown" });
    expect(knowledge.comparisons).toEqual({ status: "unavailable", reason: "outcome_unknown" });
    expect(knowledge.scope).toEqual({ status: "unavailable", reason: "outcome_unknown" });
    // The site's own markup and the machine observations do not depend on it.
    expect(knowledge.qa.status).toBe("partial");
    expect(knowledge.machine.status).not.toBe("unavailable");
    expect(knowledge.evidence.status).not.toBe("unavailable");
  });

  it("says which evidence groups were never collected, rather than showing them empty", () => {
    const withoutOffsite = assembleFixture().knowledge.evidence;
    if (withoutOffsite.status === "unavailable") throw new Error("evidence unavailable");
    expect(withoutOffsite.value.collected).toEqual(["proof", "changelog"]);
    if (withoutOffsite.status !== "partial") throw new Error("evidence should be partial");
    expect(withoutOffsite.limitation).toContain("press");

    const withOffsite = assembleFixture({ offsite: assemblyOffsite() }).knowledge.evidence;
    if (withOffsite.status === "unavailable") throw new Error("evidence unavailable");
    expect(withOffsite.value.collected).toContain("thirdPartyProfiles");
    expect(withOffsite.value.thirdPartyProfiles[0]?.independence).toBe("independent");
  });

  it("discloses off-site pages that were fetched and could not be read", () => {
    const offsite = assemblyOffsite();
    const evidence = assembleFixture({
      offsite: {
        ...offsite,
        // The run read one profile page; both press candidates failed to read,
        // so press is not collected and the failures are on the record.
        evidence: { ...offsite.evidence, collected: ["thirdPartyProfiles"] },
        incomplete: [{ stage: "landing_page_reads", reason: "fetch_failed", pending: 2 }],
        spent: { ...offsite.spent, pagesUnreadable: 2 },
      },
    }).knowledge.evidence;
    if (evidence.status !== "partial") throw new Error("evidence should be partial");
    expect(evidence.value.collected).not.toContain("press");
    expect(evidence.limitation).toContain("Not collected in this run: press, firstPartyProof.");
    expect(evidence.limitation).toContain("2 off-site page(s) were fetched but could not be read (fetch_failed).");
    // Those pages were reached. Reporting them as unreached would name the
    // wrong failure, and the wrong fix.
    expect(evidence.limitation).not.toContain("not reached");
  });

  it("admits a cross-referenced third party to sameAs and cites the page that proved it", () => {
    const knowledge = assembleFixture({ offsite: assemblyOffsite() }).knowledge;
    if (knowledge.entity.status === "unavailable") throw new Error("entity unavailable");
    expect(knowledge.entity.value.sameAs).toEqual([THIRD_PARTY_URL]);
    const field = knowledge.entity.value.fields.find((entry) => entry.field === "sameAs");
    expect(field?.origin).toBe("observed_third_party");
    expect(field?.sourceRefs).toEqual([THIRD_PARTY_SOURCE]);
    expect(knowledge.sourceCatalogue.some((source) => source.id === THIRD_PARTY_SOURCE)).toBe(true);
  });

  it("reports AI crawler permission per agent, and reports nothing when robots was truncated", () => {
    const read = assembleFixture({ robotsExcerpts: ["User-agent: GPTBot", "Disallow: /"] }).knowledge.machine;
    if (read.status === "unavailable") throw new Error("machine unavailable");
    expect(read.value.aiCrawlers.training).toContainEqual({ agent: "GPTBot", access: "disallowed" });
    // Search-use permission is a separate question; blocking GPTBot answers it
    // for training only.
    expect(read.value.aiCrawlers.search).toContainEqual({ agent: "OAI-SearchBot", access: "unspecified" });

    const truncated = assembleFixture({
      robotsExcerpts: ["User-agent: *", "Allow: /", "Sitemap: https://product.example/sitemap.xml", "d", "e", "f", "g", "h"],
    }).knowledge.machine;
    if (truncated.status !== "partial") throw new Error("machine should be partial");
    expect(truncated.value.aiCrawlers.training).toEqual([]);
    expect(truncated.limitation).toContain("robots.txt was not read in full");
  });

  it("carries the sitemap count as a decimal string, which the payload can store", () => {
    const machine = assembleFixture().knowledge.machine;
    if (machine.status === "unavailable") throw new Error("machine unavailable");
    expect(machine.value.sitemap.urlCount).toBe("0");
    expect(machine.value.snippets.status).toBe("not_checked");
  });

  it("refuses a narrative bought against different evidence", () => {
    const evidence = assemblyEvidence({ plansExcerpts: ["Pro is $9 per month."] });
    expect(() => assembleGeoKnowledgeBodyV3({
      ...assemblyInput(),
      evidence,
      synthesisInput: assemblySynthesisInput(assemblyEvidence()),
    })).toThrow(/evidence hash mismatch/iu);
  });

  it("refuses an identity that differs from the one the model was asked about", () => {
    expect(() => assembleGeoKnowledgeBodyV3({
      ...assemblyInput(),
      identity: { ...assemblyInput().identity, officialName: "Someone Else" },
    })).toThrow(/identity differs/iu);
  });

  it("refuses an assembly dated before the evidence it assembles", () => {
    expect(() => assembleGeoKnowledgeBodyV3({ ...assemblyInput(), generatedAt: "2026-09-01T00:00:00.000Z" }))
      .toThrow(/predates/iu);
  });

  it("is deterministic: the same run assembles to the same body twice", () => {
    expect(JSON.stringify(assembleFixture().knowledge)).toBe(JSON.stringify(assembleFixture().knowledge));
    expect(assembleFixture().knowledge.generatedAt).toBe(ASSEMBLED_AT);
  });

  it("keeps the whole assembled body inside the payload's part budget", () => {
    expect(() => parseGeoKbPayloadV3(assembledPayload())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// geoMachineModule, driven directly
//
// The shared assembly fixture pins robots.txt to "available", so the branches
// below -- a site with no robots.txt, one whose fetch failed, and one where
// every other signal is present -- have no expression in it. Building the
// evidence here keeps that variation out of a fixture six other tests depend on.
// ---------------------------------------------------------------------------

const MACHINE_TARGET = "https://machine.example/";
const MACHINE_OWN = "source:machine-own";

type RobotsState = "read" | "truncated" | "absent" | "unreachable";

interface MachineEvidenceOptions {
  readonly robots?: RobotsState;
  /** Every signal but `snippets` present, so only `snippets` can hold it back. */
  readonly everySignalPresent?: boolean;
}

function robotsSourceFor(state: RobotsState) {
  const url = "https://machine.example/robots.txt";
  const base = { id: "source:machine-robots", kind: "robots" as const, label: "robots.txt", url, competitor: null };
  if (state === "absent") {
    return { ...base, availability: "unavailable" as const, reason: "not_published" as const, observedAt: null, bodyHash: null, excerpts: [] };
  }
  if (state === "unreachable") {
    return { ...base, availability: "unavailable" as const, reason: "fetch_failed" as const, observedAt: null, bodyHash: null, excerpts: [] };
  }
  return {
    ...base,
    availability: "available" as const,
    reason: null,
    observedAt: V2_AT,
    bodyHash: V2_HASH,
    // Eight lines is the per-source excerpt ceiling, so a robots.txt that
    // filled it may have said something else on line nine and none of it can
    // be relied on. Written out rather than derived from the ceiling constant:
    // a fixture computed from the limit passes whatever the limit becomes.
    excerpts: state === "truncated"
      ? ["User-agent: *", "Allow: /", "Disallow: /a", "Disallow: /b", "Disallow: /c", "Disallow: /d", "Disallow: /e", "Disallow: /f"]
      : ["User-agent: *", "Allow: /"],
  };
}

function machineEvidence(options: MachineEvidenceOptions = {}) {
  const full = options.everySignalPresent === true;
  const robots = options.robots ?? "read";
  const robotsStatus = robots === "absent" ? "absent" : robots === "unreachable" ? "unreachable" : "present";
  const pages = full
    ? [{
        url: MACHINE_TARGET, canonicalUrl: null, title: "Machine example", description: null, lang: "en",
        jsonLdTypes: ["Organization"], hreflangLocales: ["en"], hreflang: [{ locale: "en", url: MACHINE_TARGET }],
        faq: [], links: [],
      }]
    : [];
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1",
    collectedAt: V2_AT,
    targetUrl: MACHINE_TARGET,
    confirmedCompetitors: [],
    availability: "partial",
    limitation: "Machine-readable endpoints vary by fixture.",
    pages,
    machine: {
      jsonLd: { status: full ? "present" : "absent", types: full ? ["Organization"] : [], sourceRefs: [MACHINE_OWN] },
      llms: { status: full ? "present" : "absent", sourceRefs: ["source:machine-llms"] },
      robots: { status: robotsStatus, sourceRefs: ["source:machine-robots"] },
      sitemap: { status: "present", sourceRefs: ["source:machine-sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
      hreflang: { status: full ? "present" : "absent", locales: full ? ["en"] : [], sourceRefs: [MACHINE_OWN] },
    },
    sourceCatalogue: [
      {
        id: MACHINE_OWN, kind: "own_page", label: "Home", url: MACHINE_TARGET, competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: ["Machine example is a product for teams."],
      },
      robotsSourceFor(robots),
      {
        id: "source:machine-sitemap", kind: "sitemap", label: "sitemap.xml", url: "https://machine.example/sitemap.xml",
        competitor: null, availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: ["<urlset></urlset>"],
      },
      full
        ? {
            id: "source:machine-llms", kind: "llms", label: "llms.txt", url: "https://machine.example/llms.txt",
            competitor: null, availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
            excerpts: ["# Machine example"],
          }
        : {
            id: "source:machine-llms", kind: "llms", label: "llms.txt", url: "https://machine.example/llms.txt",
            competitor: null, availability: "unavailable", reason: "not_found", observedAt: null, bodyHash: null, excerpts: [],
          },
    ],
  });
}

function machineModule(options: MachineEvidenceOptions = {}, snippetsBlocked: boolean | null = null) {
  const evidence = machineEvidence(options);
  return geoMachineModule({ evidence, index: buildGeoSourceCatalogue(evidence, null), robots: null, snippetsBlocked });
}

function partialMachine(options: MachineEvidenceOptions = {}, snippetsBlocked: boolean | null = null) {
  const module = machineModule(options, snippetsBlocked);
  if (module.status !== "partial") throw new Error(`expected a partial machine module, got ${module.status}`);
  return module;
}

describe("geoMachineModule: why AI crawler permission was not determined", () => {
  it("says the site publishes no robots.txt rules rather than blaming a read that was cut short", () => {
    const module = partialMachine({ robots: "absent" });
    expect(module.limitation).toContain("this site publishes no robots.txt rules");
    expect(module.limitation).not.toContain("not read in full");
    expect(module.limitation).not.toContain("could not be read");
    expect(module.value.aiCrawlers.training).toEqual([]);
    expect(module.value.aiCrawlers.search).toEqual([]);
  });

  it("says robots.txt could not be read when the fetch failed, which is a different remedy", () => {
    const module = partialMachine({ robots: "unreachable" });
    expect(module.limitation).toContain("robots.txt could not be read");
    expect(module.limitation).not.toContain("not read in full");
    expect(module.limitation).not.toContain("publishes no robots.txt rules");
    expect(module.value.aiCrawlers.training).toEqual([]);
  });

  it("keeps naming truncation when the excerpt ceiling was filled", () => {
    const module = partialMachine({ robots: "truncated" });
    expect(module.limitation).toContain("robots.txt was not read in full");
    expect(module.limitation).not.toContain("could not be read");
    expect(module.limitation).not.toContain("publishes no robots.txt rules");
    expect(module.value.aiCrawlers.training).toEqual([]);
  });

  it("determines permissions, and says nothing about robots.txt, when the file was read in full", () => {
    const module = partialMachine({ robots: "read" });
    expect(module.limitation).not.toContain("AI crawler permissions were not determined");
    expect(module.value.aiCrawlers.search).toEqual([
      { agent: "OAI-SearchBot", access: "allowed" },
      { agent: "ChatGPT-User", access: "allowed" },
      { agent: "PerplexityBot", access: "allowed" },
    ]);
  });
});

describe("geoMachineModule: snippet permission is a third state, not a pass", () => {
  it("stays partial while snippet permission is unchecked, with every other signal present", () => {
    const module = partialMachine({ robots: "read", everySignalPresent: true });
    expect(module.value.snippets.status).toBe("not_checked");
    // Exact, not `toContain`: the other two sentences being empty is what
    // proves the fixture reached this gate rather than dying at an earlier one.
    expect(module.limitation).toBe("Snippet permission was not checked.");
  });

  it("reports available only once a real observation arrives, and keeps blocked apart from allowed", () => {
    const allowed = machineModule({ robots: "read", everySignalPresent: true }, false);
    if (allowed.status !== "available") throw new Error(`expected available, got ${allowed.status}`);
    expect(allowed.value.snippets.status).toBe("allowed");

    const blocked = machineModule({ robots: "read", everySignalPresent: true }, true);
    if (blocked.status !== "available") throw new Error(`expected available, got ${blocked.status}`);
    expect(blocked.value.snippets.status).toBe("blocked");
  });
});
