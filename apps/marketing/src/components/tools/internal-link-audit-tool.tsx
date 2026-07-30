// @input  -- current marketing locale and a user-entered public URL
// @output -- no-network P0-2 demo flow, fixed link graph, findings, and evidence detail
// @pos    -- primary client surface for /[locale]/tools/internal-link-audit

"use client";

import {
  ArrowRight,
  CircleAlert,
  FileWarning,
  Link2,
  Network,
  Route,
  ScanLine,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  getInternalLinkAuditContent,
  type InternalLinkAuditLocale,
} from "./internal-link-audit-content";
import {
  INTERNAL_LINK_EDGES,
  INTERNAL_LINK_FINDINGS,
  INTERNAL_LINK_NODES,
  localizeDemoText,
  type InternalLinkNode,
  type LinkNodeKind,
} from "./internal-link-audit-demo-data";

type DemoPhase = "idle" | "running" | "result";
type GraphFilter = "all" | "pillar" | "orphan" | "deep" | "broken";

interface InternalLinkAuditToolProps {
  readonly locale: string;
}

const NODE_STYLES: Record<
  LinkNodeKind,
  { readonly fill: string; readonly text: string; readonly ring: string }
> = {
  home: { fill: "#F0EDE8", text: "#131314", ring: "#F0EDE8" },
  pillar: { fill: "#D97757", text: "#131314", ring: "#E5956F" },
  page: { fill: "#6F9C8B", text: "#101714", ring: "#8FC8B2" },
  deep: { fill: "#D4A843", text: "#131314", ring: "#F0C761" },
  orphan: { fill: "#D95757", text: "#F0EDE8", ring: "#F27A7A" },
  broken: { fill: "#9B9690", text: "#131314", ring: "#D5D0CA" },
};

function normalizeDemoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !parsed.hostname.includes(".") ||
      parsed.hostname === "localhost"
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function GraphLegend({
  locale,
}: {
  readonly locale: InternalLinkAuditLocale;
}) {
  const labels =
    locale === "en"
      ? [
          ["#D97757", "Pillar"],
          ["#D95757", "Orphan"],
          ["#D4A843", "Deep"],
          ["#9B9690", "Broken"],
        ]
      : [
          ["#D97757", "Pillar"],
          ["#D95757", "孤岛"],
          ["#D4A843", "深层"],
          ["#9B9690", "断链"],
        ];

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
      {labels.map(([color, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

function LinkGraph({
  locale,
  selectedNodeId,
  onSelect,
}: {
  readonly locale: InternalLinkAuditLocale;
  readonly selectedNodeId: string;
  readonly onSelect: (nodeId: string) => void;
}) {
  const copy = getInternalLinkAuditContent(locale).result;
  const [filter, setFilter] = useState<GraphFilter>("all");

  const visibleNodeIds = useMemo(() => {
    const ids = INTERNAL_LINK_NODES.filter((node) => {
      if (filter === "all") return true;
      return node.kind === filter || node.tags.includes(filter);
    }).map((node) => node.id);
    return new Set(ids);
  }, [filter]);

  const nodesById = useMemo(
    () => new Map(INTERNAL_LINK_NODES.map((node) => [node.id, node])),
    [],
  );

  const filters: readonly [GraphFilter, string][] = [
    ["all", copy.filterAll],
    ["pillar", copy.filterPillars],
    ["orphan", copy.filterOrphans],
    ["deep", copy.filterDeep],
    ["broken", copy.filterBroken],
  ];

  function handleNodeKeyDown(
    event: KeyboardEvent<SVGGElement>,
    nodeId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(nodeId);
    }
  }

  return (
    <div className="rounded-2xl border border-brand-border/70 bg-[#111112]">
      <div className="border-b border-brand-border/60 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-text-dark-primary">
              {copy.graphTitle}
            </h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-text-dark-secondary">
              {copy.graphBody}
            </p>
          </div>
          <div
            className="flex flex-wrap gap-2"
            aria-label={locale === "en" ? "Filter graph nodes" : "筛选关系图节点"}
          >
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  if (value !== "all") {
                    const firstMatchingNode = INTERNAL_LINK_NODES.find(
                      (node) =>
                        node.kind === value || node.tags.includes(value),
                    );
                    if (firstMatchingNode) onSelect(firstMatchingNode.id);
                  }
                }}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent motion-reduce:transition-none ${
                  filter === value
                    ? "border-brand-accent bg-brand-accent/15 text-brand-accent-text"
                    : "border-brand-border text-text-dark-secondary hover:border-brand-accent/50 hover:text-text-dark-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden p-3 sm:p-5">
        <svg
          viewBox="0 0 900 500"
          role="img"
          aria-labelledby="internal-link-graph-title internal-link-graph-desc"
          className="aspect-[9/5] h-auto min-h-[260px] w-full"
          data-testid="internal-link-graph"
        >
          <title id="internal-link-graph-title">{copy.graphTitle}</title>
          <desc id="internal-link-graph-desc">{copy.graphBody}</desc>
          <defs>
            <radialGradient id="graph-glow" cx="50%" cy="50%" r="65%">
              <stop offset="0%" stopColor="#D97757" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#D97757" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="900" height="500" rx="18" fill="url(#graph-glow)" />
          <g
            fill="none"
            stroke="rgba(240,237,232,.17)"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            {INTERNAL_LINK_EDGES.map((edge) => {
              const from = nodesById.get(edge.from);
              const to = nodesById.get(edge.to);
              if (!from || !to) return null;
              const visible =
                visibleNodeIds.has(from.id) && visibleNodeIds.has(to.id);
              const middleX = (from.x + to.x) / 2;
              return (
                <path
                  key={`${edge.from}:${edge.to}`}
                  d={`M${from.x} ${from.y} C${middleX} ${from.y}, ${middleX} ${to.y}, ${to.x} ${to.y}`}
                  opacity={visible ? 1 : 0.08}
                  strokeDasharray={to.kind === "broken" ? "5 5" : undefined}
                />
              );
            })}
          </g>
          {INTERNAL_LINK_NODES.map((node) => {
            const style = NODE_STYLES[node.kind];
            const visible = visibleNodeIds.has(node.id);
            const selected = selectedNodeId === node.id;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={visible ? 0 : -1}
                aria-label={`${node.path}: ${localizeDemoText(node.status, locale)}`}
                aria-pressed={selected}
                opacity={visible ? 1 : 0.08}
                onClick={() => visible && onSelect(node.id)}
                onFocus={() => visible && onSelect(node.id)}
                onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                className="cursor-pointer outline-none"
                data-testid={`internal-link-node-${node.id}`}
              >
                {node.kind === "orphan" ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius + 14}
                    fill="none"
                    stroke={style.ring}
                    strokeWidth="1.5"
                    strokeDasharray="5 5"
                  />
                ) : null}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={style.fill}
                  stroke={selected ? "#F0EDE8" : style.ring}
                  strokeWidth={selected ? 5 : 1.5}
                />
                <text
                  x={node.x}
                  y={node.y + 3}
                  textAnchor="middle"
                  fill={style.text}
                  fontSize={node.radius > 30 ? 10 : 8}
                  fontWeight="700"
                  letterSpacing="0.04em"
                  aria-hidden="true"
                >
                  {node.shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mt-2 flex flex-col gap-3 border-t border-brand-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <GraphLegend locale={locale} />
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.fixedData}
          </span>
        </div>
      </div>
    </div>
  );
}

function NodeDetail({
  node,
  locale,
}: {
  readonly node: InternalLinkNode;
  readonly locale: InternalLinkAuditLocale;
}) {
  const copy = getInternalLinkAuditContent(locale).result;

  return (
    <aside
      className="rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.055] p-5"
      aria-live="polite"
      data-testid="internal-link-node-detail"
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-brand-accent-text">
        {copy.detailEyebrow}
      </p>
      <h3 className="mt-2 break-all font-mono text-[17px] font-semibold text-text-dark-primary">
        {node.path}
      </h3>
      <p className="mt-1 text-[11px] font-medium text-brand-accent-text">
        {localizeDemoText(node.status, locale)}
      </p>
      <p className="mt-4 text-[12px] leading-relaxed text-text-dark-secondary">
        {localizeDemoText(node.summary, locale)}
      </p>
      <dl className="mt-5 space-y-4 border-t border-brand-border/60 pt-5">
        <div>
          <dt className="text-[9px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">
            {copy.evidence}
          </dt>
          <dd className="mt-1.5 text-[11px] leading-relaxed text-text-dark-primary">
            {localizeDemoText(node.evidence, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">
            {copy.limitation}
          </dt>
          <dd className="mt-1.5 text-[11px] leading-relaxed text-text-dark-primary">
            {localizeDemoText(node.limitation, locale)}
          </dd>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <dt className="text-[9px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">
              {copy.suggestedSource}
            </dt>
            <dd className="mt-1.5 break-all font-mono text-[11px] text-text-dark-primary">
              {node.source}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">
              {copy.anchorText}
            </dt>
            <dd className="mt-1.5 text-[11px] text-text-dark-primary">
              {localizeDemoText(node.anchor, locale)}
            </dd>
          </div>
        </div>
        <div>
          <dt className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.14em] text-brand-accent-text">
            <Route aria-hidden="true" className="h-3 w-3" />
            {copy.verify}
          </dt>
          <dd className="mt-1.5 text-[11px] leading-relaxed text-text-dark-primary">
            {localizeDemoText(node.verify, locale)}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

export function InternalLinkAuditTool({
  locale: localeValue,
}: InternalLinkAuditToolProps) {
  const locale: InternalLinkAuditLocale =
    localeValue === "zh" ? "zh" : "en";
  const copy = getInternalLinkAuditContent(locale);
  const [url, setUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("app-orphan");
  const timers = useRef<number[]>([]);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const selectedNode =
    INTERNAL_LINK_NODES.find((node) => node.id === selectedNodeId) ??
    INTERNAL_LINK_NODES[0];
  const metricItems: readonly [
    label: string,
    value: string,
    icon: LucideIcon,
  ][] = [
    [copy.result.mappedPages, "42", Waypoints],
    [copy.result.internalLinks, "118", Link2],
    [copy.result.orphanPages, "4", FileWarning],
    [copy.result.priorityFixes, "7", Route],
  ];
  const narrativeItems: readonly [
    label: string,
    body: string,
    icon: LucideIcon,
  ][] = [
    [copy.result.observation, copy.result.observationBody, Network],
    [copy.result.diagnosis, copy.result.diagnosisBody, CircleAlert],
    [
      copy.result.recommendation,
      copy.result.recommendationBody,
      Route,
    ],
    [copy.result.artifact, copy.result.artifactBody, FileWarning],
  ];

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    if (phase === "result") resultHeadingRef.current?.focus();
  }, [phase]);

  function clearTimers() {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeDemoUrl(url);
    if (!normalized) {
      setError(true);
      return;
    }

    clearTimers();
    setError(false);
    setSubmittedUrl(normalized);
    setPhase("running");
    setStage(0);
    setSelectedNodeId("app-orphan");

    timers.current.push(
      window.setTimeout(() => setStage(1), 450),
      window.setTimeout(() => setStage(2), 900),
      window.setTimeout(() => setPhase("result"), 1_350),
    );
  }

  return (
    <section
      id="internal-link-audit-tool"
      aria-busy={phase === "running"}
      className="scroll-mt-24"
      data-testid="internal-link-audit-tool"
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-warning/25 bg-brand-warning/[0.06] px-4 py-3">
        <CircleAlert
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-brand-warning"
        />
        <p className="text-[11px] leading-relaxed text-text-dark-secondary">
          <strong className="font-semibold text-text-dark-primary">
            MOCK DATA.
          </strong>{" "}
          {copy.demoBanner}
        </p>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718] p-5 md:p-7">
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-brand-accent/10 blur-3xl"
        />
        <form
          onSubmit={handleSubmit}
          className="relative grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
        >
          <label className="block">
            <span
              id="internal-link-url-label"
              className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary"
            >
              {copy.formLabel}
            </span>
            <span className="flex h-13 items-center gap-3 rounded-xl border border-brand-border/80 bg-brand-bg px-4 focus-within:border-brand-accent/70">
              <Link2
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-brand-accent-text"
              />
              <input
                id="internal-link-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                required
                maxLength={2048}
                aria-invalid={error}
                aria-labelledby="internal-link-url-label"
                aria-describedby={
                  error
                    ? "internal-link-input-help internal-link-input-error"
                    : "internal-link-input-help"
                }
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (error) setError(false);
                }}
                placeholder={copy.placeholder}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary/60"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={phase === "running"}
            className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent motion-reduce:transition-none"
          >
            {phase === "running" ? copy.running : copy.startCrawl}
            {phase === "running" ? (
              <ScanLine
                aria-hidden="true"
                className="h-4 w-4 animate-pulse motion-reduce:animate-none"
              />
            ) : (
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </form>
        {error ? (
          <p
            id="internal-link-input-error"
            role="alert"
            className="relative mt-3 text-[11px] text-red-200"
          >
            {copy.invalidUrl}
          </p>
        ) : null}
        <div
          id="internal-link-input-help"
          className="relative mt-4 grid gap-2 border-t border-brand-border/60 pt-4 text-[10px] leading-relaxed text-text-dark-secondary md:grid-cols-2"
        >
          <p>{copy.inputHelp}</p>
          <p>{copy.mockScope}</p>
        </div>
      </div>

      {phase === "running" ? (
        <div
          className="mt-5 rounded-2xl border border-brand-border/70 bg-[#151516] p-5"
          role="status"
          aria-live="polite"
          data-testid="internal-link-progress"
        >
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-accent-text">
              {copy.running}
            </p>
            <span className="font-mono text-[10px] text-text-dark-secondary">
              0{stage + 1}/03
            </span>
          </div>
          <ol className="grid gap-2 md:grid-cols-3">
            {copy.stages.map((item, index) => (
              <li
                key={item}
                className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-[10px] ${
                  index <= stage
                    ? "border-brand-accent/40 bg-brand-accent/10 text-text-dark-primary"
                    : "border-brand-border/60 text-text-dark-secondary"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    index <= stage ? "bg-brand-accent" : "bg-brand-border"
                  }`}
                />
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {phase === "result" && selectedNode ? (
        <div
          className="mt-6 space-y-5"
          data-testid="internal-link-demo-result"
        >
          <div className="rounded-xl border border-brand-accent/25 bg-brand-accent/[0.06] px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-brand-accent-text">
              {copy.demoResultLabel}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-dark-secondary">
              {copy.demoResultBody}
            </p>
            <p className="mt-2 break-all font-mono text-[9px] text-text-dark-secondary/80">
              {locale === "en" ? "Entered for preview" : "本次预览输入"}:{" "}
              {submittedUrl}
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]">
            <div className="grid gap-7 border-b border-brand-border/60 p-5 md:grid-cols-[1.3fr_0.7fr] md:p-7">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-brand-accent-text">
                  {copy.result.summaryEyebrow}
                </p>
                <h2
                  ref={resultHeadingRef}
                  tabIndex={-1}
                  className="mt-3 max-w-3xl text-[24px] font-semibold leading-tight tracking-[-0.03em] text-text-dark-primary outline-none md:text-[30px]"
                >
                  {copy.result.summaryTitle}
                </h2>
                <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-text-dark-secondary">
                  {copy.result.summaryBody}
                </p>
              </div>
              <div className="flex items-end justify-start md:justify-end">
                <div className="rounded-xl border border-brand-border/70 bg-black/10 px-4 py-3">
                  <p className="text-[9px] uppercase tracking-[0.13em] text-text-dark-secondary">
                    {copy.result.sampleLabel}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-text-dark-primary">
                    GG-DEMO-P02-20260730
                  </p>
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-px bg-brand-border/60 lg:grid-cols-4">
              {metricItems.map(([label, value, Icon]) => (
                <div key={String(label)} className="bg-[#151516] p-4 md:p-5">
                  <div className="flex items-center justify-between">
                    <dt className="text-[9px] uppercase tracking-[0.13em] text-text-dark-secondary">
                      {label}
                    </dt>
                    <Icon
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-brand-accent-text"
                    />
                  </div>
                  <dd className="mt-3 font-mono text-[27px] leading-none text-text-dark-primary">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
            <LinkGraph
              locale={locale}
              selectedNodeId={selectedNodeId}
              onSelect={setSelectedNodeId}
            />
            <NodeDetail node={selectedNode} locale={locale} />
          </div>

          <section className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
            <div className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold text-text-dark-primary">
                  {copy.result.priorityTitle}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-text-dark-secondary">
                  {copy.result.priorityBody}
                </p>
              </div>
              <div className="space-y-2">
                {INTERNAL_LINK_FINDINGS.map((finding) => (
                  <button
                    key={finding.id}
                    type="button"
                    onClick={() => setSelectedNodeId(finding.nodeId)}
                    aria-pressed={selectedNodeId === finding.nodeId}
                    data-testid={`internal-link-finding-${finding.id}`}
                    className={`w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent motion-reduce:transition-none ${
                      selectedNodeId === finding.nodeId
                        ? "border-brand-accent/60 bg-brand-accent/10"
                        : "border-brand-border/60 bg-black/10 hover:border-brand-accent/35"
                    }`}
                  >
                    <span className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 rounded px-1.5 py-1 font-mono text-[9px] ${
                          finding.priority === "P0"
                            ? "bg-red-400/10 text-red-200"
                            : "bg-brand-warning/10 text-brand-warning"
                        }`}
                      >
                        {finding.priority}
                      </span>
                      <span className="min-w-0">
                        <strong className="block text-[11px] font-medium text-text-dark-primary">
                          {localizeDemoText(finding.title, locale)}
                        </strong>
                        <small className="mt-1 block text-[9px] text-text-dark-secondary">
                          {localizeDemoText(finding.metric, locale)}
                        </small>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5 md:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-[16px] font-semibold text-text-dark-primary">
                  {copy.result.fourPartTitle}
                </h3>
                <span className="rounded-full border border-brand-border px-3 py-1 text-[9px] uppercase tracking-[0.12em] text-text-dark-secondary">
                  {copy.result.exportPreview}
                </span>
              </div>
              <div className="grid gap-px overflow-hidden rounded-xl border border-brand-border/60 bg-brand-border/60 sm:grid-cols-2">
                {narrativeItems.map(([label, body, Icon], index) => (
                  <article key={String(label)} className="bg-[#131314] p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-brand-accent-text">
                        0{index + 1}
                      </span>
                      <Icon
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-brand-accent-text"
                      />
                      <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dark-primary">
                        {label}
                      </h4>
                    </div>
                    <p className="mt-3 text-[10px] leading-relaxed text-text-dark-secondary">
                      {body}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
