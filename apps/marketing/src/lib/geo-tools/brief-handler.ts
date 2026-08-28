// @input  -- an authenticated POST naming a frozen version and one question
// @output -- one assembled brief, or a typed refusal
// @pos    -- the HTTP shape of the GEO Brief; it decides order, never content

import {
  authenticateAccountRequest,
  privateError,
  privateJson,
  readAccountMutationJson,
} from "../account-websites/route-http.ts";
import { assembleGeoBrief, geoBriefMustAnswerIds } from "./brief-assemble.ts";
import {
  GEO_BRIEF_DAILY_WINDOW_SECONDS,
  GEO_BRIEF_RUNS_PER_DAY,
  geoBriefFacts,
  geoBriefRequiredEntities,
  type GeoBrief,
  type GeoBriefCitedDomain,
  type GeoBriefOrigin,
} from "./brief-contract.ts";
import { runGeoBriefLlm } from "./brief-llm.ts";
import { geoBriefSubtopics } from "./brief-subtopics.ts";
import type { GeoKbPayload } from "./kb-contract.ts";
import type { GeoQuestion, GeoQuestionLayer } from "./kb-questions.ts";
import { normalizeGeoHost } from "../agents/geo-url.ts";

const BODY_LIMIT_BYTES = 8 * 1024;

/** Longest question a visitor may type. Long enough for a real one. */
const MAX_QUESTION_CHARS = 300;

export interface BriefFrozenChoice {
  readonly kbId: string;
  readonly host: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly frozenAt: string;
  readonly questions: readonly {
    readonly id: string;
    readonly text: string;
    readonly layer: GeoQuestionLayer;
    readonly roleId: string | null;
  }[];
}

export type BriefStoreOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface BriefFrozenRead {
  readonly payload: GeoKbPayload;
  readonly snapshotId: string;
  readonly revision: number;
  readonly questions: readonly GeoQuestion[];
}

/** One sampled answer, or a stated reason there is not one. */
export type BriefSampleOutcome =
  | {
      readonly kind: "ok";
      readonly answerText: string;
      readonly citedDomains: readonly GeoBriefCitedDomain[];
    }
  | { readonly kind: "unavailable" };

export interface BriefHandlerDependencies {
  readonly authenticate: typeof authenticateAccountRequest;
  readonly listFrozen: (
    userId: string,
  ) => Promise<BriefStoreOutcome<readonly BriefFrozenChoice[]>>;
  readonly readFrozen: (input: {
    readonly userId: string;
    readonly kbId: string;
    readonly revision: number;
  }) => Promise<BriefStoreOutcome<BriefFrozenRead>>;
  readonly consumeDailyRun: (userId: string) => Promise<boolean>;
  readonly providerConfigured: () => boolean;
  readonly sample: (input: {
    readonly question: string;
    readonly marketCode: string;
    readonly targetHost: string;
    readonly competitors: readonly { readonly domain: string; readonly confirmed: boolean }[];
  }) => Promise<BriefSampleOutcome>;
  readonly assemble: typeof runGeoBriefLlm;
  readonly now: () => number;
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const own = Object.keys(value as Record<string, unknown>);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

export async function handleBriefLoad(
  request: Request,
  dependencies: BriefHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  if (!exactKeys(body.value, [])) return privateError("invalid_request", 400);

  const frozen = await dependencies.listFrozen(auth.userId);
  if (frozen.kind === "unavailable") {
    return privateError("store_unavailable", 503);
  }
  // One shape for both outcomes; an account with nothing frozen is not a
  // different contract from one that has versions.
  return privateJson({
    data: {
      choices: frozen.kind === "not_found" ? [] : frozen.value,
      runsPerDay: GEO_BRIEF_RUNS_PER_DAY,
      providerConfigured: dependencies.providerConfigured(),
    },
  });
}

interface RunRequest {
  readonly kbId: string;
  readonly snapshotId: string;
  readonly questionId: string | null;
  readonly questionText: string;
}

function readRunBody(value: unknown): RunRequest | null {
  if (!exactKeys(value, ["kbId", "snapshotId", "questionId", "questionText"])) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const kbId = row["kbId"];
  const snapshotId = row["snapshotId"];
  const questionId = row["questionId"];
  const questionText = row["questionText"];
  if (typeof kbId !== "string" || typeof snapshotId !== "string") return null;
  if (questionId !== null && typeof questionId !== "string") return null;
  if (typeof questionText !== "string") return null;
  const trimmed = questionText.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUESTION_CHARS) return null;
  // No revision field: it is not accepted from the client at all. The revision
  // is read from the frozen row that (kbId, snapshotId) identifies, so a caller
  // cannot ask for one version's questions against another version's facts.
  return { kbId, snapshotId, questionId, questionText: trimmed };
}

/**
 * Generate one brief.
 *
 * The order is the whole design: authenticate, then prove the frozen version
 * belongs to this account, then prove the question belongs to that version,
 * then check the provider is configured, and only then spend one of the day's
 * runs. Every one of those refusals is free, and each of them would otherwise
 * cost a visitor an allowance for a mistake that never reached the provider.
 */
