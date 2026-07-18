import { describe, expect, it } from "vitest";
import { findingKey, mergeRunCandidates } from "./merge.ts";
import { contentHash } from "./util/hash.ts";
import { FINDING_REGISTRY } from "./registry.ts";
import type { FindingCandidate } from "./rule.ts";

const draft = (subjectRefs: string[], severity: FindingCandidate["severity"]): FindingCandidate => ({
  subjectRefs,
  severity,
  titleArgs: {},
  metrics: {},
  evidence: [
    {
      sourceProvider: "crawl",
      origin: "direct_public",
      method: "observed",
      grade: "B",
      availability: "available",
      support: "supports",
      subjectRefs,
      claim: "c",
      observedAt: "2026-07-18T00:00:00Z",
      limitation: "l",
    },
  ],
});

describe("findingKey (spec §8.6)", () => {
  it("is the sha256 of the canonical {projectId,domain,ruleFamily,sortedSubjectRefs,intent}", () => {
    const meta = FINDING_REGISTRY["TECH-HTTP-001"];
    const expected = contentHash({
      projectId: "p1",
      domain: meta.domain,
      ruleFamily: meta.ruleFamily,
      sortedSubjectRefs: ["http_status:404"],
      intent: meta.intent,
    });
    expect(findingKey("p1", "TECH-HTTP-001", ["http_status:404"])).toBe(expected);
  });

  it("is order-independent in subjectRefs (stable across runs)", () => {
    const a = findingKey("p1", "TECH-CANONICAL-002", ["b", "a"]);
    const b = findingKey("p1", "TECH-CANONICAL-002", ["a", "b"]);
    expect(a).toBe(b);
  });

  it("differs by project", () => {
    expect(findingKey("p1", "TECH-HTTP-001", ["x"])).not.toBe(
      findingKey("p2", "TECH-HTTP-001", ["x"]),
    );
  });
});

describe("mergeRunCandidates (spec §8.6)", () => {
  it("merges candidates with the same merge key, keeping the highest severity + union evidence", () => {
    const merged = mergeRunCandidates([
      { ruleId: "TECH-HTTP-001", candidates: [draft(["http_status:500"], "medium")] },
      { ruleId: "TECH-HTTP-001", candidates: [draft(["http_status:500"], "high")] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.severity).toBe("high");
    expect(merged[0]!.evidence).toHaveLength(2);
  });

  it("keeps distinct subject sets separate", () => {
    const merged = mergeRunCandidates([
      { ruleId: "TECH-HTTP-001", candidates: [draft(["http_status:404"], "high"), draft(["http_status:500"], "high")] },
    ]);
    expect(merged).toHaveLength(2);
  });
});
