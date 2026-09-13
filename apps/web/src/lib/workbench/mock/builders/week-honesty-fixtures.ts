/**
 * Test-only: what the weekly report must never say, as a checker that returns
 * violations as strings (the `hostile-fixtures.ts` shape). Not a `*.test.ts`
 * file so two suites can share it: the builder test holds `week.ts`'s own
 * output to it, and the week view test holds the text that actually reaches
 * the basket to the same list.
 *
 * A required substring proves a sentence is present. It cannot prove the
 * report is not ALSO saying something false, so this is a blacklist:
 *
 * - result and repair claims (Q16): the store holds reports, history and
 *   artifacts, and nothing in it shows a repair ever ran;
 * - promises, superlatives and unmeasured causes (jsx W8-W10);
 * - "last week" framing (Q20): the previous run may be a day or months old;
 * - rank movement in any spelling (Q17): the store keeps no keyword history,
 *   so any number moving from one position to another is invented;
 * - "nothing to do" (codex S7b #2): with a count unknown the report cannot know
 *   that, and with repair tasks in the basket it would contradict them.
 *
 * `PROVENANCE_HEADS` is the opening words of the two localised declarations
 * (`workbench.provenance.artifact`). The builder must contain neither: the
 * declaration is folded in once, by `useAddArtifact` (Q23), and a builder that
 * states it too makes two.
 */

export const WEEK_FORBIDDEN_PHRASES: readonly string[] = [
  // results and repairs
  "实测",
  "已修复",
  "修复了",
  "修掉",
  "修好",
  "已解决",
  "解决了",
  "已处理",
  // promises, superlatives, unmeasured causes
  "进前十",
  "前十",
  "首页",
  "被引用率最高",
  "引用率",
  "保证",
  "一定能",
  "必然",
  "通常就能",
  "最容易",
  "被问最多",
  "因为",
  "由于",
  "导致",
  "所以",
  // the previous run is not "last week"
  "上周",
  // an unknown count is not "nothing to do"
  "暂无待办",
  "没有待办",
  // rank movement vocabulary
  "排名变动",
  "排名变化",
  "排名上升",
  "排名下降",
  "名次",
  "上升",
  "下降",
  "提升",
  "下滑",
  // the same claims in English, should a line ever be written in it
  "guarantee",
  "fixed",
  "top 10",
  "page one",
  "moved up",
  "moved down",
];

/**
 * Rank movement written with numbers. Deliberately not matched: a date range
 * (`2026-09-06 至 2026-09-13`), the `排名 >10 且 ≤30` band (no sign in it), and a score or share delta (`+7`, `+6pt`), which carry no 名/位.
 */
export const WEEK_RANK_MOVEMENT: readonly RegExp[] = [
  /\d(?:\.\d+)?\s*(?:→|->|=>|⇒|➜|➔|⟶)\s*(?:第\s*)?\d/u,
  /从\s*(?:第\s*)?\d+(?:\.\d+)?\s*名?\s*(?:升|降|掉|涨|跌|进|到|变|提)/u,
  /(?<!\d)[+\-−±]\s*\d+(?:\.\d+)?\s*(?:名|位)/u,
  /(?:升|降|涨|跌|掉|爬)(?:到|至|了|入)\s*(?:第\s*)?\d/u,
  /rank(?:ed|ing)?\s+(?:from\s+)?#?\d/iu,
];

export const PROVENANCE_HEADS: readonly string[] = ["示例数据", "Sample data"];

/** Every forbidden phrase and rank-movement pattern the text contains, named. */
export function honestyViolations(text: string): readonly string[] {
  const lower = text.toLowerCase();
  const phrases = WEEK_FORBIDDEN_PHRASES.filter((phrase) =>
    lower.includes(phrase.toLowerCase()),
  ).map((phrase) => `says "${phrase}"`);
  const movements = WEEK_RANK_MOVEMENT.filter((pattern) =>
    pattern.test(text),
  ).map((pattern) => `rank movement ${String(pattern)}`);
  return [...phrases, ...movements];
}

/** How many provenance declarations the text carries, in either locale. */
export function provenanceDeclarationCount(text: string): number {
  return PROVENANCE_HEADS.reduce(
    (total, head) => total + text.split(head).length - 1,
    0,
  );
}
