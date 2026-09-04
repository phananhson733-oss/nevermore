// @input  -- one projected issue plus the provenance of the run it came from
// @output -- bounded plain-text handoff for a single issue, in the reader's locale
// @pos    -- pure text builder; reads no session, storage, or network state

import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditLocalizedText } from "@sf/public-tools/agent-audit";

import type { AgentIssue } from "./agent-issue-model";

/**
 * Longest observation value copied verbatim.
 *
 * Observation values hold page content — a title, a heading, a link target. A
 * bound keeps the handoff reviewable and stops an unexpectedly large value from
 * turning a prompt into a document dump.
 */
export const AGENT_ISSUE_VALUE_CHAR_LIMIT = 160;

type PromptLocale = "en" | "zh";

export interface AgentIssuePromptRun {
  readonly completedAt: string;
  readonly sourceTool: string;
  readonly schemaVersion: string;
}

export interface BuildAgentIssuePromptInput {
  readonly issue: AgentIssue;
  readonly locale: string;
  readonly run: AgentIssuePromptRun;
  /** The page this run was about, when one page was the subject. */
  readonly targetUrl?: string;
}

const LABELS = {
  zh: {
    repairIntro:
      "以下是一次 SEO 审计中的单个问题。请只处理这一个问题，不要推断其他页面或其他检查项的状态。",
    investigationIntro:
      "以下是一次 SEO 审计中未能取得数据的单个检查项。本次运行未取得该来源的数据，因此没有得出任何结论。请只梳理确认证据所需的调查顺序，不要提出或执行修复。",
    check: "检查项",
    severity: "严重度",
    rule: "判定规则",
    measured: "本次测量",
    affected: "受影响 URL",
    affectedSite: "影响范围：站点级，本次观测未定位到具体 URL",
    affectedSiteCount: (count: number) => `记录的受影响数为 ${count}`,
    affectedMore: (shown: number, total: number, rest: number) =>
      `以上为 ${total} 个受影响 URL 中的前 ${shown} 个，另有 ${rest} 个未列出`,
    evidence: "证据",
    evidenceRecord: "记录",
    evidenceTested: "已测",
    evidenceAffected: "命中",
    limitation: "证据限制",
    boundary: "证据边界",
    repairTask: "任务",
    repairSteps: "参考修复方向",
    investigationTask: "调查任务",
    requiredSource: "需要的数据来源",
    notCaptured:
      "本次运行没有记录到可归属于该问题的具体目标。这是证据缺失，不是「受影响 0 个」。",
    affectedNotEnumerated:
      "注意：受影响总数来自记录的统计口径，上面列出的观测条目少于该总数，因此列表不是完整枚举。",
    valuesOmitted: (rest: number) => `（另有 ${rest} 项观测值未列出）`,
    unavailableNote:
      "该检查项的受影响范围本次不可得。不可得不等于 0，请不要把它当作「没有问题」。",
    rules: [
      "只针对上面列出的这一个问题作答。",
      "不要假设本产品的框架、目录结构或文件路径；先要求我确认真实的实现位置。",
      "如果上面的证据不足以判断，请直接说明还缺什么，不要猜测。",
    ],
    investigationRules: [
      "不要声称该问题已经存在或已经排除——本次运行没有得出结论。",
      "先列出确认该结论所需的证据与获取顺序，再说明每一步能排除什么。",
      "不要假设本产品的框架、目录结构或文件路径。",
    ],
    provenance: "来源",
    provenanceLine: (run: AgentIssuePromptRun) =>
      `${run.sourceTool} · ${run.schemaVersion} · 观测时间 ${run.completedAt}`,
    target: "本次目标",
    severities: {
      blocker: "阻断",
      warning: "警告",
      suggestion: "建议",
    },
  },
  en: {
    repairIntro:
      "Below is a single issue from one SEO audit. Work on this issue only; do not infer the state of any other page or check.",
    investigationIntro:
      "Below is a single check from an SEO audit that could not be answered. This run obtained no data from that source and therefore reached no conclusion. Map out the investigation needed to establish the evidence; do not propose or apply a repair.",
    check: "Check",
    severity: "Severity",
    rule: "Decision rule",
    measured: "Measured this run",
    affected: "Affected URLs",
    affectedSite:
      "Scope: site level. This observation resolved to no individual URL.",
    affectedSiteCount: (count: number) => `The record\u2019s affected count is ${count}`,
    affectedMore: (shown: number, total: number, rest: number) =>
      `Listed ${shown} of ${total} affected URLs; ${rest} more not listed`,
    evidence: "Evidence",
    evidenceRecord: "record",
    evidenceTested: "tested",
    evidenceAffected: "affected",
    limitation: "Evidence limitation",
    boundary: "Evidence boundary",
    repairTask: "Task",
    repairSteps: "Suggested direction",
    investigationTask: "Investigation task",
    requiredSource: "Data source required",
    notCaptured:
      "This run kept no observation attributable to this issue. That is missing evidence, not an affected population of zero.",
    affectedNotEnumerated:
      "Note: the affected total comes from the record\u2019s own count and the listed observations are fewer, so the list is not a complete enumeration.",
    valuesOmitted: (rest: number) =>
      `(${rest} further observation values not listed)`,
    unavailableNote:
      "The affected population is unavailable for this check. Unavailable is not zero; do not read it as 'no problem'.",
    rules: [
      "Answer only for the single issue above.",
      "Do not assume this product's framework, directory layout, or file paths; ask me to confirm the real implementation location first.",
      "If the evidence above is not enough to decide, say what is missing rather than guessing.",
    ],
    investigationRules: [
      "Do not claim the issue is present or ruled out — this run reached no conclusion.",
      "List the evidence needed and the order to obtain it, then say what each step rules out.",
      "Do not assume this product's framework, directory layout, or file paths.",
    ],
    provenance: "Source",
    provenanceLine: (run: AgentIssuePromptRun) =>
      `${run.sourceTool} · ${run.schemaVersion} · observed ${run.completedAt}`,
    target: "Run target",
    severities: {
      blocker: "Blocker",
      warning: "Warning",
      suggestion: "Suggestion",
    },
  },
} as const;

