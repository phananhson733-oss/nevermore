import { describe, expect, it } from "vitest";
import { derivePriority } from "./priority.ts";
import type { PriorityInput, PriorityResult } from "./priority.ts";
import type { Severity } from "./rule.ts";
import type { Confidence } from "./confidence.ts";

/**
 * AC-029 — deterministic priority ordering (spec §9.3).
 *
 * §9.3 lists an ORDERED rule set over Finding severity / confidence / subject
 * relevance. It is written as eight numbered clauses:
 *
 *   1. severity critical                              -> critical / now
 *   2. severity high  + confidence high               -> high / now
 *   3. severity high  + confidence medium             -> high / next
 *   4. severity medium + priority hit + confidence high-> high / next
 *   5. severity medium                                -> medium / next
 *   6. severity low                                   -> low / later
 *   7. confidence low  -> HARD GATE: medium / later + status blocked
 *   8. risk high technical change -> not auto-ready; Action may be planned but the
 *      Artifact must carry a validation/rollback section.
 *
 * §9.3 RECONCILIATION (7 branches vs "8 steps"):
 *   `derivePriority` (packages/engine/src/priority.ts) has exactly SEVEN branches,
 *   and that is correct — it faithfully implements clauses 1-7, the only clauses
 *   that map (severity, confidence, subjectRelevance) -> (band, lane, status).
 *   Clause 8 is NOT a priority-ordering step: it keys off `risk`, a field
 *   `PriorityInput` deliberately does not carry, and it changes Artifact
 *   readiness / validation-rollback requirements — not the band or lane. It is
 *   therefore enforced downstream (Action ready-gating + Artifact generation for
 *   risk=high templates, e.g. normalize_canonical.v1 / review_ai_crawler_access.v1),
 *   never inside priority derivation. Hence "8 clauses" but 7 derivation branches;
 *   no ordering step is omitted. The runtime proof that clause 8 lives outside
 *   this function is `risk does not affect the result` below.
 *
 * ORDERING NOTE (clause 7 precedence): the implementation evaluates the
 * low-confidence hard gate BEFORE severity, so it overrides even `critical`. This
 * matches the semantics of §9.3 clause 7 + §8.7: a low-confidence candidate rests
 * only on generated / single-C evidence and "cannot create a ready Action" — the
 * gate is an override, so `critical + low` is gated to medium/later/blocked, not
 * rushed to critical/now.
 */

interface OrderingCase {
  readonly name: string;
  readonly input: PriorityInput;
  readonly expected: PriorityResult;
}

const input = (
  severity: Severity,
  confidence: Confidence,
  priorityRelevant: boolean,
): PriorityInput => ({ severity, confidence, priorityRelevant });

const result = (
  band: PriorityResult["band"],
  lane: PriorityResult["lane"],
  status: PriorityResult["status"],
): PriorityResult => ({ band, lane, status });

// The full §9.3 ordering as a crafted table. Each row names the clause it exercises.
const CASES: readonly OrderingCase[] = [
  // Clause 1 — critical severity wins over subject/confidence (given confidence not low).
  {
    name: "1: critical + high -> critical/now",
    input: input("critical", "high", false),
    expected: result("critical", "now", "candidate"),
  },
  {
    name: "1: critical + medium -> critical/now",
    input: input("critical", "medium", true),
    expected: result("critical", "now", "candidate"),
  },
  // Clause 2 — high + high -> high/now.
  {
    name: "2: high + high (non-priority) -> high/now",
    input: input("high", "high", false),
    expected: result("high", "now", "candidate"),
  },
  {
    name: "2: high + high (priority) -> high/now",
    input: input("high", "high", true),
    expected: result("high", "now", "candidate"),
  },
  // Clause 3 — high + medium -> high/next (demoted to `next`, not `now`).
  {
    name: "3: high + medium (non-priority) -> high/next",
    input: input("high", "medium", false),
    expected: result("high", "next", "candidate"),
  },
  {
    name: "3: high + medium (priority) -> high/next",
    input: input("high", "medium", true),
    expected: result("high", "next", "candidate"),
  },
  // Clause 4 — medium severity is PROMOTED to high band only when priority-relevant
  // AND confidence high.
  {
    name: "4: medium + priority + high -> high/next (promoted)",
    input: input("medium", "high", true),
    expected: result("high", "next", "candidate"),
  },
  // Clause 5 — plain medium. Confirms clause 4 does NOT fire without priority, and
  // does NOT fire at medium confidence even when priority-relevant.
  {
    name: "5: medium + high but NOT priority -> medium/next (no promotion)",
    input: input("medium", "high", false),
    expected: result("medium", "next", "candidate"),
  },
  {
    name: "5: medium + medium + priority -> medium/next (promotion needs high conf)",
    input: input("medium", "medium", true),
    expected: result("medium", "next", "candidate"),
  },
  {
    name: "5: medium + medium (non-priority) -> medium/next",
    input: input("medium", "medium", false),
    expected: result("medium", "next", "candidate"),
  },
  // Clause 6 — low severity is never promoted by priority relevance.
  {
    name: "6: low + high -> low/later",
    input: input("low", "high", false),
    expected: result("low", "later", "candidate"),
  },
  {
    name: "6: low + high + priority -> low/later (priority does not lift low severity)",
    input: input("low", "high", true),
    expected: result("low", "later", "candidate"),
  },
  {
    name: "6: low + medium + priority -> low/later",
    input: input("low", "medium", true),
    expected: result("low", "later", "candidate"),
  },
  // Clause 7 — the low-confidence HARD GATE overrides EVERY severity, including
  // critical (see ORDERING NOTE above). Always medium/later/blocked.
  {
    name: "7: low severity + low conf -> medium/later/blocked",
    input: input("low", "low", false),
    expected: result("medium", "later", "blocked"),
  },
  {
    name: "7: medium severity + low conf + priority -> medium/later/blocked",
    input: input("medium", "low", true),
    expected: result("medium", "later", "blocked"),
  },
  {
    name: "7: high severity + low conf -> medium/later/blocked (gate beats high)",
    input: input("high", "low", false),
    expected: result("medium", "later", "blocked"),
  },
  {
    name: "7: critical severity + low conf -> medium/later/blocked (gate beats critical)",
    input: input("critical", "low", false),
    expected: result("medium", "later", "blocked"),
  },
];

describe("derivePriority — full §9.3 ordering (AC-029)", () => {
  it.each(CASES)("$name", ({ input: given, expected }) => {
    expect(derivePriority(given)).toEqual(expected);
  });

  // Clause 8 lives OUTSIDE this function: `risk` is not a `PriorityInput` field and
  // must not change the derived (band, lane, status). Passing a stray `risk: "high"`
  // is ignored — the band/lane/status is identical to the same input without it.
  it("8: risk does not affect the derived priority (clause 8 is enforced downstream)", () => {
    const base = input("high", "high", true);
    const withRisk = { ...base, risk: "high" } as unknown as PriorityInput;
    expect(derivePriority(withRisk)).toEqual(derivePriority(base));
  });

  // The derivation is a total, deterministic function: same input -> same output.
  it("is deterministic (replayable, spec §9.3 — no opaque weighted score)", () => {
    for (const { input: given } of CASES) {
      expect(derivePriority(given)).toEqual(derivePriority(given));
    }
  });
});
