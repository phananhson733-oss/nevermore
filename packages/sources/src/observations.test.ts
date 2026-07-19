import { describe, expect, it } from "vitest";
import { buildObservation } from "./observations.ts";

describe("buildObservation unavailable-value invariant (AC-017)", () => {
  it.each(["partial", "unavailable"] as const)(
    "forces every value channel to null when availability is %s",
    (availability) => {
      const observation = buildObservation({
        provider: "ga4",
        metricKey: "fixture.metric.v1",
        subjectType: "url",
        subjectRef: "https://example.test/pricing",
        observedAt: "2026-07-18T00:00:00.000Z",
        availability,
        value: {
          numeric: 0,
          text: "a misleading value",
          json: { sessions: 0 },
        },
        unit: "sessions",
        limitation: "The provider did not return a usable value.",
      });

      expect(observation).toMatchObject({
        availability,
        valueNumeric: null,
        valueText: null,
        valueJson: null,
      });
    },
  );
});
