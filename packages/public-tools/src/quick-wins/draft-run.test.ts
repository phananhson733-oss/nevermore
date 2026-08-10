import { describe, expect, it, vi } from "vitest";

import { MAX_DRAFT_TITLE_CHARS } from "./draft.ts";
import type { DraftTask } from "./draft-plan.ts";
import { runDrafts } from "./draft-run.ts";

const TASK: DraftTask = {
  query: "lamine yamal zodiac sign",
  bucketId: "8-11",
  subjectPage: "https://x.test/yamal",
  subjectCtr: 0.0009,
  comparablePage: "https://x.test/messi",
  comparableCtr: 0.028,
};

const PAGE_META = {
  "https://x.test/yamal": {
    title: "Lamine Yamal Zodiac Sign",
    metaDescription: "About Lamine Yamal.",
  },
  "https://x.test/messi": {
    title: "Messi's Birth Chart: Full Natal Reading",
    metaDescription: "Every placement explained.",
  },
} as const;

const GOOD_REPLY = JSON.stringify({
  title: "Lamine Yamal's Birth Chart: Sign and Placements",
  metaDescription: "Yamal's full natal chart, each placement explained.",
});

function deps(over: Partial<Parameters<typeof runDrafts>[1]> = {}) {
  return {
    fetchPageMeta: async (url: string) =>
      (PAGE_META as Record<string, { title: string; metaDescription: string }>)[
        url
      ] ?? null,
    complete: async () => ({ text: GOOD_REPLY, truncated: false }),
    ...over,
  };
}

