// @input -- explicit synthetic browser-case choices, never customer/provider evidence
// @output -- deterministic Brief/confirmed fixtures for API-isolated browser acceptance
// @pos -- E2E-only fixture construction; no network, persistence or production claims
import { validContentBriefV2, type FixtureOptions } from "../src/components/tools/content-brief-v2-fixture.ts";
import { confirmedDraftV2Fixture, draftResultV2Fixture, type ConfirmedDraftV2FixtureOptions } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import { buildSerpObservations } from "@sf/public-tools/content-brief/assemble";
import { confirmBriefV2, fingerprintBriefV2, parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { CONTENT_BRIEF_V3_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";
import { buildResearchBundle, validateResearchOutput } from "@sf/public-tools/content-brief/v2-research";
import type { ConfirmedBriefV2, ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import { buildDraftV2SectionScope } from "@sf/public-tools/content-brief/v2-draft-scope";
import { validateDraftV2Section } from "@sf/public-tools/content-brief/v2-draft-section";

/** Synthetic observations are explicit test input, never inferred from a legacy user import. */
async function addSyntheticSerp(brief: ContentBriefV2): Promise<ContentBriefV2> {
  const titles = ["How to interpret reporting delays", "10 best reporting checks", "Report A vs Report B", "Reporting toolkit", "Reporting overview", "Reporting timeline", "Reporting examples", "How to verify reporting", "Unclassified listing", null];
  const rows = buildSerpObservations(titles.map((title, index) => {
    const page = brief.context.research.pages.find((item) => item.id === `C${index + 1}`);
    const url = page?.url ?? (index === 8 ? "javascript:fixtureOnly()" : index === 9 ? null : `https://serp-${index + 1}.example/${index === 3 ? "tools/reporting" : "reporting"}`);
    return { rank: index + 1, url, domain: page ? new URL(page.url).hostname : `serp-${index + 1}.example`, title };
  }));
  const candidate: ContentBriefV2 = {
    ...brief, schema: CONTENT_BRIEF_V3_SCHEMA,
    context: { ...brief.context, serp: { rows, read: { status: "complete", requested: 10, returned: 10, unresolved: 0 } } },
    run: { ...brief.run, reads: brief.run.reads.map((read) => read.source === "serp" ? { source: "serp", status: "complete", attempted: 10, retained: 10, reason: null } : read) },
  };
  const sealed = { ...candidate, run: { ...candidate.run, fingerprint: await fingerprintBriefV2(candidate) } };
  const parsed = await parseContentBriefV2(sealed);
  if (!parsed.ok) throw new Error(`Invalid synthetic v3 receipt: ${parsed.path}`);
  return parsed.value;
}

function addThirdChapter(brief: ContentBriefV2): ContentBriefV2 {
  const generated = brief.generated;
  if (generated === null) throw new Error("A chapter fixture requires a generated plan");
  const research = buildResearchBundle(brief.context.research.pages, [...brief.context.research.paa,
    { id: "A3", question: "What should I verify before publishing a report?", seed_question: null },
  ]);
  if (!research.ok) throw new Error(research.path);
  const anchor = research.value.units.find((unit) => unit.kind === "paa" && unit.paa_ref === "A3")!.id;
  const anchors = new Map(generated.research.questions.map((question) => [question.id, question.anchor]));
  const result = validateResearchOutput({
    questions: [...generated.research.questions.map((question) => ({ anchor: question.anchor, q: question.q, sources: question.source_refs })),
      { anchor, q: "What should I verify before publishing a report?", sources: [anchor] }],
    outline: [...generated.research.outline.map((section) => ({ h2: section.h2, h3: section.h3, answers: section.answers.map((id) => anchors.get(id)!) })),
      { h2: "Verify the reporting checklist", h3: ["Publication checks"], answers: [anchor] }],
  }, research.value);
  if (!result.ok) throw new Error(result.path);
  return { ...brief, context: { ...brief.context, research: research.value }, generated: { ...generated, research: result.value },
    run: { ...brief.run, reads: brief.run.reads.map((read) => read.source === "paa" ? { ...read, attempted: 3, retained: 3 } : read) } };
}

export async function createBriefV3Fixture(options: FixtureOptions = {}) {
  return addSyntheticSerp(await validContentBriefV2(options));
}

export async function createConfirmedBriefV3Fixture(options: ConfirmedDraftV2FixtureOptions & { readonly chapters?: 3 } = {}) {
  const previous = await confirmedDraftV2Fixture(options);
  const brief = await addSyntheticSerp(options.chapters === 3 ? addThirdChapter(previous.brief) : previous.brief);
  const outline = options.chapters === 3 ? options.reverse ? [...brief.generated!.research.outline].reverse() : brief.generated!.research.outline : previous.outline;
  const confirmed = await confirmBriefV2(brief, { outline, revision: previous.revision, confirmed_at: previous.confirmed_at, resolution: previous.resolution });
  if (!confirmed.ok) throw new Error(`Invalid synthetic v3 confirmation: ${confirmed.path}`);
  return confirmed.value;
}

export async function createCoverageGapDraftFixture(confirmed: ConfirmedBriefV2, settings: DraftV2Settings) {
  const base = await draftResultV2Fixture(confirmed, { settings });
  if (base.sections.length !== 3) throw new Error("The editorial coverage fixture requires three chapters");
  const sections = base.sections.map((section, index) => {
    if (section.status !== "ok" || index > 1) return section;
    const scope = buildDraftV2SectionScope(confirmed, section.id, settings);
    if (!scope.ok) throw new Error(scope.path);
    const ref = index === 0 ? "U1" : "P1";
    const text = index === 0 ? "Reporting can lag behind collection." : "Compares finalized reporting periods";
    const body = validateDraftV2Section({ paragraphs: section.body.paragraphs.map((paragraph) => ({
      heading: paragraph.heading, sentences: [{ text, claim: "bound", evidence_refs: [ref] }],
    })) }, scope.value, confirmed.brief.context.input.language);
    if (!body.ok) throw new Error(body.path);
    return { ...section, body: body.value };
  });
  const questions = confirmed.brief.generated!.research.questions;
  return draftResultV2Fixture(confirmed, { settings, sections, coverage: {
    items: [
      { question_id: questions[0]!.id, status: "covered", covered_in: "O1", gap: null },
      { question_id: questions[1]!.id, status: "partial", covered_in: "O2", gap: "Explain how finalized dates are compared." },
      { question_id: questions[2]!.id, status: "none", covered_in: null, gap: "The publishing checklist is not answered yet." },
    ],
    reads: { status: "complete", calls: 1, model_id: "offline-browser-coverage", temperature_requested: 0, temperature_effective: null, input_tokens: 80, output_tokens: 20 },
  } });
}
