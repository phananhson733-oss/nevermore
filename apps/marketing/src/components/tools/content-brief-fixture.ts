// @input  -- the package's content-brief fixture knobs and shallow ContentBrief overrides
// @output -- one contract-valid ContentBrief for the UI tests, plus a run-meta merge helper
// @pos    -- thin wrapper over @sf/public-tools/content-brief/fixtures so the brief the
//            surface renders in tests is the one the producer's own builders assemble
//
// The package fixture is assembled through assemble.ts, so with no overrides
// it passes the parser's recompute-and-compare check. Any override that
// touches a recomputable field (must_answer items, format values, ...) makes
// the result a shape the parser rejects; that is fine for a rendering test,
// but such a brief must not be asserted to pass the parser.

import type {
  BriefRunMeta,
  ContentBrief,
} from "@sf/public-tools/content-brief/contract";
import {
  contentBriefFixture,
  withFingerprint,
  type FixtureOptions,
} from "@sf/public-tools/content-brief/fixtures";

export { withFingerprint, type FixtureOptions };

/**
 * A contract-valid brief; `overrides` replace top-level fields wholesale,
 * `knobs` pick one of the package fixture's assembled variants (unsupported
 * language, failed model validation, unavailable SERP, ...).
 */
export function validContentBrief(
  overrides: Partial<ContentBrief> = {},
  knobs: FixtureOptions = {},
): ContentBrief {
  return { ...contentBriefFixture(knobs), ...overrides };
}

/** The same brief with some of `run` replaced; `reads` merges one level deeper. */
export function withRun(
  brief: ContentBrief,
  run: Partial<Omit<BriefRunMeta, "reads">> & {
    readonly reads?: Partial<BriefRunMeta["reads"]>;
  },
): ContentBrief {
  const { reads, ...rest } = run;
  return {
    ...brief,
    run: {
      ...brief.run,
      ...rest,
      reads: { ...brief.run.reads, ...(reads ?? {}) },
    },
  };
}
