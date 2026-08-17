// @input  -- locale, visitor URL, public crawl API, consent-gated event tracker
// @output -- real crawl report with analytics and compact evidence boundaries
// @pos    -- primary client surface for /[locale]/tools/internal-link-audit

"use client";

import type {
  InternalLinkAuditNode,
  InternalLinkAuditPayload,
} from "@sf/public-tools";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FolderTree,
  GitBranch,
  Link2,
  Network,
  ScanLine,
  Search,
  Waypoints,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LimitationHint } from "../ui/limitation-hint";
import { type InternalLinkAuditLocale } from "./internal-link-audit-content";
import {
  actionSummary,
  coverageSummary,
  retryAfterMessage,
  stopReasonLabel,
} from "./internal-link-audit-result-copy";
import {
  buildInternalLinkAuditTree,
  type InternalLinkAuditTreeModel,
} from "./internal-link-audit-tree";
import { trackMarketingEvent } from "@/components/layout/google-analytics";

type Phase = "idle" | "running" | "result" | "error";
type TreeFilter = "all" | "attention" | InternalLinkAuditNode["kind"];
const MAX_VISUAL_TREE_LEVEL = 5;

interface InternalLinkAuditToolProps {
  readonly locale: string;
}

const COPY = {
  en: {
    label: "Website URL",
    placeholder: "yourdomain.com",
    start: "Run internal link audit",
    running: "Crawling public static HTML…",
    help: "We start from the submitted public URL, follow same-origin static HTML links, and respect robots.txt. To avoid repeatedly hitting the same site, public crawl facts may be temporarily shared from a server-side cache; no submitter identity or page body is stored.",
    scope:
      "No login required · roughly 950 pages per run · four-minute processing boundary",
    progress: [
      "Checking robots and sitemap",
      "Following same-origin HTML links",
      "Building the page hierarchy",
    ],
    result: "Internal link structure report",
    partial: "Report ready · partial coverage",
    available: "Report ready",
    stopLabel: "Why collection stopped",
    completeLabel: "Collection status",
    completeReason: "Completed within the safety limits",
    completeBody: "The crawl finished without reaching an early-stop boundary.",
    partialBody:
      "The collected pages and evidence remain available for review.",
    mapped: "Pages collected",
    links: "HTML links observed",
    sitemap: "Sitemap URLs observed",
    sitemapGap: "collected page(s) were not listed in the observed sitemap.",
    fixes: "Prioritized findings",
    attention: "Pages needing attention",
    depthDistribution: "Homepage click depth",
    oneClick: "1 click",
    twoClicks: "2 clicks",
    threeClicks: "3 clicks",
    fourPlusClicks: "4+ clicks",
    unreachableCount: "Unreachable",
    tree: "Site page hierarchy",
    treeBody:
      "Indentation follows one shortest observed HTML-link path from the homepage. Sitemap discovery does not shorten click depth; cross-links remain visible in the mapped-inbound badge and link counts.",
    treeSearch: "Find a page in this crawl",
    treeSearchPlaceholder: "Search URL or page title",
    clearSearch: "Clear tree search",
    connectedBranch: "Page hierarchy",
    unlinkedBranch: "Outside the main hierarchy",
    unlinkedBody:
      "Each branch starts with a page that the observed static HTML graph cannot reach from the homepage. It may still have inbound links from another unreachable page.",
    treeMatches: "pages match",
    noTreeMatches: "No collected page matches this filter and search.",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    expandBranch: "Expand branch",
    collapseBranch: "Collapse branch",
    pageColumn: "Page",
    depthColumn: "Homepage clicks",
    additionalInbound: "other mapped inbound link(s)",
    linkGrouped: "Observed link",
    all: "All pages",
    home: "Homepage",
    orphan_candidate: "Orphan candidates",
    orphan_undetermined: "Inbound links unchecked",
    unreachable: "Unreachable from homepage",
    deep: "Deep pages",
    page: "Other pages",
    unresolved_target: "Unresolved targets",
    selected: "Selected page",
    selectedFinding: "Selected finding",
    pageContext: "Collected source-page context",
    inbound: "Inbound",
    outbound: "Outbound",
    depthLabel: "Homepage clicks",
    crawlDepthLabel: "Collection depth",
    notReachable: "not reachable",
    robotsLabel: "Indexable",
    canonicalLabel: "Canonical",
    sitemapLabel: "Sitemap",
    yes: "yes",
    no: "no",
    evidence: "Observed evidence",
    limitation: "Interpretation limit",
    source: "Observed source page",
    anchor: "Observed anchor text",
    findings: "Prioritized review list",
    findingsBody:
      "These are editorial review prompts, not automatic changes. Verify important findings after any site or navigation update.",
    affectedPages: "affected pages",
    confidence: "confidence",
    impact: "impact",
    high: "high",
    medium: "medium",
    low: "low",
    noFindings:
      "No prioritized structural candidates were found in the pages collected by this run.",
    errorInvalid:
      "Enter a publicly reachable HTTP(S) domain. Local, IP-literal, credentialed, and reserved addresses are not accepted.",
    errorRate:
      "This network has run several crawls recently. Each one fetches hundreds of pages from the target site, so there is an hourly ceiling.",
    errorTargetBusy:
      "This site has been crawled several times in the last hour, by you or by someone else. The limit protects the site being audited from repeated automated traffic.",
    errorRobotsDisallowed:
      "This site's robots.txt asks crawlers not to fetch its pages, so nothing was crawled. That is the site owner's choice and says nothing about the site's link structure.",
    errorRobotsUnreachable:
      "This site's robots.txt could not be read, so nothing was crawled. A crawler that cannot read the rules has to assume it is not allowed.",
    errorQuotaUnavailable:
      "Something on our side is down: the service that enforces usage limits is not responding, and this tool will not crawl a site without a working limit in place. This is not about your usage — nothing you did caused it, and nothing has been counted against you.",
    errorProgress:
      "An audit for this browser address is already running. Please wait for it to finish.",
    errorTimeout:
      "The synchronous crawl reached its execution-time boundary before a report could be returned. Large sites may need a future asynchronous scan.",
    errorGeneric:
      "We could not collect a safe public crawl result for that site. Check that it is publicly reachable and try again.",
    sourceUnavailable: "No observed source page",
    anchorUnavailable: "No anchor text recorded",
    actualScope:
      "Static HTML · same origin · temporary shared crawl cache · no submitter identity",
  },
  zh: {
    label: "网站 URL",
    placeholder: "yourdomain.com",
    start: "开始内链审计",
    running: "正在抓取公开静态 HTML…",
    help: "工具从提交的公开 URL 开始，跟随同源静态 HTML 链接并遵守 robots.txt。为避免短时间内重复抓取同一站点，公开抓取事实可能由服务端临时缓存并共享；不保存提交者身份或页面正文。",
    scope: "无需登录 · 单次约覆盖 950 页 · 四分钟处理边界",
    progress: ["检查 robots 与 Sitemap", "跟随同源 HTML 链接", "生成页面层级"],
    result: "内链结构报告",
    partial: "报告已生成 · 部分覆盖",
    available: "报告已生成",
    stopLabel: "本次为何停止",
    completeLabel: "采集状态",
    completeReason: "已在安全范围内完成",
    completeBody: "本次抓取未触发任何提前停止边界。",
    partialBody: "已经采集到的页面和证据仍可继续查看。",
    mapped: "已采集页面",
    links: "已观测 HTML 内链",
    sitemap: "已观测 Sitemap URL",
    sitemapGap: "个已采集页面不在本次观测到的 Sitemap 中。",
    fixes: "优先发现",
    attention: "需要关注的页面",
    depthDistribution: "首页点击深度",
    oneClick: "1 次点击",
    twoClicks: "2 次点击",
    threeClicks: "3 次点击",
    fourPlusClicks: "4 次以上",
    unreachableCount: "无法到达",
    tree: "网站页面层级树",
    treeBody:
      "缩进表示从首页出发的一条最短已观测 HTML 链接路径。Sitemap 只补充发现范围，不会缩短点击深度；交叉内链仍显示在已映射入链标记和链接计数中。",
    treeSearch: "在本次抓取中查找页面",
    treeSearchPlaceholder: "搜索 URL 或页面标题",
    clearSearch: "清空树状视图搜索",
    connectedBranch: "页面主层级",
    unlinkedBranch: "主层级之外",
    unlinkedBody:
      "每个分支的起点都无法通过已观测静态 HTML 链接从首页到达；它仍可能收到另一个不可达页面的入链。",
    treeMatches: "个页面匹配",
    noTreeMatches: "没有页面同时符合当前筛选和搜索条件。",
    expandAll: "全部展开",
    collapseAll: "全部收起",
    expandBranch: "展开分支",
    collapseBranch: "收起分支",
    pageColumn: "页面",
    depthColumn: "首页点击次数",
    additionalInbound: "条其他已映射入链",
    linkGrouped: "内链父页",
    all: "全部页面",
    home: "首页",
    orphan_candidate: "候选孤岛",
    orphan_undetermined: "入链未验证",
    unreachable: "首页无法到达",
    deep: "深层页面",
    page: "其他页面",
    unresolved_target: "未验证目标",
    selected: "已选页面",
    selectedFinding: "已选发现",
    pageContext: "已采集来源页上下文",
    inbound: "入链",
    outbound: "出链",
    depthLabel: "首页点击次数",
    crawlDepthLabel: "采集深度",
    notReachable: "无法到达",
    robotsLabel: "可索引",
    canonicalLabel: "Canonical",
    sitemapLabel: "Sitemap",
    yes: "是",
    no: "否",
    evidence: "观测证据",
    limitation: "解释边界",
    source: "观测到的来源页",
    anchor: "观测到的锚文本",
    findings: "优先复核清单",
    findingsBody:
      "这些是编辑复核提示，而不是自动改动。网站或导航更新后，请复核重要发现。",
    affectedPages: "个受影响页面",
    confidence: "置信度",
    impact: "影响",
    high: "高",
    medium: "中",
    low: "低",
    noFindings: "本次已采集页面中未发现需要优先处理的结构候选项。",
    errorInvalid:
      "请输入可公开访问的 HTTP(S) 域名。不接受本地地址、IP 地址、带凭据或保留地址。",
    errorRate:
      "该网络最近已发起多次抓取。每次都会从目标站点获取数百个页面，因此设有每小时上限。",
    errorTargetBusy:
      "这个站点在过去一小时内已被抓取多次（可能来自你，也可能来自其他人）。该限制用于保护被审计的站点免受重复的自动化流量。",
    errorRobotsDisallowed:
      "该站点的 robots.txt 要求爬虫不要抓取其页面，因此没有抓取任何内容。这是站点所有者的选择，与该站的链接结构无关。",
    errorRobotsUnreachable:
      "该站点的 robots.txt 无法读取，因此没有抓取任何内容。读不到规则的爬虫必须假定自己不被允许。",
    errorQuotaUnavailable:
      "这是我们这边的故障：负责执行用量限制的服务没有响应，而这个工具在限制不可用时不会去抓取任何站点。这与你的使用量无关——不是你做了什么导致的，也没有记在你头上。",
    errorProgress: "该浏览器地址已有一次审计正在进行，请等待它完成。",
    errorTimeout:
      "同步抓取在返回报告前触及执行时间边界。大型网站可能需要后续异步扫描版本。",
    errorGeneric:
      "无法为该网站采集安全的公开抓取结果。请确认网站可公开访问后重试。",
    sourceUnavailable: "没有观测到来源页面",
    anchorUnavailable: "未记录锚文本",
    actualScope: "静态 HTML · 同源 · 临时共享抓取缓存 · 不保存提交者身份",
  },
} as const;

