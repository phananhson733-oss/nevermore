// @input  -- planned draft tasks, plus injected page-fetch and model seams
// @output -- validated drafts with their named source, and why the rest produced none
// @pos    -- orchestration only; both side effects are seams supplied by apps/*
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { buildDraftPrompt, validateDraft } from "./draft.ts";
import type { DraftTask } from "./draft-plan.ts";

export interface PageMeta {
  readonly title: string | null;
  readonly metaDescription: string | null;
}

/**
 * One model reply.
 *
 * `truncated` is carried as data rather than inferred from the text, because
 * the two failures it separates look identical from here: a reply cut off at
 * the token ceiling and a reply the model formatted badly are both "not the
 * JSON we asked for". Only the caller that made the request knows which.
 */
export interface DraftCompletion {
  readonly text: string;
  /** True when the model stopped because it ran out of budget, not ideas. */
  readonly truncated: boolean;
}

export interface DraftRunDependencies {
  /** Returns null when the page could not be read. Never throws for a 404. */
  readonly fetchPageMeta: (url: string) => Promise<PageMeta | null>;
  /** One model completion for one prompt. */
  readonly complete: (prompt: string) => Promise<DraftCompletion>;
  /**
   * Milliseconds left in the request the drafts are riding on.
   *
   * Required, not optional, because the failure it prevents is the worst one
   * available here: the handler awaits drafts before returning, so a draft
   * that runs past the platform limit does not degrade to a missing draft —
   * it throws away the finished evidence table, which is the actual product.
   * A dependency that can be forgotten is one that will be.
   */
  readonly remainingMs: () => number;
}

/**
 * Time a draft needs before starting one is worth it.
 *
 * Measured: a draft takes 4.5-11 seconds on the deployment this points at.
 * Starting one with less than this left buys a row that cannot finish, at the
 * cost of time the response needs.
 */
const MIN_DRAFT_BUDGET_MS = 12_000;

/**
 * Drafts in flight at once.
 *
 * Not one: five sequential calls at 4.5-11 seconds each is most of the
 * route's budget, which is what this replaced. Not five either: every request
 * on this public tool shares one model deployment, so an unbounded fan-out
 * turns one visitor's report into every concurrent visitor's rate limit, and
 * a burst rejection reads as `model_unavailable` on rows that would have
 * succeeded with a moment's spacing.
 */
export const MAX_CONCURRENT_DRAFTS = 3;

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving order.
 *
 * Written here rather than taken from a dependency: this package is pure and
 * the whole need is fifteen lines.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await worker(item);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

export type DraftFailureReason =
  /** Neither page could be read, so there is nothing to rewrite or copy. */
  | "page_unreadable"
  /** The comparable page has no title or description to model a pattern on. */
  | "no_pattern_to_copy"
  /** The model replied with something that was not the expected JSON shape. */
  | "unparseable"
  /**
   * The reply hit the token ceiling mid-sentence.
   *
   * Separate from `unparseable` on purpose. Both arrive as text that will not
   * parse, but this one is our budget rather than the model's formatting, and
   * saying "the format was unusable" would point whoever reads it at the
   * wrong thing.
   */
  | "truncated"
  | "empty"
  | "too_long"
  /** The model asserted the rewrite would work. See `draft.ts`. */
  | "promises_outcome"
  /**
   * The request ran out of time before this row's draft could be started.
   *
   * Distinct from `model_unavailable`, which blames an endpoint that in this
   * case was never asked. The reads and crawls ahead of the drafts are allowed
   * to be slow, and when they are, the honest answer is that we ran out of
   * room — not that the model was down.
   */
  | "out_of_time"
  /** The model call itself failed. */
  | "model_unavailable";

export interface QuickWinDraft {
  readonly query: string;
  readonly subjectPage: string;
  readonly title: string;
  readonly metaDescription: string;
  /**
   * The page this was modelled on, carried with the draft rather than left in
   * a log. The visitor has to be able to open it and judge for themselves
   * whether the pattern is worth copying — that inspectability is the entire
   * reason drafts were allowed back into v1.
   */
  readonly comparablePage: string;
}

export interface DraftRunResult {
  readonly drafts: readonly QuickWinDraft[];
  readonly failed: ReadonlyMap<string, DraftFailureReason>;
}

/**
 * Produce drafts for the planned tasks.
 *
 * Pages are fetched once each even when several tasks share a comparable, so
 * the request cost is the number of distinct URLs rather than twice the task
 * count.
 *
 * Every failure is per-task and terminal. A task that cannot produce a valid
 * draft produces none — there is no repair pass, no truncation to fit, and no
 * generic fallback. Truncating an over-long reply would ship text the model
 * never wrote and nobody reviewed; a fallback template would ship advice with
 * no source, which is the thing this feature is not.
 */
