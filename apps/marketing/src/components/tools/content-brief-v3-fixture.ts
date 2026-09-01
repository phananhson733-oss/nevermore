// @input -- deterministic historical test evidence
// @output -- a real strictly parsed confirmed v3 document for consumer regressions
// @pos -- test-only fixture; never a provider or production result
import { buildSerpObservations } from "@sf/public-tools/content-brief/assemble";
import { confirmBriefV2, fingerprintBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { CONTENT_BRIEF_V3_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";
import { confirmedDraftV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import type { ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";

export async function confirmedDraftV3Fixture() {
  const original = await confirmedDraftV2Fixture();
  const pages = original.brief.context.research.pages.filter(page => page.role === "competitor");
  const rows = buildSerpObservations(pages.map(page => ({ rank: Number(page.id.slice(1)), url: page.url, domain: new URL(page.url).hostname, title: "How to understand reporting delays" })));
  const input: ContentBriefV2 = {
    ...original.brief, schema: CONTENT_BRIEF_V3_SCHEMA,
    context: { ...original.brief.context, serp: { rows, read: { status: "partial", requested: 10, returned: rows.length, unresolved: 0 } } },
    run: { ...original.brief.run, reads: original.brief.run.reads.map(read => read.source === "serp" ? { ...read, status: "partial", attempted: 10, retained: rows.length, reason: null } : read) },
  };
  const brief = { ...input, run: { ...input.run, fingerprint: await fingerprintBriefV2(input) } };
  const result = await confirmBriefV2(brief, { outline: original.outline, revision: original.revision, confirmed_at: original.confirmed_at, resolution: original.resolution });
  if (!result.ok) throw new Error(`v3 fixture: ${result.path}`);
  return result.value;
}