type ToolCopy = (typeof COPY)[keyof typeof COPY];

/**
 * 节点外圈是「同色但更醒目一档」。深色主题里那一档是更亮，浅色主题里是更暗，
 * 所以不能写死一个更亮的 hex——把填充色朝正文色混就够了：正文色在深色下接近
 * 白、在浅色下接近黑，同一个配方在两套主题里自动走对方向。
 */
const halo = (token: string) =>
  `color-mix(in oklab, var(${token}) 65%, var(--sc-text-primary))`;

const STYLE: Record<
  InternalLinkAuditNode["kind"],
  { fill: string; ring: string }
> = {
  home: { fill: "var(--sc-text-primary)", ring: "var(--sc-text-primary)" },
  page: { fill: "var(--sc-accent)", ring: "var(--sc-accent-hover)" },
  deep: { fill: "var(--sc-warning)", ring: halo("--sc-warning") },
  unreachable: { fill: "var(--sc-error)", ring: halo("--sc-error") },
  orphan_candidate: { fill: "var(--sc-error)", ring: halo("--sc-error") },
  // Deliberately not the orphan red: the crawl stopped early, so this node is
  // a question, not a finding.
  orphan_undetermined: {
    fill: "var(--sc-text-faint)",
    ring: "var(--sc-text-secondary)",
  },
  unresolved_target: {
    fill: "var(--sc-text-secondary)",
    ring: "var(--sc-text-strong)",
  },
};

