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

export interface DraftRunDependencies {
  /** Returns null when the page could not be read. Never throws for a 404. */
  readonly fetchPageMeta: (url: string) => Promise<PageMeta | null>;
  /** One model completion for one prompt. */
  readonly complete: (prompt: string) => Promise<string>;
}

export type DraftFailureReason =
  /** Neither page could be read, so there is nothing to rewrite or copy. */
  | "page_unreadable"
  /** The comparable page has no title or description to model a pattern on. */
  | "no_pattern_to_copy"
  /** The model replied with something that was not the expected JSON shape. */
  | "unparseable"
  | "empty"
  | "too_long"
  /** The model asserted the rewrite would work. See `draft.ts`. */
  | "promises_outcome"
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

  for (const task of tasks) {
    const subject = metaByUrl.get(task.subjectPage) ?? null;
    const comparable = metaByUrl.get(task.comparablePage) ?? null;
    if (subject === null || comparable === null) {
      failed.set(task.query, "page_unreadable");
      continue;
    }
    // Nothing to copy the shape of. Asking the model anyway would make it
    // invent a pattern rather than transfer one.
    if (comparable.title === null && comparable.metaDescription === null) {
      failed.set(task.query, "no_pattern_to_copy");
      continue;
    }

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

    let reply: string;
    try {
      reply = await dependencies.complete(prompt);
    } catch {
      failed.set(task.query, "model_unavailable");
      continue;
    }

    const validated = validateDraft(reply);
    if (!validated.ok) {
      failed.set(task.query, validated.reason);
      continue;
    }

    drafts.push({
      query: task.query,
      subjectPage: task.subjectPage,
      title: validated.title,
      metaDescription: validated.metaDescription,
      comparablePage: task.comparablePage,
    });
  }

  return { drafts, failed };
}