describe("runDrafts", () => {
  it("returns a validated draft with its named source", async () => {
    const result = await runDrafts([TASK], deps());

    expect(result.drafts).toHaveLength(1);
    const draft = result.drafts[0]!;
    expect(draft.query).toBe(TASK.query);
    // The source must travel with the draft; a draft nobody can trace is a
    // generic template.
    expect(draft.comparablePage).toBe(TASK.comparablePage);
    expect(draft.title).toContain("Birth Chart");
  });

  it("fetches each unique page once even across tasks", async () => {
    const fetchPageMeta = vi.fn(
      async (url: string) =>
        (
          PAGE_META as Record<
            string,
            { title: string; metaDescription: string }
          >
        )[url] ?? null,
    );
    const second: DraftTask = { ...TASK, query: "yamal zodiac" };

    await runDrafts([TASK, second], deps({ fetchPageMeta }));

    // Two tasks, two distinct URLs between them.
    expect(fetchPageMeta).toHaveBeenCalledTimes(2);
  });

  it("skips a task whose pages could not be fetched", async () => {
    const result = await runDrafts(
      [TASK],
      deps({ fetchPageMeta: async () => null }),
    );

    expect(result.drafts).toHaveLength(0);
    expect(result.failed.get(TASK.query)).toBe("page_unreadable");
  });

  it("skips a task whose comparable page has no title to copy", async () => {
    const result = await runDrafts(
      [TASK],
      deps({
        fetchPageMeta: async (url: string) =>
          url === TASK.comparablePage
            ? { title: null, metaDescription: null }
            : PAGE_META["https://x.test/yamal"],
      }),
    );

    expect(result.drafts).toHaveLength(0);
    expect(result.failed.get(TASK.query)).toBe("no_pattern_to_copy");
  });

  it("drops a model reply that promises an outcome", async () => {
    // The validator is the gate, and runDrafts must honour it rather than
    // shipping the text anyway.
    const result = await runDrafts(
      [TASK],
      deps({
        complete: async () => ({
          text: JSON.stringify({
            title: "This title will increase your clicks",
            metaDescription: "Guaranteed to rank higher.",
          }),
          truncated: false,
        }),
      }),
    );

    expect(result.drafts).toHaveLength(0);
    expect(result.failed.get(TASK.query)).toBe("promises_outcome");
  });

  it("drops an over-long reply rather than truncating it", async () => {
    // Truncating would produce text the model never wrote and nobody checked.
    const result = await runDrafts(
      [TASK],
      deps({
        complete: async () => ({
          text: JSON.stringify({
            title: "x".repeat(MAX_DRAFT_TITLE_CHARS + 1),
            metaDescription: "fine",
          }),
          truncated: false,
        }),
      }),
    );

    expect(result.drafts).toHaveLength(0);
    expect(result.failed.get(TASK.query)).toBe("too_long");
  });

  it("reports a cut-off reply as truncated, not as bad formatting", async () => {
    // A reply the model was still writing when it hit the token ceiling is
    // half a JSON object. Calling that `unparseable` blames the model's
    // formatting for our own budget, and sends whoever reads the surface
    // looking in the wrong place.
    const result = await runDrafts(
      [TASK],
      deps({
        complete: async () => ({
          text: '{"title":"Lamine Yamal\'s Birth Ch',
          truncated: true,
        }),
      }),
    );

    expect(result.drafts).toHaveLength(0);
    expect(result.failed.get(TASK.query)).toBe("truncated");
  });

  it("trusts the truncation flag even when the cut-off text still parses", async () => {
    // A reply can stop early and still happen to be valid JSON. It is not a
    // draft the model finished, so it does not ship.
    const result = await runDrafts(
      [TASK],
      deps({ complete: async () => ({ text: GOOD_REPLY, truncated: true }) }),
    );

    expect(result.drafts).toHaveLength(0);
    expect(result.failed.get(TASK.query)).toBe("truncated");
  });

  it("survives one task's model call throwing", async () => {
    const second: DraftTask = { ...TASK, query: "second" };
    let call = 0;
    const result = await runDrafts(
      [TASK, second],
      deps({
        complete: async () => {
          call += 1;
          if (call === 1) throw new Error("upstream 500");
          return { text: GOOD_REPLY, truncated: false };
        },
      }),
    );

    expect(result.drafts).toHaveLength(1);
    expect(result.failed.get(TASK.query)).toBe("model_unavailable");
  });

  it("runs the model calls concurrently, not one after another", async () => {
    // These are the slowest thing in the request: a reasoning model spends
    // 5-11 seconds per draft, and MAX_DRAFT_ROWS of those in sequence is most
    // of the route's 60-second budget. They do not depend on each other, so
    // running them in sequence spends the budget for nothing.
    let inFlight = 0;
    let peak = 0;
    const tasks: DraftTask[] = Array.from({ length: 5 }, (_, i) => ({
      ...TASK,
      query: `q${i}`,
    }));

    const result = await runDrafts(
      tasks,
      deps({
        complete: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return { text: GOOD_REPLY, truncated: false };
        },
      }),
    );

    expect(result.drafts).toHaveLength(5);
    expect(peak).toBe(5);
  });

  it("keeps drafts in task order even though the calls race", async () => {
    // The planner hands these over largest-shortfall-first and the surface
    // renders them in the order it receives them. A slow first call must not
    // demote its own row.
    const tasks: DraftTask[] = ["first", "second", "third"].map((query) => ({
      ...TASK,
      query,
    }));
    const delays: Record<string, number> = { first: 20, second: 1, third: 10 };

    const result = await runDrafts(
      tasks,
      deps({
        complete: async (prompt: string) => {
          const query =
            Object.keys(delays).find((q) => prompt.includes(q)) ?? "first";
          await new Promise((resolve) => setTimeout(resolve, delays[query]));
          return { text: GOOD_REPLY, truncated: false };
        },
      }),
    );

    expect(result.drafts.map((d) => d.query)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("isolates one task's failure from the rest when they run together", async () => {
    const tasks: DraftTask[] = ["ok1", "boom", "ok2"].map((query) => ({
      ...TASK,
      query,
    }));

    const result = await runDrafts(
      tasks,
      deps({
        complete: async (prompt: string) => {
          if (prompt.includes("boom")) throw new Error("upstream 500");
          return { text: GOOD_REPLY, truncated: false };
        },
      }),
    );

    expect(result.drafts.map((d) => d.query)).toEqual(["ok1", "ok2"]);
    expect(result.failed.get("boom")).toBe("model_unavailable");
  });

  it("returns empty for no tasks without calling anything", async () => {
    const fetchPageMeta = vi.fn(async () => null);
    const complete = vi.fn(async () => ({
      text: GOOD_REPLY,
      truncated: false,
    }));

    const result = await runDrafts([], { fetchPageMeta, complete });

    expect(result.drafts).toEqual([]);
    expect(fetchPageMeta).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});
