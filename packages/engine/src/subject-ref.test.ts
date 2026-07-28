import { describe, expect, it } from "vitest";
import {
  competitorEntityIdFromSubjectRef,
  competitorEntitySubjectRef,
} from "./subject-ref.ts";

const COMPETITOR_ID = "20000000-0000-4000-8000-000000004001";

describe("competitor entity subject references", () => {
  it("encodes a stable competitor identity in the declared competitor SubjectRef kind", () => {
    const subjectRef = competitorEntitySubjectRef(COMPETITOR_ID);

    expect(subjectRef).toBe(`competitor:${COMPETITOR_ID}`);
    expect(competitorEntityIdFromSubjectRef(subjectRef)).toBe(COMPETITOR_ID);
  });

  it.each([
    "competitor_entity:20000000-0000-4000-8000-000000004001",
    "site:competitor_entity:20000000-0000-4000-8000-000000004001",
    "site:20000000-0000-4000-8000-000000004001",
    "competitor:not-a-uuid",
    "https://competitor.example/",
    "",
  ])("rejects non-canonical or ambiguous refs: %s", (subjectRef) => {
    expect(competitorEntityIdFromSubjectRef(subjectRef)).toBeNull();
  });

  it("rejects invalid identities before they can enter evidence", () => {
    expect(() => competitorEntitySubjectRef("not-a-uuid")).toThrow(
      "invalid competitor entity id",
    );
  });
});