function promptLocale(locale: string): PromptLocale {
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function text(value: AgentAuditLocalizedText, locale: PromptLocale): string {
  return value[locale];
}

/** Most observation values one record contributes before the rest are counted. */
const VALUES_PER_RECORD = 6;

export const REDACTED = "[redacted]";

/**
 * Parameter names whose value is a secret.
 *
 * Matched on name segments, not as substrings: an SEO audit's most important
 * query parameter is `keyword`, and a substring rule redacts it for containing
 * "key" — corrupting the very evidence this handoff exists to carry. Splitting
 * the name on separators keeps `keyword`, `design`, and `monkey` intact while
 * still catching `api_key`, `x-auth-token`, and `reset.code`.
 */
const SECRET_NAMES: ReadonlySet<string> = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "signature",
  "sig",
  "auth",
  "key",
  "apikey",
  "credential",
  "credentials",
  "session",
  "sessionid",
  "phpsessid",
  "jsessionid",
  "sid",
  "jwt",
  "bearer",
  "code",
  "state",
  "otp",
  "ticket",
  "access",
  "refresh",
  "nonce",
]);

function isSecretName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (SECRET_NAMES.has(normalized.replaceAll(/[^a-z]/g, ""))) return true;
  return normalized
    .split(/[^a-z0-9]+/)
    .some((segment) => SECRET_NAMES.has(segment));
}

/**
 * A path segment long and dense enough to be a credential rather than a slug.
 *
 * Reset links, invite links, and share links carry their secret in the path,
 * where no parameter name announces it. A readable slug ("birth-chart-
 * calculator") has separators and vowels; a token does not.
 *
 * Rejecting anything that merely contains a separator let the two commonest
 * shapes straight through: a JWT is three base64url runs joined by dots, and
 * base64url reset tokens routinely carry `-` and `_`. Both read as slugs and
 * were copied into a prompt bound for a third-party assistant. Three tests
 * replace that one, each naming a shape a slug does not have.
 */
const DENSE_RUN = 20;

function looksLikeSecretSegment(segment: string): boolean {
  if (segment.length < 24 || !/^[A-Za-z0-9._~-]+$/.test(segment)) return false;

  // A JWT: header.payload.signature, each of them base64url.
  const dotted = segment.split(".");
  if (
    dotted.length === 3 &&
    dotted.every((part) => /^[A-Za-z0-9_-]{8,}$/.test(part))
  ) {
    return true;
  }

  // One long unbroken run carrying digits. Length alone would catch a long
  // unhyphenated word ("understandingyourbirthchart"); a token has digits in
  // it and a written word does not.
  const runs = segment.split(/[-_.~]+/).filter(Boolean);
  if (
    runs.some(
      (run) => run.length >= DENSE_RUN && /^(?=.*[0-9])[A-Za-z0-9]+$/.test(run),
    )
  ) {
    return true;
  }

  // Mixed case and digits across the whole segment: base64url and hex tokens
  // read this way whatever their separators, and a URL slug is lowercase.
  return (
    /[a-z]/.test(segment) && /[A-Z]/.test(segment) && /[0-9]/.test(segment)
  );
}

