/**
 * Fact knowledge base seeding (jsx:2084-2097, R8/R10). Every entry says where
 * it came from. `manual` only marks statements built from a profile field that
 * contain its raw value; `gap` is an empty slot; `aiDraft` is a fact from the
 * profile document's AI section. Nothing here was crawled, so nothing is
 * `crawl`, and a sample fill passes its own `from` through unchanged.
 */
import type { KbCategory, KbEntry, KnowledgeBase, Profile, ProfileDoc } from "../types.ts";
import { brandOrPlaceholder } from "./brand.ts";
import { competitorNames, splitList } from "./text.ts";

export const KB_PROFILE_EVIDENCE = "来自站点档案字段";
const COMPARISON_GAP_LIMIT = 3;
/** Wording the sample content uses for unfinished statements (`demoAiDoc` facts, demo KB fills). */
const PENDING_MARKER = /待补|需补/u;

type KbDraft = Omit<KbEntry, "id">;
type KbPatch = Pick<KbEntry, "statement" | "evidence" | "source" | "from">;

function isBlank(text: string): boolean {
  return text.trim() === "";
}

function kbId(index: number): string {
  return `kb-${String(index + 1).padStart(2, "0")}`;
}

function gapDraft(cat: KbCategory): KbDraft {
  return { cat, statement: "", evidence: "", source: "", from: "gap" };
}

function profileDraft(cat: KbCategory, statement: string): KbDraft {
  return { cat, statement, evidence: KB_PROFILE_EVIDENCE, source: "", from: "manual" };
}

function aiDraft(statement: string): KbDraft {
  return { cat: "data", statement, evidence: "", source: "", from: "aiDraft" };
}

/** Competitors the user named, deduped by `normQ`; the R9 placeholders never open a comparison slot. */
function namedCompetitors(profile: Pick<Profile, "competitors">): readonly string[] {
  return splitList(profile.competitors).length === 0 ? [] : competitorNames(profile);
}

/** Ids `kb-01`, `kb-02`, … in order: definition, capabilities, boundary, pricing, comparisons, data. */
export function seedKb(
  profile: Pick<Profile, "brand" | "positioning" | "features" | "competitors">,
  doc: ProfileDoc | null,
): readonly KbEntry[] {
  const brand = brandOrPlaceholder(profile.brand);
  const drafts: readonly KbDraft[] = [
    isBlank(profile.positioning)
      ? gapDraft("definition")
      : profileDraft("definition", `${brand} 是${profile.positioning}`),
    ...splitList(profile.features).map((feature) => profileDraft("capability", `${brand} 提供 ${feature}`)),
    gapDraft("boundary"),
    gapDraft("pricing"),
    ...namedCompetitors(profile).slice(0, COMPARISON_GAP_LIMIT).map(() => gapDraft("comparison")),
    ...(doc?.ai.facts ?? []).filter((fact) => !isBlank(fact)).map(aiDraft),
  ];
  return drafts.map((draft, index) => ({ id: kbId(index), ...draft }));
}

/** Field by field, so extra keys on a patch never reach the strict persisted schema. */
function entryOf(id: string, cat: KbCategory, patch: KbPatch): KbEntry {
  return { id, cat, statement: patch.statement, evidence: patch.evidence, source: patch.source, from: patch.from };
}

/**
 * Fills the first blank entry of `category`, whatever its origin (keeping its
 * id), or appends `newId` when there is none. A pending placeholder is not
 * blank, so it is never overwritten. Never mutates.
 */
export function fillFirstKbGap(
  entries: readonly KbEntry[],
  category: KbCategory,
  patch: KbPatch,
  newId: string,
): readonly KbEntry[] {
  const index = entries.findIndex((entry) => entry.cat === category && isBlank(entry.statement));
  if (index < 0) return [...entries, entryOf(newId, category, patch)];
  return entries.map((entry, at) => (at === index ? entryOf(entry.id, entry.cat, patch) : entry));
}

/** Blank statements and pending placeholders (待补 / 需补) are both still gaps. */
function isGap(entry: KbEntry): boolean {
  return isBlank(entry.statement) || PENDING_MARKER.test(entry.statement);
}

/** Entries still to be written; `null` when there is no knowledge base yet. */
export function kbGapCount(kb: KnowledgeBase | null): number | null {
  return kb === null ? null : kb.entries.filter(isGap).length;
}
