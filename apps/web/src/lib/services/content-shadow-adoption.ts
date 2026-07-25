import {
  FlowShadowQaGatesRepository,
  type Executor,
  type ProjectScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";

/**
 * Whether a Content Shadow deliverable may be adopted — one judgement, for
 * every door into `ready`.
 *
 * There are two of them, and only one was ever guarded. `POST
 * /content-shadow-runs/{id}/review` refuses a `blocked` verdict; the generic
 * `PATCH /artifacts/{id}` performs the SAME `draft -> ready` write from the
 * workspace editor rendered directly below the Content Shadow surface. An
 * operator who could not pass review from the review control could reach the
 * editor and mark the identical draft reviewed while the quality rail beside it
 * still read "references that cannot be verified".
 *
 * `blocked` exists to stop adoption. A second write path that does not consult
 * it does not weaken the gate — it removes it.
 *
 * So the predicate, the reason text and the problem code live here and nowhere
 * else. This slice produced the same defect repeatedly by implementing one rule
 * in two places and letting the copies drift; a second literal `"blocked"`
 * comparison in a service is that defect.
 */

/** The only artifact type a Content Shadow QA gate ever judges. */
export const CONTENT_SHADOW_DRAFT_ARTIFACT_TYPE = "english_blog_draft";

/**
 * The reason a person is given, in both paths, verbatim.
 *
 * It names what happened (a citation could not be checked against the frozen
 * records), states that this is not a run failure, and points at the real way
 * forward. It never says "error".
 */
const BLOCKED_DETAIL =
  "This draft cites sources the frozen research records cannot verify, so it cannot pass review. Revise it and check it again.";

/** The stable machine reason both paths report. */
const BLOCKED_CODE = "verdict_blocked";

/**
 * The gate verdicts that forbid adoption.
 *
 * A function rather than a bare `=== "blocked"` comparison, so that widening
 * the set is one edit that reaches both doors instead of two edits that can be
 * made one at a time.
 */
export function verdictForbidsAdoption(
  verdict: string | null | undefined,
): boolean {
  return verdict === "blocked";
}

/**
 * The refusal both paths raise. `pointer` differs because the two requests
 * carry the offending value in different fields; the problem code, the machine
 * reason and the sentence a person reads do not.
 */
export function contentShadowAdoptionBlocked(pointer: string): ProblemError {
  return new ProblemError("VALIDATION_ERROR", BLOCKED_DETAIL, {
    errors: [{ pointer, code: BLOCKED_CODE, message: BLOCKED_DETAIL }],
  });
}

/**
 * Refuse to move a Content Shadow draft to `ready` while its latest automated
 * verdict is `blocked`.
 *
 * Reads the latest gate for the ARTIFACT rather than for one run: after an
 * edit the run's verdict no longer describes the current bytes, and the review
 * endpoint refuses that case too (as a stale-revision conflict). Both doors
 * therefore stay shut until a fresh judgement exists, which is the only state
 * in which "this draft was checked" is true.
 *
 * A deliverable with no gate row at all is not blocked: nothing has judged it,
 * and inventing a refusal from an absent record would be the "we did not look"
 * -> "we found something" substitution this slice exists to avoid.
 */
export async function assertContentShadowAdoptionAllowed(
  exec: Executor,
  scope: ProjectScope,
  artifact: { readonly id: string; readonly artifact_type: string },
  pointer: string,
): Promise<void> {
  if (artifact.artifact_type !== CONTENT_SHADOW_DRAFT_ARTIFACT_TYPE) return;
  const gate = await new FlowShadowQaGatesRepository(exec).findLatestByArtifact(
    scope,
    artifact.id,
  );
  if (gate === null) return;
  if (verdictForbidsAdoption(gate.verdict)) {
    throw contentShadowAdoptionBlocked(pointer);
  }
}
