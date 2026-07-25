import {
  FlowShadowQaGatesRepository,
  type Executor,
  type ProjectScope,
} from "@sf/db";
import { ContentShadowQaClaim } from "@sf/contracts";
import { qaSeverityForClaimId } from "@sf/flow-shadow";
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
 *
 * There is a THIRD consumer, and it does not write: the artifacts read model.
 * The Studio "Mark ready" control performs the `draft -> ready` PATCH, and
 * until it could see this judgement an operator learned the refusal by being
 * refused. Closing the write path was correctness; letting the control say so
 * first is usability, and it must not be bought by re-deriving the rule in a
 * reader. `readContentShadowAdoption` is therefore the same code the refusal
 * runs, returned instead of thrown.
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

/** The claim shape the gate row stores. Severity is not persisted. */
const StoredQaClaim = ContentShadowQaClaim.omit({ severity: true });

/**
 * What a reader may be told about one deliverable's door into `ready`.
 *
 * `blockingClaimIds` exists so a disabled control can say WHICH checks held the
 * draft back rather than only that something did. It carries identifiers, not
 * sentences: naming them is the reader's job, and it already owns that
 * vocabulary for the same claims on the Execution surface.
 */
export interface ContentShadowAdoption {
  readonly blocked: boolean;
  readonly blockingClaimIds: readonly string[];
}

/**
 * The blocking checks a gate row records as not passed, in gate order.
 *
 * Severity is resolved through `@sf/flow-shadow`'s own table. A literal list of
 * "the blocking three" here would be a copy of a backend invariant living in
 * the code that reports it, and the direction such a copy drifts is the
 * expensive one: a blocking check believed advisory reads to an operator as
 * safe to adopt.
 *
 * Unreadable claims yield no reasons rather than a guessed one. The verdict is
 * a column and stays authoritative on its own, so the control still refuses;
 * what is lost is only the itemisation, and inventing an item would be the
 * "we did not look" -> "we found something" substitution in the reader.
 */
export function adoptionBlockingClaimIds(
  claims: readonly unknown[],
): readonly string[] {
  const parsed = StoredQaClaim.array().safeParse(claims);
  if (!parsed.success) return [];
  return parsed.data
    .filter(
      (claim) =>
        claim.status === "failed" &&
        qaSeverityForClaimId(claim.claimId) === "blocking",
    )
    .map((claim) => claim.claimId);
}

/**
 * The adoption judgement, returned rather than thrown.
 *
 * `null` means this artifact type has no Content Shadow gate at all, which is
 * not the same statement as "it is allowed": a `content_brief` is never judged
 * by one, and reporting `blocked: false` for it would invite a reader to show a
 * cleared-by-the-gate affordance for a deliverable no gate ever saw.
 *
 * A judged deliverable with no gate row IS `blocked: false`, for the reason
 * `assertContentShadowAdoptionAllowed` gives below: nothing has judged it.
 */
export async function readContentShadowAdoption(
  exec: Executor,
  scope: ProjectScope,
  artifact: { readonly id: string; readonly artifact_type: string },
): Promise<ContentShadowAdoption | null> {
  if (artifact.artifact_type !== CONTENT_SHADOW_DRAFT_ARTIFACT_TYPE) return null;
  const gate = await new FlowShadowQaGatesRepository(exec).findLatestByArtifact(
    scope,
    artifact.id,
  );
  if (gate === null) return { blocked: false, blockingClaimIds: [] };
  if (!verdictForbidsAdoption(gate.verdict)) {
    return { blocked: false, blockingClaimIds: [] };
  }
  return { blocked: true, blockingClaimIds: adoptionBlockingClaimIds(gate.claims) };
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
  // The same call the read model makes, so the control's answer and the
  // server's answer cannot be produced by different code.
  const adoption = await readContentShadowAdoption(exec, scope, artifact);
  if (adoption !== null && adoption.blocked) {
    throw contentShadowAdoptionBlocked(pointer);
  }
}
