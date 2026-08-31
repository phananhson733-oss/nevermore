// @input -- untrusted Brief load response
// @output -- validated frozen display context, never authority for a generated Brief
// @pos -- client boundary for the Brief input view
export interface FrozenRole { readonly id: string; readonly label: string; readonly segment: string }
export interface FrozenQuestion { readonly id: string; readonly text: string; readonly layer: string; readonly roleId: string | null; readonly role: FrozenRole | null; readonly qualityIssues: readonly string[] | null }
export interface BriefEvidenceSummary {
  readonly snapshotFacts: number;
  readonly contextFacts: number | null;
  readonly usableFacts: number;
  readonly missingFacts: number;
  readonly profileAttached: boolean;
  readonly contextAttached: boolean;
}
export interface FrozenChoice {
  readonly kbId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly host: string;
  readonly frozenAt: string;
  readonly contentHash: string | null;
  readonly promptsetRef: { readonly schema: string; readonly registryVersion: string; readonly hash: string } | null;
  readonly questions: readonly FrozenQuestion[];
  readonly evidenceSummary: BriefEvidenceSummary | null;
  readonly market: { readonly country: string; readonly language: string } | null;
  readonly properNames: readonly string[];
}
export interface BriefInputContext {
  readonly gap: "A" | "D";
  readonly runRef: { readonly id: string; readonly fingerprint: string };
  readonly samples: readonly { readonly id: string; readonly engine: string; readonly status: "answered" | "failed"; readonly collectedAt: string }[];
}
export interface LoadedBriefChoices {
  readonly choices: readonly FrozenChoice[];
  readonly runsPerDay: number;
  readonly providerConfigured: boolean;
  readonly context: BriefInputContext | null;
}
export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const text = (value: unknown): value is string => typeof value === "string";
const hash = (value: unknown): value is string => text(value) && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100;
function parseEvidence(value: unknown): BriefEvidenceSummary | null {
  const row = record(value);
  if (!row || !count(row.snapshotFacts) || !count(row.usableFacts) || !count(row.missingFacts)
    || (row.contextFacts !== null && !count(row.contextFacts)) || typeof row.profileAttached !== "boolean" || typeof row.contextAttached !== "boolean") return null;
  if (row.contextAttached ? row.contextFacts !== row.snapshotFacts : row.contextFacts !== null || row.profileAttached) return null;
  if (row.usableFacts + row.missingFacts < row.snapshotFacts) return null;
  return { snapshotFacts: row.snapshotFacts, contextFacts: row.contextFacts, usableFacts: row.usableFacts,
    missingFacts: row.missingFacts, profileAttached: row.profileAttached, contextAttached: row.contextAttached };
}

function parseContext(value: unknown): BriefInputContext | null {
  const row = record(value); const run = record(row?.runRef);
  if (!row || (row.gap !== "A" && row.gap !== "D") || !run || !text(run.id) || !hash(run.fingerprint) || !Array.isArray(row.samples)) return null;
  const samples: BriefInputContext["samples"][number][] = [];
  for (const value of row.samples) {
    const sample = record(value);
    if (!sample || !text(sample.id) || !text(sample.engine) || !text(sample.collectedAt) || (sample.status !== "answered" && sample.status !== "failed")) return null;
    samples.push({ id: sample.id, engine: sample.engine, status: sample.status, collectedAt: sample.collectedAt });
  }
  return { gap: row.gap, runRef: { id: run.id, fingerprint: run.fingerprint }, samples };
}

export function parseLoadedBriefChoices(value: unknown): LoadedBriefChoices | null {
  const row = record(value);
  if (!row || !Array.isArray(row.choices) || !Number.isSafeInteger(row.runsPerDay) || Number(row.runsPerDay) <= 0 || typeof row.providerConfigured !== "boolean") return null;
  const choices: FrozenChoice[] = [];
  for (const value of row.choices) {
    const choice = record(value);
    if (!choice || !text(choice.kbId) || !text(choice.snapshotId) || !text(choice.host) || !text(choice.frozenAt) || !Number.isSafeInteger(choice.revision) || Number(choice.revision) < 1 || !Array.isArray(choice.questions)) return null;
    // Older deployments omit the display-only additions. Absence is explicit;
    // malformed additions never acquire the appearance of valid frozen data.
    const prompt = choice.promptsetRef === undefined ? null : record(choice.promptsetRef);
    if (choice.contentHash !== undefined && !hash(choice.contentHash)) return null;
    if (choice.promptsetRef !== undefined && (!prompt || !text(prompt.schema) || !text(prompt.registryVersion) || !hash(prompt.hash))) return null;
    const evidenceSummary = choice.evidenceSummary === undefined ? null : parseEvidence(choice.evidenceSummary);
    if (choice.evidenceSummary !== undefined && evidenceSummary === null) return null;
    const market = choice.market === undefined ? null : record(choice.market);
    if (choice.market !== undefined && (!market || !text(market.country) || !text(market.language))) return null;
    const properNames = choice.properNames ?? [];
    if (!Array.isArray(properNames) || properNames.length > 200 || !properNames.every(value => text(value) && value.length <= 500)) return null;
    const questions: FrozenQuestion[] = [];
    for (const value of choice.questions) {
      const q = record(value);
      if (!q || !text(q.id) || !text(q.text) || !text(q.layer) || (q.roleId !== null && !text(q.roleId))) return null;
      const qualityIssues = q.qualityIssues ?? null;
      if (qualityIssues !== null && (!Array.isArray(qualityIssues) || qualityIssues.length > 3 || !qualityIssues.every(text))) return null;
      let role: FrozenRole | null = null;
      if (q.role !== undefined && q.role !== null) {
        const candidate = record(q.role);
        if (!candidate || !text(candidate.id) || candidate.id !== q.roleId || !text(candidate.label) || !text(candidate.segment)) return null;
        role = { id: candidate.id, label: candidate.label, segment: candidate.segment };
      }
      questions.push({ id: q.id, text: q.text, layer: q.layer, roleId: q.roleId, role, qualityIssues });
    }
    choices.push({
      kbId: choice.kbId, snapshotId: choice.snapshotId, revision: Number(choice.revision), host: choice.host, frozenAt: choice.frozenAt,
      contentHash: text(choice.contentHash) ? choice.contentHash : null,
      promptsetRef: prompt ? { schema: String(prompt.schema), registryVersion: String(prompt.registryVersion), hash: String(prompt.hash) } : null,
      questions,
      evidenceSummary, market: market ? { country: String(market.country), language: String(market.language) } : null, properNames,
    });
  }
  const context = row.context === undefined || row.context === null ? null : parseContext(row.context);
  if (row.context != null && context === null) return null;
  return { choices, runsPerDay: Number(row.runsPerDay), providerConfigured: row.providerConfigured, context };
}