function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function displayPathSegment(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const segment = segments.at(-1);
    if (!segment) return "/";
    return `${segment}${parsed.search}`;
  } catch {
    return url;
  }
}

function displayClickDepth(
  node: InternalLinkAuditNode,
  copy: ToolCopy,
): string {
  return node.clickDepth === null ? copy.notReachable : String(node.clickDepth);
}

function inboundTone(inboundLinks: number): string {
  if (inboundLinks === 0) return "text-brand-error";
  if (inboundLinks <= 2) return "text-brand-warning";
  return "text-text-dark-secondary";
}

function errorMessage(
  code: string,
  copy: ToolCopy,
  locale: InternalLinkAuditLocale,
  retryAfterHeader: string | null,
): string {
  if (code === "invalid_url" || code === "invalid_request")
    return copy.errorInvalid;
  if (code === "rate_limited" || code === "target_busy") {
    const base = code === "target_busy" ? copy.errorTargetBusy : copy.errorRate;
    const retry = retryAfterMessage(retryAfterHeader, locale);
    return retry ? `${base} ${retry}` : base;
  }
  if (code === "quota_unavailable") {
    const retry = retryAfterMessage(retryAfterHeader, locale);
    return retry
      ? `${copy.errorQuotaUnavailable} ${retry}`
      : copy.errorQuotaUnavailable;
  }
  if (code === "robots_disallowed") return copy.errorRobotsDisallowed;
  if (code === "robots_unreachable") return copy.errorRobotsUnreachable;
  if (code === "scan_in_progress") return copy.errorProgress;
  if (code === "scan_timeout") return copy.errorTimeout;
  return copy.errorGeneric;
}