export async function runDrafts(
  tasks: readonly DraftTask[],
  dependencies: DraftRunDependencies,
): Promise<DraftRunResult> {
  const failed = new Map<string, DraftFailureReason>();
  if (tasks.length === 0) return { drafts: [], failed };

  // Before fetching anything. The crawl runs ahead of the per-task budget gate
  // below, so without this a request with no time left still spends a page
  // fetch on every task's two URLs and only then discovers it cannot use any
  // of them. Nothing downstream could have succeeded, so nothing upstream
  // should be paid for.
  if (dependencies.remainingMs() < MIN_DRAFT_BUDGET_MS) {
    for (const task of tasks) failed.set(task.query, "out_of_time");
    return { drafts: [], failed };
  }

  const urls = new Set<string>();
  for (const task of tasks) {
    urls.add(task.subjectPage);
    urls.add(task.comparablePage);
  }

  const metaByUrl = new Map<string, PageMeta | null>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        metaByUrl.set(url, await dependencies.fetchPageMeta(url));
      } catch {
        // An unreadable page is a skipped row, not a failed run.
        metaByUrl.set(url, null);
      }
    }),
  );

  const drafts: QuickWinDraft[] = [];

  // Concurrent but bounded, because these are the slowest thing in the request
  // and they do not depend on each other. A reasoning model spends 4.5-11
  // seconds on one draft; MAX_DRAFT_ROWS of those in sequence is most of the
  // route's 60-second budget before the evidence table — the actual product —
  // can be returned. Order is preserved, so the drafts still come back
  // largest-shortfall-first.
  const outcomes = await mapWithLimit(
    tasks,
    MAX_CONCURRENT_DRAFTS,
    async (task) => draftOne(task, metaByUrl, dependencies),
  );

  for (const outcome of outcomes) {
    if (outcome.kind === "failed") {
      failed.set(outcome.query, outcome.reason);
      continue;
    }
    drafts.push(outcome.draft);
  }

  return { drafts, failed };
}

type DraftOutcome =
  | { readonly kind: "drafted"; readonly draft: QuickWinDraft }
  | {
      readonly kind: "failed";
      readonly query: string;
      readonly reason: DraftFailureReason;
    };

/**
 * One task, start to finish.
 *
 * Split out of `runDrafts` so the tasks can run concurrently while each still
 * fails on its own: every exit here is one row's outcome, never the run's.
 */
async function draftOne(
  task: DraftTask,
  metaByUrl: ReadonlyMap<string, PageMeta | null>,
  dependencies: DraftRunDependencies,
): Promise<DraftOutcome> {
  const fail = (reason: DraftFailureReason): DraftOutcome => ({
    kind: "failed",
    query: task.query,
    reason,
  });

  const subject = metaByUrl.get(task.subjectPage) ?? null;
  const comparable = metaByUrl.get(task.comparablePage) ?? null;
  if (subject === null || comparable === null) return fail("page_unreadable");

  // Nothing to copy the shape of. Asking the model anyway would make it
  // invent a pattern rather than transfer one.
  //
  // Decided BEFORE the budget gate below. This row was never going to make a
  // model call, so reporting it as "we ran out of time" would replace a
  // standing, actionable fact about the page with an answer that depends on
  // how busy the run happened to be.
  if (comparable.title === null && comparable.metaDescription === null) {
    return fail("no_pattern_to_copy");
  }

  // Checked here rather than once up front: with a bounded fan-out the later
  // tasks start after the earlier ones finish, so the answer changes as the
  // run proceeds. Starting a call we cannot afford to finish spends the
  // response's own headroom on a row that fails anyway.
  if (dependencies.remainingMs() < MIN_DRAFT_BUDGET_MS)
    return fail("out_of_time");

  const prompt = buildDraftPrompt({
    query: task.query,
    bucketId: task.bucketId,
    subject: {
      page: task.subjectPage,
      title: subject.title,
      metaDescription: subject.metaDescription,
      ctr: task.subjectCtr,
    },
    comparable: {
      page: task.comparablePage,
      title: comparable.title,
      metaDescription: comparable.metaDescription,
      ctr: task.comparableCtr,
    },
  });

  let reply: DraftCompletion;
  try {
    reply = await dependencies.complete(prompt);
  } catch {
    return fail("model_unavailable");
  }

  // Checked before the validator, and without looking at the text. A cut-off
  // reply can still happen to parse — the model may have finished the JSON
  // and been cut mid-thought after it — but it is not a draft the model
  // finished, so it does not ship on the strength of a coincidence.
  if (reply.truncated) return fail("truncated");

  const validated = validateDraft(reply.text);
  if (!validated.ok) return fail(validated.reason);

  return {
    kind: "drafted",
    draft: {
      query: task.query,
      subjectPage: task.subjectPage,
      title: validated.title,
      metaDescription: validated.metaDescription,
      comparablePage: task.comparablePage,
    },
  };
}