/** Redact the `k=v` pairs of a fragment, which URL does not parse as a query. */
function redactFragment(hash: string): string {
  const body = hash.slice(1);
  if (body === "" || !body.includes("=")) return hash;
  const redacted = new URLSearchParams(body);
  let touched = false;
  for (const key of [...redacted.keys()]) {
    if (isSecretName(key)) {
      redacted.set(key, REDACTED);
      touched = true;
    }
  }
  return touched ? `#${decodeParams(redacted)}` : hash;
}

/** Serialize without percent-encoding the placeholder into unreadability. */
function decodeParams(params: URLSearchParams): string {
  return params.toString().replaceAll(encodeURIComponent(REDACTED), REDACTED);
}

function redactAbsolute(parsed: URL): string {
  parsed.username = "";
  parsed.password = "";

  for (const key of [...parsed.searchParams.keys()]) {
    if (isSecretName(key)) {
      parsed.searchParams.set(key, REDACTED);
      continue;
    }
    // A benign name can still carry a whole credential-bearing URL —
    // `?next=https%3A%2F%2Fidp%2F%3Ftoken%3D...` is a mainstream pattern.
    const value = parsed.searchParams.get(key);
    if (value !== null && /^https?:\/\//i.test(value)) {
      parsed.searchParams.set(key, redactUrl(value));
    }
  }

  parsed.pathname = parsed.pathname
    .split("/")
    .map((segment) => (looksLikeSecretSegment(segment) ? REDACTED : segment))
    .join("/");

  const query =
    parsed.search === "" ? "" : `?${decodeParams(parsed.searchParams)}`;
  return `${parsed.origin}${parsed.pathname}${query}${redactFragment(parsed.hash)}`;
}

/**
 * A URL safe to hand to a third party.
 *
 * Collected URLs are not guaranteed clean: a crawl can surface a link carrying
 * userinfo, a session token in its query, an OAuth token in its fragment, or a
 * reset secret in its path. The handoff must not export any of those even
 * though they came from the site's own HTML.
 *
 * Three shapes have to be handled because all three actually reach here: a
 * submitted target may be scheme-less (the audit accepts `example.com/...`),
 * an observation value may be a whitespace-joined list of URLs, and a value may
 * not be a URL at all.
 */
export function redactUrl(value: string): string {
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) {
    return trimmed
      .split(/(\s+)/)
      .map((part) => (/\S/.test(part) ? redactUrl(part) : part))
      .join("");
  }

  try {
    return redactAbsolute(new URL(trimmed));
  } catch {
    // Not absolute. The audit accepts scheme-less input, so retry as https
    // before giving up; a bare path is still worth redacting.
    try {
      // A bare path needs a placeholder host to parse; strip the host back out
      // afterwards so the value reads as it did on the page.
      const rooted = trimmed.startsWith("/");
      const viaHttps = redactAbsolute(
        new URL(
          `https://${rooted ? "placeholder.invalid" : ""}${rooted ? trimmed : `/${trimmed}`}`,
        ),
      );
      const withoutHost = viaHttps.replace(
        /^https:\/\/(?:placeholder\.invalid)?/,
        "",
      );
      return rooted ? withoutHost : withoutHost.replace(/^\//, "");
    } catch {
      return trimmed;
    }
  }
}

/**
 * Keep a value reviewable, and say when it was cut rather than cutting
 * silently. Markup is reported by shape instead of quoted: an observation may
 * hold a fragment of the page, and pasting response markup into a prompt is
 * outside what this handoff carries.
 */
function boundedValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const raw = String(value);
  if (/<[a-z!/][^>]*>/i.test(raw)) {
    return `[markup omitted, ${raw.length} chars]`;
  }
  // Anything that could carry a credential in URL shape goes through the
  // redactor, not just values that happen to start with a scheme: relative
  // paths, protocol-relative URLs, and whitespace-joined lists all reach here.
  const safe = /[?#/]|^\S+\.\S+/.test(raw) ? redactUrl(raw) : raw;
  if (safe.length <= AGENT_ISSUE_VALUE_CHAR_LIMIT) return safe;
  return `${safe.slice(0, AGENT_ISSUE_VALUE_CHAR_LIMIT)}…`;
}