function TreeNodeRow({
  childrenById,
  collapsedIds,
  copy,
  forceExpanded,
  level,
  matchIds,
  nodeById,
  nodeId,
  onSelect,
  onToggle,
  parentRelationById,
  secondaryInboundById,
  selectedNodeId,
  visibleIds,
}: {
  readonly childrenById: InternalLinkAuditTreeModel["childrenById"];
  readonly collapsedIds: ReadonlySet<string>;
  readonly copy: ToolCopy;
  readonly forceExpanded: boolean;
  readonly level: number;
  readonly matchIds: ReadonlySet<string>;
  readonly nodeById: ReadonlyMap<string, InternalLinkAuditNode>;
  readonly nodeId: string;
  readonly onSelect: (nodeId: string) => void;
  readonly onToggle: (nodeId: string) => void;
  readonly parentRelationById: InternalLinkAuditTreeModel["parentRelationById"];
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
  const parentRelation = parentRelationById.get(node.id);
  const secondaryInbound = secondaryInboundById.get(node.id) ?? 0;
  const hasChildren = children.length > 0;
  const expanded = forceExpanded || !collapsedIds.has(node.id);
  const visuallyIndented = level > 1 && level <= MAX_VISUAL_TREE_LEVEL;
  const visiblePath =
    level === 1
      ? displayPath(node.url)
      : `${level > MAX_VISUAL_TREE_LEVEL ? "…/" : ""}${displayPathSegment(
          node.url,
        )}`;
  const branchLabel = `${
    expanded ? copy.collapseBranch : copy.expandBranch
  }: ${displayPath(node.url)}`;

  return (
    <li
      className={`relative ${
        visuallyIndented
          ? "before:absolute before:-left-3 before:top-6 before:w-3 before:border-t before:border-brand-border-strong sm:before:-left-5 sm:before:w-5"
          : ""
      }`}
    >
      <div
        className={`group flex min-h-12 w-full items-stretch overflow-hidden rounded-[11px] border-l-2 transition-colors ${
          selected
            ? "border-brand-accent bg-brand-accent/[0.10]"
            : level === 1
              ? "border-brand-accent/55 bg-brand-accent/[0.05] hover:bg-brand-accent/[0.08]"
              : "border-brand-border-strong bg-brand-panel-raised hover:bg-hover-wash"
        } ${directMatch ? "opacity-100" : "opacity-55"}`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={branchLabel}
            disabled={forceExpanded}
            onClick={() => onToggle(node.id)}
            className="flex w-10 shrink-0 items-center justify-center border-r border-brand-border text-text-dark-secondary transition-colors hover:bg-hover-wash hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-dark-secondary"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="relative w-10 shrink-0 border-r border-brand-border after:absolute after:left-1/2 after:top-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-brand-border-strong"
          />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-pressed={selected}
          data-testid={`internal-link-node-${node.id}`}
          className="grid min-h-12 min-w-0 flex-1 grid-cols-1 items-center gap-x-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent sm:grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem]"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full border-2"
              style={{
                backgroundColor: nodeStyle.fill,
                borderColor: selected
                  ? "var(--sc-text-primary)"
                  : nodeStyle.ring,
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="sr-only">{displayPath(node.url)}. </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <strong
                  aria-hidden="true"
                  className="min-w-0 break-words font-mono text-[12.5px] font-medium leading-5 text-text-dark-primary sm:text-[13px]"
                  title={displayPath(node.url)}
                >
                  {visiblePath}
                </strong>
                {node.kind !== "page" ? (
                  <span className="rounded border border-brand-border-strong px-1.5 py-px font-mono text-[9px] tracking-[0.08em] text-text-dark-secondary uppercase">
                    {copy[node.kind]}
                  </span>
                ) : null}
                {parentRelation === "observed_link" ? (
                  <span className="inline-flex items-center gap-1 rounded border border-brand-accent/30 bg-brand-accent/[0.08] px-1.5 py-px font-mono text-[9px] tracking-[0.08em] text-brand-accent-text uppercase">
                    <Link2 aria-hidden="true" className="size-2.5" />
                    {copy.linkGrouped}
                  </span>
                ) : null}
                {secondaryInbound > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-brand-accent-2"
                    title={`${secondaryInbound} ${copy.additionalInbound}`}
                  >
                    <GitBranch aria-hidden="true" className="size-3" />+
                    {secondaryInbound}
                    <span className="sr-only"> {copy.additionalInbound}</span>
                  </span>
                ) : null}
              </span>
              {node.title && node.title !== visiblePath ? (
                <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-text-dark-secondary">
                  {node.title}
                </span>
              ) : null}
              <span className="mt-1 flex items-center gap-3 font-mono text-[10px] leading-4 text-text-dark-secondary sm:hidden">
                <span className={inboundTone(node.inboundLinks)}>
                  {copy.inbound} {node.inboundLinks}
                </span>
                <span>
                  {copy.outbound} {node.outboundLinks}
                </span>
                <span>
                  {copy.depthLabel} {displayClickDepth(node, copy)}
                </span>
              </span>
            </span>
            {hasChildren ? (
              <span
                aria-hidden="true"
                className="shrink-0 rounded bg-chip-wash px-1.5 py-0.5 font-mono text-[9px] text-text-dark-secondary"
              >
                {children.length}
              </span>
            ) : null}
          </span>
          <span
            className={`hidden text-center font-mono text-[11px] sm:block ${inboundTone(node.inboundLinks)}`}
          >
            <span className="sr-only">{copy.inbound} </span>
            {node.inboundLinks}
          </span>
          <span className="hidden text-center font-mono text-[11px] text-text-dark-secondary sm:block">
            <span className="sr-only">{copy.outbound} </span>
            {node.outboundLinks}
          </span>
          <span className="hidden text-center font-mono text-[11px] text-text-dark-secondary sm:block">
            <span className="sr-only">{copy.depthLabel} </span>
            {displayClickDepth(node, copy)}
          </span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul
          className={
            level < MAX_VISUAL_TREE_LEVEL
              ? "ml-3 mt-1.5 space-y-1.5 border-l border-brand-border-strong pl-3 sm:ml-5 sm:pl-5"
              : "mt-1.5 space-y-1.5"
          }
        >
          {children.map((childId) => (
            <TreeNodeRow
              key={childId}
              childrenById={childrenById}
              collapsedIds={collapsedIds}
              copy={copy}
              forceExpanded={forceExpanded}
              level={level + 1}
              matchIds={matchIds}
              nodeById={nodeById}
              nodeId={childId}
              onSelect={onSelect}
              onToggle={onToggle}
              parentRelationById={parentRelationById}
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
  const [filter, setFilter] = useState<TreeFilter>(() =>
    report.findings.length > 0 ? "attention" : "all",
  );
  const [query, setQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const tree = useMemo(() => buildInternalLinkAuditTree(report), [report]);
  const nodeById = useMemo(
    () => new Map(report.nodes.map((node) => [node.id, node])),
    [report.nodes],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const attentionIds = useMemo(
    () => new Set(report.findings.flatMap((finding) => finding.nodeIds)),
    [report.findings],
  );
  const matchIds = useMemo(
    () =>
      new Set(
        report.nodes
          .filter(
            (node) =>
              filter === "all" ||
              (filter === "attention"
                ? attentionIds.has(node.id)
                : node.kind === filter),
          )
          .filter((node) => {
            if (!normalizedQuery) return true;
            return `${displayPath(node.url)} ${node.title ?? ""}`
              .toLocaleLowerCase()
              .includes(normalizedQuery);
          })
          .map((node) => node.id),
      ),
    [attentionIds, filter, normalizedQuery, report.nodes],
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
    ["attention", copy.attention],
    ["all", copy.all],
    ["home", copy.home],
    ["orphan_candidate", copy.orphan_candidate],
    ["orphan_undetermined", copy.orphan_undetermined],
    ["unreachable", copy.unreachable],
    ["deep", copy.deep],
    ["page", copy.page],
  ];
  const connectedRoots = tree.roots.filter(
    (id) => nodeById.get(id)?.kind === "home" && visibleIds.has(id),
  );
  const unlinkedRoots = tree.roots.filter(
    (id) => nodeById.get(id)?.kind !== "home" && visibleIds.has(id),
  );
  const expandableIds = useMemo(
    () =>
      new Set(
        [...tree.childrenById.entries()]
          .filter(([, children]) => children.length > 0)
          .map(([id]) => id),
      ),
    [tree.childrenById],
  );
  const forceExpanded = filter !== "all" || Boolean(normalizedQuery);

  function toggleBranch(nodeId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <div className="rounded-card border border-brand-border-card bg-brand-panel">
      <div className="border-b border-brand-border p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
            <FolderTree aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
              {copy.tree}
            </h3>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-[1.6] text-text-dark-secondary">
              {copy.treeBody}
            </p>
          </div>
        </div>
        <label className="relative mt-4 block">
          <span className="sr-only">{copy.treeSearch}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-brand-accent"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.treeSearchPlaceholder}
            className="h-12 w-full rounded-[10px] border border-brand-border-strong bg-brand-bg pl-10 pr-11 font-mono text-[13.5px] text-text-dark-primary outline-none transition-colors placeholder:text-text-dark-secondary focus-visible:border-brand-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          />
          {query ? (
            <button
              type="button"
              aria-label={copy.clearSearch}
              onClick={() => setQuery("")}
              className="absolute right-0 top-0 flex size-12 items-center justify-center text-text-dark-secondary transition-colors hover:text-text-dark-primary"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.06em] uppercase transition-colors ${filter === value ? "border-brand-accent/50 bg-brand-accent/12 text-brand-accent-text" : "border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/50 hover:text-text-dark-primary"}`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto flex min-h-11 items-center gap-1">
            <button
              type="button"
              disabled={forceExpanded}
              onClick={() => setCollapsedIds(new Set())}
              className="min-h-9 rounded-[8px] px-2.5 font-mono text-[10px] tracking-[0.06em] text-text-dark-secondary uppercase transition-colors hover:bg-hover-wash hover:text-text-dark-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-dark-secondary"
            >
              {copy.expandAll}
            </button>
            <button
              type="button"
              disabled={forceExpanded}
              onClick={() => setCollapsedIds(new Set(expandableIds))}
              className="min-h-9 rounded-[8px] px-2.5 font-mono text-[10px] tracking-[0.06em] text-text-dark-secondary uppercase transition-colors hover:bg-hover-wash hover:text-text-dark-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-dark-secondary"
            >
              {copy.collapseAll}
            </button>
            <span className="ml-1 font-mono text-[10.5px] text-text-dark-secondary">
              {matchIds.size}/{report.nodes.length} {copy.treeMatches}
            </span>
          </div>
        </div>
      </div>
      <div className="p-3 sm:p-5">
        {matchIds.size ? (
          <div
            className="max-h-[720px] overflow-y-auto overscroll-contain pr-1"
            data-testid="internal-link-tree"
          >
            <div
              aria-hidden="true"
              className="mb-2 hidden items-center border-b border-brand-border-faint pb-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-text-dark-secondary sm:flex"
            >
              <span className="w-10 shrink-0" />
              <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem] items-center px-3">
                <span>{copy.pageColumn}</span>
                <span className="text-center">{copy.inbound}</span>
                <span className="text-center">{copy.outbound}</span>
                <span className="text-center">{copy.depthColumn}</span>
              </span>
            </div>
            {connectedRoots.length ? (
              <section aria-labelledby="internal-link-tree-connected">
                <h4
                  id="internal-link-tree-connected"
                  className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-accent-text"
                >
                  {copy.connectedBranch}
                </h4>
                <ul
                  aria-labelledby="internal-link-tree-connected"
                  className="space-y-2"
                >
                  {connectedRoots.map((rootId) => (
                    <TreeNodeRow
                      key={rootId}
                      childrenById={tree.childrenById}
                      collapsedIds={collapsedIds}
                      copy={copy}
                      forceExpanded={forceExpanded}
                      level={1}
                      matchIds={matchIds}
                      nodeById={nodeById}
                      nodeId={rootId}
                      onSelect={onSelect}
                      onToggle={toggleBranch}
                      parentRelationById={tree.parentRelationById}
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
                className={
                  connectedRoots.length
                    ? "mt-6 border-t border-brand-border pt-5"
                    : ""
                }
              >
                <h4
                  id="internal-link-tree-unlinked"
                  className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-warning"
                >
                  {copy.unlinkedBranch}
                </h4>
                <p className="mt-1.5 max-w-2xl text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {copy.unlinkedBody}
                </p>
                <ul
                  aria-labelledby="internal-link-tree-unlinked"
                  className="mt-3 space-y-2"
                >
                  {unlinkedRoots.map((rootId) => (
                    <TreeNodeRow
                      key={rootId}
                      childrenById={tree.childrenById}
                      collapsedIds={collapsedIds}
                      copy={copy}
                      forceExpanded={forceExpanded}
                      level={1}
                      matchIds={matchIds}
                      nodeById={nodeById}
                      nodeId={rootId}
                      onSelect={onSelect}
                      onToggle={toggleBranch}
                      parentRelationById={tree.parentRelationById}
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
            className="rounded-[12px] border border-dashed border-brand-border-dashed px-4 py-8 text-center text-[13px] text-text-dark-secondary"
            data-testid="internal-link-tree-empty"
          >
            {copy.noTreeMatches}
          </p>
        )}
        <p className="mt-4 border-t border-brand-border pt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-dark-secondary">
          {copy.actualScope}
        </p>
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
  readonly finding:
    | InternalLinkAuditPayload["result"]["findings"][number]
    | null;
  readonly node: InternalLinkAuditNode;
}) {
  return (
    <aside
      className="rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[22px] shadow-rail-accent xl:sticky xl:top-24"
      aria-live="polite"
      data-testid="internal-link-node-detail"
    >
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-accent-text">
        {finding ? copy.selectedFinding : copy.selected}
      </p>
      {finding ? (
        <>
          <h3 className="mt-2 text-[15.5px] font-semibold leading-6 text-text-dark-primary">
            {finding.title}
          </h3>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
            {finding.detail}
          </p>
          <p className="mt-5 border-t border-brand-border pt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.pageContext}
          </p>
        </>
      ) : null}
      <h3 className="mt-2 break-all font-mono text-[14.5px] font-semibold leading-6 text-text-dark-primary">
        {displayPath(node.url)}
      </h3>
      <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {node.title ?? node.url}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-brand-border pt-5 text-[13px]">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.inbound}
          </dt>
          <dd className="mt-1 font-mono text-text-dark-primary">
            {node.inboundLinks}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.outbound}
          </dt>
          <dd className="mt-1 font-mono text-text-dark-primary">
            {node.outboundLinks}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.depthLabel}
          </dt>
          <dd className="mt-1 font-mono text-text-dark-primary">
            {displayClickDepth(node, copy)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.crawlDepthLabel}
          </dt>
          <dd className="mt-1 font-mono text-text-dark-primary">
            {node.crawlDepth}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.sitemapLabel}
          </dt>
          <dd className="mt-1 font-mono text-text-dark-primary">
            {node.sitemapMember ? copy.yes : copy.no}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.robotsLabel}
          </dt>
          <dd className="mt-1 font-mono text-text-dark-primary">
            {node.robotsIndexable ? copy.yes : copy.no}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
            {copy.canonicalLabel}
          </dt>
          <dd className="mt-1 break-all font-mono text-text-dark-primary">
            {node.canonicalTarget ?? copy.no}
          </dd>
        </div>
      </dl>
      {finding ? (
        <div className="mt-5 space-y-4 border-t border-brand-border pt-5 text-[12.5px] leading-[1.6]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
              {copy.evidence}
            </p>
            <p className="mt-1 text-text-dark-primary">{finding.evidence}</p>
          </div>
          {/* limitation 走共享的 LimitationHint（折叠式披露），其余三格是普通字段 */}
          <LimitationHint
            label={copy.limitation}
            limitations={[finding.limitation]}
          />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
              {copy.source}
            </p>
            <p className="mt-1 break-all font-mono text-text-dark-primary">
              {finding.suggestedSourceUrl ?? copy.sourceUnavailable}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
              {copy.anchor}
            </p>
            <p className="mt-1 text-text-dark-primary">
              {finding.observedAnchorText ?? copy.anchorUnavailable}
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function FindingsList({
  copy,
  findings,
  selectedFindingId,
  onSelect,
}: {
  readonly copy: ToolCopy;
  readonly findings: InternalLinkAuditPayload["result"]["findings"];
  readonly selectedFindingId: string | null;
  readonly onSelect: (
    finding: InternalLinkAuditPayload["result"]["findings"][number],
  ) => void;
}) {
  return (
    <section className="rounded-card border border-brand-border-card bg-brand-panel p-[22px]">
      <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
        {copy.findings}
      </h3>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-text-dark-secondary">
        {copy.findingsBody}
      </p>
      {findings.length === 0 ? (
        <p className="mt-5 text-[13px] text-text-dark-secondary">
          {copy.noFindings}
        </p>
      ) : (
        <div className="mt-5 grid gap-2 lg:grid-cols-2">
          {findings.map((finding) => {
            const selected = selectedFindingId === finding.id;
            return (
              <button
                key={finding.id}
                type="button"
                onClick={() => onSelect(finding)}
                aria-pressed={selected}
                data-testid={`internal-link-finding-${finding.id}`}
                className={`min-h-16 rounded-[11px] border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent ${
                  selected
                    ? "border-brand-accent/50 bg-brand-accent/[0.08] shadow-rail-accent"
                    : "border-brand-border bg-brand-panel-raised hover:border-brand-accent/40"
                }`}
              >
                <span className="flex gap-3">
                  <span className="h-fit rounded bg-brand-warning/15 px-2 py-[3px] font-mono text-[10.5px] tracking-[0.08em] text-brand-warning uppercase">
                    {finding.priority}
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-[13.5px] font-medium leading-5 text-text-dark-primary">
                      {finding.title}
                    </strong>
                    <small className="mt-1 block text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {finding.detail}
                    </small>
                    <small className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-dark-secondary">
                      <span>
                        {finding.affectedUrls.length} {copy.affectedPages}
                      </span>
                      <span>
                        {copy.confidence}: {copy[finding.confidence]}
                      </span>
                      <span>
                        {copy.impact}: {copy[finding.impact]}
                      </span>
                    </small>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function InternalLinkAuditTool({
  locale: localeValue,
}: InternalLinkAuditToolProps) {
  const locale: InternalLinkAuditLocale = localeValue === "zh" ? "zh" : "en";
  const copy = COPY[locale];
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [payload, setPayload] = useState<InternalLinkAuditPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    null,
  );
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (phase === "result") resultHeadingRef.current?.focus();
  }, [phase]);
  useEffect(() => {
    if (phase !== "running") return;
    const first = window.setTimeout(() => setStage(1), 800);
    const second = window.setTimeout(() => setStage(2), 2200);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [phase]);
  const report = payload?.result ?? null;
  const selectedNode =
    report?.nodes.find((node) => node.id === selectedNodeId) ??
    report?.nodes[0] ??
    null;
  const selectedFinding =
    report?.findings.find((finding) => finding.id === selectedFindingId) ??
    null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    trackMarketingEvent("tool_start", { tool_name: "internal_link_audit" });
    setError(null);
    setPayload(null);
    setSelectedFindingId(null);
    setPhase("running");
    setStage(0);
    try {
      const response = await fetch("/api/tools/internal-link-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: InternalLinkAuditPayload;
        error?: { code?: string };
      } | null;
      if (!response.ok || !body?.data) {
        setError(
          errorMessage(
            body?.error?.code ?? "scan_failed",
            copy,
            locale,
            response.headers.get("Retry-After"),
          ),
        );
        setPhase("error");
        return;
      }
      const initialNodeId = body.data.result.nodes[0]?.id ?? null;
      setPayload(body.data);
      setSelectedNodeId(initialNodeId);
      setSelectedFindingId(
        body.data.result.findings.find((finding) =>
          initialNodeId ? finding.nodeIds.includes(initialNodeId) : false,
        )?.id ?? null,
      );
      setPhase("result");
      trackMarketingEvent("tool_complete", {
        tool_name: "internal_link_audit",
      });
    } catch {
      setError(copy.errorGeneric);
      setPhase("error");
    }
  }
  const metricItems = report
    ? ([
        [copy.mapped, String(report.pagesCrawled), Waypoints],
        [copy.links, String(report.linksObserved), Link2],
        [
          copy.sitemap,
          report.sitemapFetched ? String(report.sitemapUrlsObserved) : "—",
          Network,
        ],
      ] as const)
    : [];

  return (
    <section
      id="internal-link-audit-tool"
      aria-busy={phase === "running"}
      className="scroll-mt-24"
      data-testid="internal-link-audit-tool"
    >
      <div className="relative overflow-hidden rounded-card border border-brand-border-card bg-brand-panel p-5 md:p-7">
        <form
          onSubmit={handleSubmit}
          className="relative grid gap-2.5 md:grid-cols-[1fr_auto] md:items-end"
        >
          <label className="block">
            <span
              id="internal-link-url-label"
              className="mb-2 block font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary"
            >
              {copy.label}
            </span>
            <span className="flex h-12.5 items-center gap-2.5 rounded-[10px] border border-brand-border-strong bg-brand-bg px-4 transition-colors focus-within:border-brand-accent/70">
              <Link2
                aria-hidden="true"
                className="size-[15px] shrink-0 text-brand-accent"
              />
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
                className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={phase === "running"}
            className="inline-flex h-12.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-5.5 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta disabled:cursor-wait disabled:opacity-70 disabled:shadow-none"
          >
            {phase === "running" ? copy.running : copy.start}
            {phase === "running" ? (
              <ScanLine
                aria-hidden="true"
                className="size-4 animate-pulse motion-reduce:animate-none"
              />
            ) : (
              <ArrowRight aria-hidden="true" className="size-4" />
            )}
          </button>
        </form>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-[10px] border border-brand-error/25 bg-brand-error/[0.08] px-4 py-3 text-[13px] leading-[1.6] text-brand-error"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 grid gap-2 border-t border-brand-border pt-4 text-[12.5px] leading-[1.6] text-text-dark-secondary md:grid-cols-2">
          <p>{copy.help}</p>
          <p>{copy.scope}</p>
        </div>
      </div>

      {phase === "running" ? (
        <div
          className="mt-5 rounded-card border border-brand-border-card bg-brand-panel p-5"
          role="status"
          aria-live="polite"
          data-testid="internal-link-progress"
        >
          <div className="mb-4 flex items-center justify-between">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-accent-text">
              {copy.running}
            </p>
            <span className="font-mono text-[10.5px] text-text-dark-secondary">
              0{stage + 1}/03
            </span>
          </div>
          <ol className="grid gap-2 md:grid-cols-3">
            {copy.progress.map((item, index) => (
              <li
                key={item}
                className={`rounded-[10px] border px-3.5 py-3 text-[12.5px] ${
                  index <= stage
                    ? "border-brand-accent/40 bg-brand-accent/[0.08] text-text-dark-primary"
                    : "border-brand-border text-text-dark-secondary"
                }`}
              >
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {report && phase === "result" ? (
        <div
          className="mt-6 space-y-4"
          data-testid="internal-link-audit-result"
        >
          <div className="overflow-hidden rounded-card border border-brand-border-card bg-brand-panel">
            <div className="grid gap-5 border-b border-brand-border p-5 md:grid-cols-[1.3fr_0.7fr] md:p-7">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brand-accent-text">
                  {copy.result}
                </p>
                <h2
                  ref={resultHeadingRef}
                  tabIndex={-1}
                  className="mt-3 text-[25px] font-semibold leading-tight tracking-[-0.03em] text-text-dark-primary outline-none md:text-[28px]"
                >
                  {report.availability === "partial"
                    ? copy.partial
                    : copy.available}
                </h2>
                <p className="mt-3 text-[15.5px] leading-[1.65] text-text-dark-primary">
                  {actionSummary(report, locale)}
                </p>
                <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {coverageSummary(report, locale)}
                </p>
              </div>
              <div className="rounded-row border border-brand-border bg-brand-panel-sunken px-4 py-3.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
                  {report.availability === "partial"
                    ? copy.stopLabel
                    : copy.completeLabel}
                </p>
                <p className="mt-2 text-[15.5px] font-semibold leading-6 text-text-dark-primary">
                  {report.availability === "partial"
                    ? stopReasonLabel(report.stopReason, locale)
                    : copy.completeReason}
                </p>
                <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {report.availability === "partial"
                    ? copy.partialBody
                    : copy.completeBody}
                </p>
              </div>
            </div>
            {/* 指标格：1px gap + 分隔色底的伪表格 */}
            <div className="grid gap-px bg-brand-border-card md:grid-cols-[0.8fr_1.2fr]">
              <div className="bg-brand-panel-sunken p-5 md:p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
                  {copy.attention}
                </p>
                <p className="mt-3 font-mono text-[34px] leading-none text-text-dark-primary">
                  {report.actionablePages}
                </p>
              </div>
              <div className="bg-brand-panel-sunken p-5 md:p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
                  {copy.depthDistribution}
                </p>
                <dl className="mt-3 grid grid-cols-5 gap-2">
                  {[
                    [copy.oneClick, report.clickDepthDistribution.oneClick],
                    [copy.twoClicks, report.clickDepthDistribution.twoClicks],
                    [
                      copy.threeClicks,
                      report.clickDepthDistribution.threeClicks,
                    ],
                    [
                      copy.fourPlusClicks,
                      report.clickDepthDistribution.fourPlusClicks,
                    ],
                    [
                      copy.unreachableCount,
                      report.clickDepthDistribution.unreachable,
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="font-mono text-[9.5px] leading-4 tracking-[0.06em] text-text-dark-secondary uppercase">
                        {label}
                      </dt>
                      <dd className="mt-1.5 font-mono text-[20px] text-text-dark-primary">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            {/*
             * 这是指标表的第二行，和上一行是两个独立的 grid（列结构不同：0.8/1.2 对
             * 三等分），所以 gap-px 画不出它们之间的横线——两个 grid 是紧挨着的，中间
             * 没有 1px 缝隙可以透出底色。显式补一条，用卡片内横线那一档，和下方脚注
             * 的上边线同色。
             */}
            <dl className="grid grid-cols-1 gap-px border-t border-brand-border bg-brand-border-card sm:grid-cols-3">
              {metricItems.map(([label, value, Icon]) => (
                <div key={label} className="bg-brand-panel-sunken p-4 md:p-5">
                  <dt className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-dark-secondary">
                    <span>{label}</span>
                    <Icon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-brand-accent"
                    />
                  </dt>
                  <dd
                    className="mt-3 font-mono text-[22px] leading-none text-text-dark-primary"
                    data-testid={
                      label === copy.mapped
                        ? "internal-link-pages-collected"
                        : undefined
                    }
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-brand-border bg-brand-panel-sunken px-5 py-3.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
              {report.nodes.filter((node) => !node.sitemapMember).length}{" "}
              {copy.sitemapGap}
            </p>
          </div>

          <FindingsList
            copy={copy}
            findings={report.findings}
            selectedFindingId={selectedFindingId}
            onSelect={(finding) => {
              setSelectedNodeId(finding.nodeId);
              setSelectedFindingId(finding.id);
            }}
          />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <LinkTree
              report={report}
              copy={copy}
              selectedNodeId={selectedNode?.id ?? ""}
              onSelect={(nodeId) => {
                setSelectedNodeId(nodeId);
                setSelectedFindingId(
                  report.findings.find((finding) =>
                    finding.nodeIds.includes(nodeId),
                  )?.id ?? null,
                );
              }}
            />
            {selectedNode ? (
              <NodeDetail
                node={selectedNode}
                finding={selectedFinding}
                copy={copy}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
