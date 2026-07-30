// @input  -- locale and a visitor's public website URL
// @output -- transient, bounded real crawl report; no fixed result fixture
// @pos    -- primary client surface for /[locale]/tools/internal-link-audit

"use client";

import type {
  InternalLinkAuditNode,
  InternalLinkAuditPayload,
} from "@sf/public-tools";
import {
  ArrowRight,
  ChevronRight,
  FolderTree,
  GitBranch,
  Link2,
  Network,
  Route,
  ScanLine,
  Search,
  Waypoints,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { type InternalLinkAuditLocale } from "./internal-link-audit-content";
import {
  buildInternalLinkAuditTree,
  type InternalLinkAuditTreeModel,
} from "./internal-link-audit-tree";

type Phase = "idle" | "running" | "result" | "error";
type TreeFilter = "all" | InternalLinkAuditNode["kind"];

interface InternalLinkAuditToolProps {
  readonly locale: string;
}

const COPY = {
  en: {
    label: "Website URL",
    placeholder: "yourdomain.com",
    start: "Run internal link audit",
    running: "Crawling public HTML with a bounded safety budget…",
    help: "We crawl the site origin, respect robots.txt, and do not store your URL or page content. This preview reads static same-origin HTML only.",
    scope: "Up to 25 pages · up to depth 4 · up to 40 seconds · no login required",
    progress: ["Checking robots and sitemap", "Following same-origin HTML links", "Building the crawl tree"],
    result: "Real bounded crawl result",
    partial: "Partial coverage",
    available: "Completed within the crawl budget",
    mapped: "Pages collected",
    links: "HTML links observed",
    sitemap: "Sitemap URLs observed",
    fixes: "Prioritized findings",
    tree: "Observed crawl tree",
    treeBody: "Each page appears under one observed shallower parent to keep the hierarchy readable. Counts still include every observed HTML link; cross-links and cycles are not erased.",
    treeSearch: "Find a page in this crawl",
    treeSearchPlaceholder: "Search URL or page title",
    clearSearch: "Clear tree search",
    connectedBranch: "Observed hierarchy",
    unlinkedBranch: "No displayed parent",
    unlinkedBody: "These pages came from an allowed seed such as a sitemap, or their shallower inbound relationship falls outside the displayed edge sample.",
    treeMatches: "pages shown",
    noTreeMatches: "No collected page matches this filter and search.",
    additionalInbound: "additional observed inbound link(s)",
    all: "All pages",
    home: "Homepage",
    orphan_candidate: "Orphan candidates",
    deep: "Deep pages",
    page: "Other pages",
    unresolved_target: "Unresolved targets",
    selected: "Selected page",
    selectedFinding: "Selected finding",
    pageContext: "Collected source-page context",
    inbound: "Inbound",
    outbound: "Outbound",
    depthLabel: "Depth",
    sitemapLabel: "Sitemap",
    yes: "yes",
    no: "no",
    evidence: "Observed evidence",
    limitation: "Interpretation limit",
    source: "Observed source page",
    anchor: "Observed anchor text",
    findings: "Prioritized review list",
    findingsBody: "These are editorial review prompts, not automatic changes. Verify important findings after any site or navigation update.",
    noFindings: "No prioritized structural candidates were found within this bounded crawl.",
    errorInvalid: "Enter a publicly reachable HTTP(S) domain. Local, IP-literal, credentialed, and reserved addresses are not accepted.",
    errorRate: "This public preview is rate-limited. Please wait before trying another crawl.",
    errorProgress: "An audit for this browser address is already running. Please wait for it to finish.",
    errorTimeout: "The site did not finish within the public crawl time budget. Try again later or audit a smaller site section in the full product.",
    errorGeneric: "We could not collect a safe public crawl result for that site. Check that it is publicly reachable and try again.",
    sourceUnavailable: "No observed source page",
    anchorUnavailable: "No anchor text recorded",
    actualScope: "Static HTML · same origin · transient request · no stored report",
  },
  zh: {
    label: "网站 URL",
    placeholder: "yourdomain.com",
    start: "开始内链审计",
    running: "正在安全预算内抓取公开 HTML…",
    help: "工具从网站根域开始抓取、遵守 robots.txt，不保存 URL 或页面内容。当前预览仅读取同源静态 HTML。",
    scope: "最多 25 页 · 最深 4 层 · 最长 40 秒 · 无需登录",
    progress: ["检查 robots 与 Sitemap", "跟随同源 HTML 链接", "生成抓取树"],
    result: "真实受限抓取结果",
    partial: "覆盖不完整",
    available: "在抓取预算内完成",
    mapped: "已采集页面",
    links: "已观测 HTML 内链",
    sitemap: "已观测 Sitemap URL",
    fixes: "优先发现",
    tree: "已观测的抓取树",
    treeBody: "为保持层级清晰，每个页面只挂在一个已观测到的浅层父页面下；入链与出链数量仍包含全部已观测 HTML 关系，不会丢失交叉链接或循环关系。",
    treeSearch: "在本次抓取中查找页面",
    treeSearchPlaceholder: "搜索 URL 或页面标题",
    clearSearch: "清空树状视图搜索",
    connectedBranch: "已观测层级",
    unlinkedBranch: "未展示父页面",
    unlinkedBody: "这些页面来自 Sitemap 等允许的抓取入口，或指向它们的浅层入链没有进入当前展示的关系样本。",
    treeMatches: "个页面",
    noTreeMatches: "没有页面同时符合当前筛选和搜索条件。",
    additionalInbound: "条其他已观测入链",
    all: "全部页面",
    home: "首页",
    orphan_candidate: "候选孤岛",
    deep: "深层页面",
    page: "其他页面",
    unresolved_target: "未验证目标",
    selected: "已选页面",
    selectedFinding: "已选发现",
    pageContext: "已采集来源页上下文",
    inbound: "入链",
    outbound: "出链",
    depthLabel: "深度",
    sitemapLabel: "Sitemap",
    yes: "是",
    no: "否",
    evidence: "观测证据",
    limitation: "解释边界",
    source: "观测到的来源页",
    anchor: "观测到的锚文本",
    findings: "优先复核清单",
    findingsBody: "这些是编辑复核提示，而不是自动改动。网站或导航更新后，请复核重要发现。",
    noFindings: "本次受限抓取中未发现需要优先处理的结构候选项。",
    errorInvalid: "请输入可公开访问的 HTTP(S) 域名。不接受本地地址、IP 地址、带凭据或保留地址。",
    errorRate: "公开预览有频率限制，请稍后再试。",
    errorProgress: "该浏览器地址已有一次审计正在进行，请等待它完成。",
    errorTimeout: "网站未能在公开抓取的时间预算内完成。请稍后再试，或在完整产品中审计更小的网站范围。",
    errorGeneric: "无法为该网站采集安全的公开抓取结果。请确认网站可公开访问后重试。",
    sourceUnavailable: "没有观测到来源页面",
    anchorUnavailable: "未记录锚文本",
    actualScope: "静态 HTML · 同源 · 请求瞬时处理 · 不保存报告",
  },
} as const;

type ToolCopy = (typeof COPY)[keyof typeof COPY];

const STYLE: Record<InternalLinkAuditNode["kind"], { fill: string; ring: string }> = {
  home: { fill: "#F0EDE8", ring: "#F0EDE8" },
  page: { fill: "#6F9C8B", ring: "#8FC8B2" },
  deep: { fill: "#D4A843", ring: "#F0C761" },
  orphan_candidate: { fill: "#D95757", ring: "#F27A7A" },
  unresolved_target: { fill: "#9B9690", ring: "#D5D0CA" },
};

function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function errorMessage(code: string, copy: ToolCopy): string {
  if (code === "invalid_url" || code === "invalid_request") return copy.errorInvalid;
  if (code === "rate_limited") return copy.errorRate;
  if (code === "scan_in_progress") return copy.errorProgress;
  if (code === "scan_timeout") return copy.errorTimeout;
  return copy.errorGeneric;
}

function TreeNodeRow({
  childrenById,
  copy,
  matchIds,
  nodeById,
  nodeId,
  onSelect,
  secondaryInboundById,
  selectedNodeId,
  visibleIds,
}: {
  readonly childrenById: InternalLinkAuditTreeModel["childrenById"];
  readonly copy: ToolCopy;
  readonly matchIds: ReadonlySet<string>;
  readonly nodeById: ReadonlyMap<string, InternalLinkAuditNode>;
  readonly nodeId: string;
  readonly onSelect: (nodeId: string) => void;
  readonly secondaryInboundById: InternalLinkAuditTreeModel["secondaryInboundById"];
  readonly selectedNodeId: string;
  readonly visibleIds: ReadonlySet<string>;
}) {
  const node = nodeById.get(nodeId);
  if (!node || !visibleIds.has(nodeId)) return null;
  const children = (childrenById.get(nodeId) ?? []).filter((id) =>
    visibleIds.has(id),
  );
  const selected = selectedNodeId === node.id;
  const directMatch = matchIds.has(node.id);
  const nodeStyle = STYLE[node.kind];
  const secondaryInbound = secondaryInboundById.get(node.id) ?? 0;

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-pressed={selected}
        data-testid={`internal-link-node-${node.id}`}
        className={`group flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent sm:px-4 ${
          selected
            ? "border-brand-accent/70 bg-brand-accent/12"
            : "border-brand-border/60 bg-black/10 hover:border-brand-border hover:bg-white/[0.025]"
        } ${directMatch ? "opacity-100" : "opacity-55"}`}
      >
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full border-2"
          style={{
            backgroundColor: nodeStyle.fill,
            borderColor: selected ? "#F0EDE8" : nodeStyle.ring,
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="min-w-0 break-all font-mono text-[13px] font-medium leading-5 text-text-dark-primary sm:text-[14px]">
              {displayPath(node.url)}
            </strong>
            <span className="rounded-full border border-brand-border/70 px-2 py-0.5 text-[10px] leading-4 text-text-dark-secondary">
              {copy[node.kind]}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-text-dark-secondary">
            <span>{copy.depthLabel} {node.depth}</span>
            <span>{copy.inbound} {node.inboundLinks}</span>
            <span>{copy.outbound} {node.outboundLinks}</span>
            {secondaryInbound > 0 ? (
              <span className="inline-flex items-center gap-1 text-brand-accent-text">
                <GitBranch aria-hidden="true" className="h-3 w-3" />
                {secondaryInbound} {copy.additionalInbound}
              </span>
            ) : null}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform ${
            selected ? "translate-x-0.5 text-brand-accent-text" : "text-text-dark-secondary"
          }`}
        />
      </button>
      {children.length ? (
        <ul
          className="ml-2 mt-2 space-y-2 border-l border-brand-border/70 pl-2 sm:ml-5 sm:pl-4"
        >
          {children.map((childId) => (
            <TreeNodeRow
              key={childId}
              childrenById={childrenById}
              copy={copy}
              matchIds={matchIds}
              nodeById={nodeById}
              nodeId={childId}
              onSelect={onSelect}
              secondaryInboundById={secondaryInboundById}
              selectedNodeId={selectedNodeId}
              visibleIds={visibleIds}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function LinkTree({
  report,
  copy,
  selectedNodeId,
  onSelect,
}: {
  readonly report: InternalLinkAuditPayload["result"];
  readonly copy: ToolCopy;
  readonly selectedNodeId: string;
  readonly onSelect: (nodeId: string) => void;
}) {
  const [filter, setFilter] = useState<TreeFilter>("all");
  const [query, setQuery] = useState("");
  const tree = useMemo(() => buildInternalLinkAuditTree(report), [report]);
  const nodeById = useMemo(
    () => new Map(report.nodes.map((node) => [node.id, node])),
    [report.nodes],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchIds = useMemo(
    () =>
      new Set(
        report.nodes
          .filter((node) => filter === "all" || node.kind === filter)
          .filter((node) => {
            if (!normalizedQuery) return true;
            return `${displayPath(node.url)} ${node.title ?? ""}`
              .toLocaleLowerCase()
              .includes(normalizedQuery);
          })
          .map((node) => node.id),
      ),
    [filter, normalizedQuery, report.nodes],
  );
  const visibleIds = useMemo(() => {
    if (filter === "all" && !normalizedQuery) {
      return new Set(report.nodes.map((node) => node.id));
    }
    const visible = new Set(matchIds);
    for (const id of matchIds) {
      let parentId = tree.parentById.get(id);
      while (parentId) {
        visible.add(parentId);
        parentId = tree.parentById.get(parentId);
      }
    }
    return visible;
  }, [filter, matchIds, normalizedQuery, report.nodes, tree.parentById]);
  const filters: readonly [TreeFilter, string][] = [
    ["all", copy.all],
    ["home", copy.home],
    ["orphan_candidate", copy.orphan_candidate],
    ["deep", copy.deep],
    ["page", copy.page],
  ];
  const connectedRoots = tree.roots.filter(
    (id) => nodeById.get(id)?.kind === "home" && visibleIds.has(id),
  );
  const unlinkedRoots = tree.roots.filter(
    (id) => nodeById.get(id)?.kind !== "home" && visibleIds.has(id),
  );

  return (
    <div className="rounded-2xl border border-brand-border/70 bg-[#111112]">
      <div className="border-b border-brand-border/60 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text">
            <FolderTree aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-[17px] font-semibold text-text-dark-primary">
              {copy.tree}
            </h3>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-text-dark-secondary">
              {copy.treeBody}
            </p>
          </div>
        </div>
        <label className="relative mt-4 block">
          <span className="sr-only">{copy.treeSearch}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dark-secondary"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.treeSearchPlaceholder}
            className="h-11 w-full rounded-xl border border-brand-border/70 bg-black/15 pl-10 pr-11 text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary/65 focus:border-brand-accent/70"
          />
          {query ? (
            <button
              type="button"
              aria-label={copy.clearSearch}
              onClick={() => setQuery("")}
              className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-text-dark-secondary hover:text-text-dark-primary"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-full border px-3.5 py-2 text-[12px] ${filter === value ? "border-brand-accent bg-brand-accent/15 text-brand-accent-text" : "border-brand-border text-text-dark-secondary hover:border-brand-border/90 hover:text-text-dark-primary"}`}>
              {label}
            </button>
          ))}
          <span className="ml-auto inline-flex min-h-11 items-center font-mono text-[11px] text-text-dark-secondary">
            {visibleIds.size} {copy.treeMatches}
          </span>
        </div>
      </div>
      <div className="p-3 sm:p-5">
        {matchIds.size ? (
          <div
            className="max-h-[720px] overflow-y-auto overscroll-contain pr-1"
            data-testid="internal-link-tree"
          >
            {connectedRoots.length ? (
              <section aria-labelledby="internal-link-tree-connected">
                <h4
                  id="internal-link-tree-connected"
                  className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-brand-accent-text"
                >
                  {copy.connectedBranch}
                </h4>
                <ul aria-labelledby="internal-link-tree-connected" className="space-y-2">
                  {connectedRoots.map((rootId) => (
                    <TreeNodeRow
                      key={rootId}
                      childrenById={tree.childrenById}
                      copy={copy}
                      matchIds={matchIds}
                      nodeById={nodeById}
                      nodeId={rootId}
                      onSelect={onSelect}
                      secondaryInboundById={tree.secondaryInboundById}
                      selectedNodeId={selectedNodeId}
                      visibleIds={visibleIds}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {unlinkedRoots.length ? (
              <section
                aria-labelledby="internal-link-tree-unlinked"
                className={connectedRoots.length ? "mt-6 border-t border-brand-border/60 pt-5" : ""}
              >
                <h4
                  id="internal-link-tree-unlinked"
                  className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-warning"
                >
                  {copy.unlinkedBranch}
                </h4>
                <p className="mt-1 max-w-2xl text-[12px] leading-5 text-text-dark-secondary">
                  {copy.unlinkedBody}
                </p>
                <ul aria-labelledby="internal-link-tree-unlinked" className="mt-3 space-y-2">
                  {unlinkedRoots.map((rootId) => (
                    <TreeNodeRow
                      key={rootId}
                      childrenById={tree.childrenById}
                      copy={copy}
                      matchIds={matchIds}
                      nodeById={nodeById}
                      nodeId={rootId}
                      onSelect={onSelect}
                      secondaryInboundById={tree.secondaryInboundById}
                      selectedNodeId={selectedNodeId}
                      visibleIds={visibleIds}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <p
            className="rounded-xl border border-dashed border-brand-border/70 px-4 py-8 text-center text-[13px] text-text-dark-secondary"
            data-testid="internal-link-tree-empty"
          >
            {copy.noTreeMatches}
          </p>
        )}
        <p className="mt-4 border-t border-brand-border/50 pt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.actualScope}</p>
      </div>
    </div>
  );
}

function NodeDetail({
  copy,
  finding,
  node,
}: {
  readonly copy: ToolCopy;
  readonly finding: InternalLinkAuditPayload["result"]["findings"][number] | null;
  readonly node: InternalLinkAuditNode;
}) {
  return (
    <aside
      className="rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.055] p-5 xl:sticky xl:top-24"
      aria-live="polite"
      data-testid="internal-link-node-detail"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-accent-text">
        {finding ? copy.selectedFinding : copy.selected}
      </p>
      {finding ? (
        <>
          <h3 className="mt-2 text-[15px] font-semibold leading-6 text-text-dark-primary">
            {finding.title}
          </h3>
          <p className="mt-2 text-[13px] leading-5 text-text-dark-secondary">
            {finding.detail}
          </p>
          <p className="mt-5 border-t border-brand-border/60 pt-5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.pageContext}
          </p>
        </>
      ) : null}
      <h3 className="mt-2 break-all font-mono text-[15px] font-semibold leading-6 text-text-dark-primary">
        {displayPath(node.url)}
      </h3>
      <p className="mt-1 text-[13px] leading-5 text-text-dark-secondary">
        {node.title ?? node.url}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-brand-border/60 pt-5 text-[13px]">
        <div><dt className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.inbound}</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.inboundLinks}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.outbound}</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.outboundLinks}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.depthLabel}</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.depth}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.sitemapLabel}</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.sitemapMember ? copy.yes : copy.no}</dd></div>
      </dl>
      {finding ? (
        <div className="mt-5 space-y-4 border-t border-brand-border/60 pt-5 text-[13px] leading-5">
          <div><p className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.evidence}</p><p className="mt-1 text-text-dark-primary">{finding.evidence}</p></div>
          <div><p className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.limitation}</p><p className="mt-1 text-text-dark-primary">{finding.limitation}</p></div>
          <div><p className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.source}</p><p className="mt-1 break-all font-mono text-text-dark-primary">{finding.suggestedSourceUrl ?? copy.sourceUnavailable}</p></div>
          <div><p className="text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">{copy.anchor}</p><p className="mt-1 text-text-dark-primary">{finding.observedAnchorText ?? copy.anchorUnavailable}</p></div>
        </div>
      ) : null}
    </aside>
  );
}