function evidenceLines(
  records: readonly SeoAuditRecord[],
  locale: PromptLocale,
): readonly string[] {
  const labels = LABELS[locale];
  return records.flatMap((record) => {
    const head = `- ${labels.evidenceRecord} ${record.id} · ${labels.evidenceTested} ${record.tested} · ${labels.evidenceAffected} ${record.affected}`;
    const all = record.observations.flatMap(
      (observation) => observation.values,
    );
    const values = all
      .slice(0, VALUES_PER_RECORD)
      .map((entry) => `    ${entry.label}: ${boundedValue(entry.value)}`);
    // A bounded list that does not say it is bounded reads as the whole set.
    const omitted =
      all.length > VALUES_PER_RECORD
        ? [`    ${labels.valuesOmitted(all.length - VALUES_PER_RECORD)}`]
        : [];
    const limitation =
      record.limitation === null
        ? []
        : [`    ${labels.limitation}: ${record.limitation}`];
    return [head, ...values, ...omitted, ...limitation];
  });
}

/**
 * Build the text one issue hands to an assistant.
 *
 * Two modes, because two different things are true. A repair prompt carries an
 * observed finding and may ask for a fix. An investigation prompt carries a
 * check whose source never answered: it states that no conclusion was reached
 * and asks only for the evidence path, so a gated check cannot be laundered
 * into a repair order.
 *
 * Everything in the output comes from the issue and the run's provenance. No
 * session, account, credential, or raw response body is reachable from here.
 */
export function buildAgentIssuePrompt({
  issue,
  locale,
  run,
  targetUrl,
}: BuildAgentIssuePromptInput): string {
  const lang = promptLocale(locale);
  const labels = LABELS[lang];
  const check = issue.check.check;
  const investigation = issue.copyMode === "investigation";

  const lines: string[] = [
    investigation ? labels.investigationIntro : labels.repairIntro,
    "",
    `${labels.check}: ${check.id} · ${text(check.title, lang)}`,
  ];

  if (issue.severity !== null) {
    lines.push(`${labels.severity}: ${labels.severities[issue.severity]}`);
  }
  if (targetUrl !== undefined) {
    lines.push(`${labels.target}: ${redactUrl(targetUrl)}`);
  }

  lines.push(`${labels.rule}: ${text(check.threshold, lang)}`);

  const measurement = issue.check.measurement;
  if (measurement !== null && measurement !== undefined) {
    lines.push(`${labels.measured}: ${text(measurement, lang)}`);
  }

  lines.push("");

  if (investigation || issue.affected.mode === "unavailable") {
    lines.push(labels.unavailableNote, "");
  } else if (issue.affected.mode === "not-captured") {
    lines.push(labels.notCaptured, "");
  } else if (issue.affected.mode === "site-scope") {
    lines.push(labels.affectedSite);
    if ((issue.affected.totalCount ?? 0) > 1) {
      lines.push(labels.affectedSiteCount(issue.affected.totalCount ?? 0));
    }
    if (!issue.affected.enumerated) lines.push(labels.affectedNotEnumerated);
    lines.push("");
  } else if (issue.affected.urls.length > 0) {
    lines.push(`${labels.affected}:`);
    for (const url of issue.affected.urls) lines.push(`- ${redactUrl(url)}`);
    if (!issue.affected.enumerated) {
      lines.push(labels.affectedNotEnumerated);
    }
    if (issue.affected.overflowCount > 0) {
      lines.push(
        labels.affectedMore(
          issue.affected.urls.length,
          issue.affected.totalCount ?? issue.affected.urls.length,
          issue.affected.overflowCount,
        ),
      );
    }
    lines.push("");
  }

  const evidence = evidenceLines(issue.evidenceRecords, lang);
  if (evidence.length > 0) {
    lines.push(`${labels.evidence}:`, ...evidence, "");
  }

  lines.push(`${labels.boundary}: ${text(check.boundary, lang)}`, "");

  if (investigation) {
    // Deliberately no repair guidance, not even relabelled: this check has no
    // verdict, and a fix printed under a different heading is still a fix.
    lines.push(
      `${labels.investigationTask}:`,
      `${labels.requiredSource}: ${text(check.dataSource, lang)}`,
      "",
    );
  } else {
    lines.push(
      `${labels.repairTask}:`,
      `${labels.repairSteps}: ${text(check.howToFix, lang)}`,
      "",
    );
  }

  for (const rule of investigation ? labels.investigationRules : labels.rules) {
    lines.push(`- ${rule}`);
  }

  lines.push("", `${labels.provenance}: ${labels.provenanceLine(run)}`);

  return lines.join("\n");
}