export async function handleBriefRun(
  request: Request,
  dependencies: BriefHandlerDependencies,
): Promise<Response> {
  try {
    return await runBrief(request, dependencies);
  } catch {
    // A bug here reaches the browser as a 500 with no body, and the page has
    // no sentence for that. One allowance may already have been spent, which
    // the copy for this code says plainly rather than guessing.
    return privateError("internal_error", 500);
  }
}

async function runBrief(
  request: Request,
  dependencies: BriefHandlerDependencies,
): Promise<Response> {
  const auth = await dependencies.authenticate();
  if (!auth.ok) return auth.response;
  const body = await readAccountMutationJson(request, BODY_LIMIT_BYTES);
  if (!body.ok) return body.response;
  const parsed = readRunBody(body.value);
  if (parsed === null) return privateError("invalid_request", 400);

  const choices = await dependencies.listFrozen(auth.userId);
  if (choices.kind === "unavailable") {
    return privateError("store_unavailable", 503);
  }
  const choice =
    choices.kind === "not_found"
      ? undefined
      : choices.value.find(
          (entry) =>
            entry.kbId === parsed.kbId && entry.snapshotId === parsed.snapshotId,
        );
  // Not owned, or not frozen. Both are "there is no such version for you",
  // which is the same answer a version that does not exist gets.
  if (choice === undefined) return privateError("not_found", 404);

  // A picked question must be one this frozen version actually asks. Otherwise
  // the brief would carry a question id that its own question set never had,
  // and the observed counts a caller might attach to it would describe
  // something else entirely.
  const picked =
    parsed.questionId === null
      ? null
      : (choice.questions.find((entry) => entry.id === parsed.questionId) ??
        null);
  if (parsed.questionId !== null && picked === null) {
    return privateError("not_found", 404);
  }

  if (!dependencies.providerConfigured()) {
    return privateError("provider_unconfigured", 503);
  }

  const frozen = await dependencies.readFrozen({
    userId: auth.userId,
    kbId: parsed.kbId,
    revision: choice.revision,
  });
  if (frozen.kind === "unavailable") {
    return privateError("store_unavailable", 503);
  }
  if (frozen.kind === "not_found" || frozen.value.snapshotId !== parsed.snapshotId) {
    return privateError("not_found", 404);
  }

  const allowed = await dependencies.consumeDailyRun(auth.userId);
  if (!allowed) {
    return privateJson(
      {
        error: { code: "daily_limit" },
        limit: GEO_BRIEF_RUNS_PER_DAY,
        windowSeconds: GEO_BRIEF_DAILY_WINDOW_SECONDS,
      },
      429,
    );
  }

  const payload = frozen.value.payload;
  const layer: GeoQuestionLayer = picked?.layer ?? "discovery";
  const roleId = picked?.roleId ?? null;
  // The frozen wording wins whenever a frozen question was picked. The client
  // sends the text too - it is what the visitor saw - but accepting it would
  // let a brief record a frozen question's id beside words that question never
  // asked, and any observed counts later attached to that id would describe
  // something else. Only a typed question uses the client's text, and that one
  // has no id to disagree with.
  const questionText = picked?.text ?? parsed.questionText;

  // `normalizeGeoHost`, not `new URL(...).host`. The citation side canonicalizes
  // through that function - lowercase, no leading `www.`, no port - and the two
  // spellings are not equal. Written the other way here first, which is the
  // third time this repo has produced that mismatch; it is now the only way
  // this file derives a host.
  const targetHost = normalizeGeoHost(payload.targetUrl) ?? "";

  const sampled = await dependencies.sample({
    question: questionText,
    marketCode: payload.market.country,
    targetHost,
    competitors: payload.competitors.map((entry) => ({
      domain: entry.domain,
      confirmed: entry.confirmed,
    })),
  });

  const subtopics =
    sampled.kind === "ok" ? geoBriefSubtopics(sampled.answerText) : [];
  const ids = geoBriefMustAnswerIds(subtopics.length);

  const reply = await dependencies.assemble({
    questionText,
    officialName: payload.officialName,
    categoryTerms: payload.categoryTerms,
    requiredEntities: geoBriefRequiredEntities(payload, layer, roleId),
    subtopics: subtopics.map((text, index) => ({
      id: ids[index] ?? `Q${index + 1}`,
      text,
    })),
    facts: geoBriefFacts(payload.facts),
    language: payload.market.language,
  });

  const origin: GeoBriefOrigin = {
    kbId: parsed.kbId,
    snapshotId: parsed.snapshotId,
    revision: frozen.value.revision,
    questionId: picked?.id ?? null,
    questionText,
    layer,
    roleId,
  };

  const brief: GeoBrief = assembleGeoBrief({
    payload,
    origin,
    sampledSubtopics: subtopics,
    citedDomains: sampled.kind === "ok" ? sampled.citedDomains : [],
    reply: reply.ok ? reply.value : null,
    generatedAt: new Date(dependencies.now()).toISOString(),
  });

  return privateJson({ data: { brief } });
}