export function InternalLinkAuditTool({ locale: localeValue }: InternalLinkAuditToolProps) {
  const locale: InternalLinkAuditLocale = localeValue === "zh" ? "zh" : "en";
  const copy = COPY[locale];
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [payload, setPayload] = useState<InternalLinkAuditPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (phase === "result") resultHeadingRef.current?.focus(); }, [phase]);
  useEffect(() => { if (phase !== "running") return; const first = window.setTimeout(() => setStage(1), 800); const second = window.setTimeout(() => setStage(2), 2200); return () => { window.clearTimeout(first); window.clearTimeout(second); }; }, [phase]);
  const report = payload?.result ?? null;
  const selectedNode = report?.nodes.find((node) => node.id === selectedNodeId) ?? report?.nodes[0] ?? null;
  const selectedFinding = report?.findings.find((finding) => finding.id === selectedFindingId) ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setPayload(null); setSelectedFindingId(null); setPhase("running"); setStage(0);
    try {
      const response = await fetch("/api/tools/internal-link-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = (await response.json().catch(() => null)) as { data?: InternalLinkAuditPayload; error?: { code?: string } } | null;
      if (!response.ok || !body?.data) { setError(errorMessage(body?.error?.code ?? "scan_failed", copy)); setPhase("error"); return; }
      const initialNodeId = body.data.result.nodes[0]?.id ?? null;
      setPayload(body.data);
      setSelectedNodeId(initialNodeId);
      setSelectedFindingId(
        body.data.result.findings.find((finding) => finding.nodeId === initialNodeId)?.id ?? null,
      );
      setPhase("result");
    } catch { setError(copy.errorGeneric); setPhase("error"); }
  }
  const metricItems = report ? [[copy.mapped, `${report.pagesCrawled}/${report.maxPages}`, Waypoints], [copy.links, String(report.linksObserved), Link2], [copy.sitemap, report.sitemapFetched ? String(report.sitemapUrlsObserved) : "—", Network], [copy.fixes, String(report.findings.length), Route]] as const : [];

  return (
    <section
      id="internal-link-audit-tool"
      aria-busy={phase === "running"}
      className="scroll-mt-24"
      data-testid="internal-link-audit-tool"
    >
      <div className="relative overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718] p-5 md:p-7">
        <form onSubmit={handleSubmit} className="relative grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span id="internal-link-url-label" className="mb-2 block text-[12px] font-medium uppercase tracking-[0.12em] text-text-dark-secondary">
              {copy.label}
            </span>
            <span className="flex h-13 items-center gap-3 rounded-xl border border-brand-border/80 bg-brand-bg px-4 focus-within:border-brand-accent/70">
              <Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-accent-text" />
              <input
                id="internal-link-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                required
                maxLength={2048}
                aria-invalid={phase === "error"}
                aria-labelledby="internal-link-url-label"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={copy.placeholder}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary/60"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={phase === "running"}
            className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white disabled:cursor-wait disabled:opacity-70"
          >
            {phase === "running" ? copy.running : copy.start}
            {phase === "running" ? (
              <ScanLine aria-hidden="true" className="h-4 w-4 animate-pulse motion-reduce:animate-none" />
            ) : (
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </form>
        {error ? <p role="alert" className="mt-3 text-[13px] leading-5 text-red-200">{error}</p> : null}
        <div className="mt-4 grid gap-2 border-t border-brand-border/60 pt-4 text-[12px] leading-5 text-text-dark-secondary md:grid-cols-2">
          <p>{copy.help}</p>
          <p>{copy.scope}</p>
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
            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-brand-accent-text">{copy.running}</p>
            <span className="font-mono text-[11px] text-text-dark-secondary">0{stage + 1}/03</span>
          </div>
          <ol className="grid gap-2 md:grid-cols-3">
            {copy.progress.map((item, index) => (
              <li
                key={item}
                className={`rounded-lg border px-3 py-3 text-[12px] ${
                  index <= stage
                    ? "border-brand-accent/40 bg-brand-accent/10 text-text-dark-primary"
                    : "border-brand-border/60 text-text-dark-secondary"
                }`}
              >
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {report && phase === "result" ? (
        <div className="mt-6 space-y-5" data-testid="internal-link-audit-result">
          <div className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]">
            <div className="grid gap-5 border-b border-brand-border/60 p-5 md:grid-cols-[1.3fr_0.7fr] md:p-7">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-brand-accent-text">{copy.result}</p>
                <h2
                  ref={resultHeadingRef}
                  tabIndex={-1}
                  className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-text-dark-primary outline-none md:text-[30px]"
                >
                  {report.availability === "partial" ? copy.partial : copy.available}
                </h2>
                <p className="mt-3 text-[14px] leading-6 text-text-dark-secondary">{report.limitation}</p>
              </div>
              <div className="rounded-xl border border-brand-border/70 bg-black/10 px-4 py-3 text-[12px] leading-5 text-text-dark-secondary">
                <p>{copy.actualScope}</p>
                {report.stopReason ? <p className="mt-2 font-mono">stop: {report.stopReason}</p> : null}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-brand-border/60 lg:grid-cols-4">
              {metricItems.map(([label, value, Icon]) => (
                <div key={label} className="bg-[#151516] p-4 md:p-5">
                  <dt className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">
                    <span>{label}</span>
                    <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-accent-text" />
                  </dt>
                  <dd className="mt-3 font-mono text-[24px] leading-none text-text-dark-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <LinkTree
              report={report}
              copy={copy}
              selectedNodeId={selectedNode?.id ?? ""}
              onSelect={(nodeId) => {
                setSelectedNodeId(nodeId);
                setSelectedFindingId(
                  report.findings.find((finding) => finding.nodeId === nodeId)?.id ?? null,
                );
              }}
            />
            {selectedNode ? (
              <NodeDetail node={selectedNode} finding={selectedFinding} copy={copy} />
            ) : null}
          </div>

          <section className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5">
            <h3 className="text-[17px] font-semibold text-text-dark-primary">{copy.findings}</h3>
            <p className="mt-1 text-[13px] leading-5 text-text-dark-secondary">{copy.findingsBody}</p>
            {report.findings.length === 0 ? (
              <p className="mt-5 text-[13px] text-text-dark-secondary">{copy.noFindings}</p>
            ) : (
              <div className="mt-5 grid gap-2 lg:grid-cols-2">
                {report.findings.map((finding) => {
                  const selected = selectedFindingId === finding.id;
                  return (
                    <button
                      key={finding.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(finding.nodeId);
                        setSelectedFindingId(finding.id);
                      }}
                      aria-pressed={selected}
                      data-testid={`internal-link-finding-${finding.id}`}
                      className={`min-h-16 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent ${
                        selected
                          ? "border-brand-accent/60 bg-brand-accent/10"
                          : "border-brand-border/60 bg-black/10 hover:border-brand-border"
                      }`}
                    >
                      <span className="flex gap-3">
                        <span className="h-fit rounded bg-brand-warning/10 px-2 py-1 font-mono text-[11px] text-brand-warning">
                          {finding.priority}
                        </span>
                        <span>
                          <strong className="block text-[13px] font-medium leading-5 text-text-dark-primary">
                            {finding.title}
                          </strong>
                          <small className="mt-1 block text-[12px] leading-5 text-text-dark-secondary">
                            {finding.detail}
                          </small>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
