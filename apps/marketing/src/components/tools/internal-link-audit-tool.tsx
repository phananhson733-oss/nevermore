// @input  -- locale and a visitor's public website URL
// @output -- transient, synchronous real crawl report; no fixed result fixture
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
  coverageSummary,
  retryAfterMessage,
  stopReasonLabel,
} from "./internal-link-audit-result-copy";
import {
  buildInternalLinkAuditTree,
  type InternalLinkAuditTreeModel,
} from "./internal-link-audit-tree";

type Phase = "idle" | "running" | "result" | "error";
type TreeFilter = "all" | InternalLinkAuditNode["kind"];
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
    help: "We start from the submitted public URL, follow same-origin static HTML links, respect robots.txt, and do not store your URL or page content.",
    scope: "No normal-use scan quota · collects as much as this online run can safely process · no login required",
    progress: ["Checking robots and sitemap", "Following same-origin HTML links", "Building the page hierarchy"],
    result: "Internal link structure report",
    partial: "Report ready · partial coverage",
    available: "Report ready",
    stopLabel: "Why collection stopped",
    completeLabel: "Collection status",
    completeReason: "Completed within the safety limits",
    completeBody: "The crawl finished without reaching an early-stop boundary.",
    partialBody: "The collected pages and evidence remain available for review.",
    mapped: "Pages collected",
    links: "HTML links observed",
    sitemap: "Sitemap URLs observed",
    fixes: "Prioritized findings",
    tree: "Site page hierarchy",
    treeBody: "Indentation follows the collected URL path where possible. When a path parent was not collected, the row is explicitly labeled as grouped under an observed shallower inbound page. Cross-links remain visible in the mapped-inbound badge and link counts.",
    treeSearch: "Find a page in this crawl",
    treeSearchPlaceholder: "Search URL or page title",
    clearSearch: "Clear tree search",
    connectedBranch: "Page hierarchy",
    unlinkedBranch: "Outside the main hierarchy",
    unlinkedBody: "Each branch starts with a page that has no eligible collected URL-path or shallower link parent. Descendants may still have observed inbound links, shown on each row.",
    treeMatches: "pages match",
    noTreeMatches: "No collected page matches this filter and search.",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    expandBranch: "Expand branch",
    collapseBranch: "Collapse branch",
    pageColumn: "Page",
    depthColumn: "Crawl depth",
    additionalInbound: "other mapped inbound link(s)",
    pathGrouped: "URL path",
    linkGrouped: "Observed link",
    all: "All pages",
    home: "Homepage",
    orphan_candidate: "Orphan candidates",
    orphan_undetermined: "Inbound links unchecked",
    deep: "Deep pages",
    page: "Other pages",
    unresolved_target: "Unresolved targets",
    selected: "Selected page",
    selectedFinding: "Selected finding",
    pageContext: "Collected source-page context",
    inbound: "Inbound",
    outbound: "Outbound",
    depthLabel: "Crawl depth",
    sitemapLabel: "Sitemap",
    yes: "yes",
    no: "no",
    evidence: "Observed evidence",
    limitation: "Interpretation limit",
    source: "Observed source page",
    anchor: "Observed anchor text",
    findings: "Prioritized review list",
    findingsBody: "These are editorial review prompts, not automatic changes. Verify important findings after any site or navigation update.",
    noFindings: "No prioritized structural candidates were found in the pages collected by this run.",
    errorInvalid: "Enter a publicly reachable HTTP(S) domain. Local, IP-literal, credentialed, and reserved addresses are not accepted.",
    errorRate: "This network has run several crawls recently. Each one fetches hundreds of pages from the target site, so there is an hourly ceiling.",
    errorTargetBusy: "This site has been crawled several times in the last hour, by you or by someone else. The limit protects the site being audited from repeated automated traffic.",
    errorRobotsDisallowed: "This site's robots.txt asks crawlers not to fetch its pages, so nothing was crawled. That is the site owner's choice and says nothing about the site's link structure.",
    errorRobotsUnreachable: "This site's robots.txt could not be read, so nothing was crawled. A crawler that cannot read the rules has to assume it is not allowed.",
    errorQuotaUnavailable: "The usage-limit service is unavailable, so this crawl was not started. The tool fetches hundreds of pages from the target site and will not run without a working limit.",
    errorProgress: "An audit for this browser address is already running. Please wait for it to finish.",
    errorTimeout: "The synchronous crawl reached its execution-time boundary before a report could be returned. Large sites may need a future asynchronous scan.",
    errorGeneric: "We could not collect a safe public crawl result for that site. Check that it is publicly reachable and try again.",
    sourceUnavailable: "No observed source page",
    anchorUnavailable: "No anchor text recorded",
    actualScope: "Static HTML · same origin · transient request · no stored report",
  },
  zh: {
    label: "网站 URL",
    placeholder: "yourdomain.com",
    start: "开始内链审计",
    running: "正在抓取公开静态 HTML…",
    help: "工具从提交的公开 URL 开始，跟随同源静态 HTML 链接、遵守 robots.txt，不保存 URL 或页面内容。",
    scope: "不设置日常检测次数配额 · 在单次在线处理能力内尽可能采集 · 无需登录",
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
    fixes: "优先发现",
    tree: "网站页面层级树",
    treeBody: "缩进优先表示本次采集到的 URL 路径层级；路径父页未被采集时，会明确标记为归入已观测到的浅层内链父页。交叉内链仍显示在已映射入链标记和链接计数中。",
    treeSearch: "在本次抓取中查找页面",
    treeSearchPlaceholder: "搜索 URL 或页面标题",
    clearSearch: "清空树状视图搜索",
    connectedBranch: "页面主层级",
    unlinkedBranch: "主层级之外",
    unlinkedBody: "每个分支的起点都没有符合条件的已采集 URL 路径父页或浅层内链父页；其后代页面仍可能有已观测入链，并显示在各自行中。",
    treeMatches: "个页面匹配",
    noTreeMatches: "没有页面同时符合当前筛选和搜索条件。",
    expandAll: "全部展开",
    collapseAll: "全部收起",
    expandBranch: "展开分支",
    collapseBranch: "收起分支",
    pageColumn: "页面",
    depthColumn: "抓取深度",
    additionalInbound: "条其他已映射入链",
    pathGrouped: "URL 层级",
    linkGrouped: "内链父页",
    all: "全部页面",
    home: "首页",
    orphan_candidate: "候选孤岛",
    orphan_undetermined: "入链未验证",
    deep: "深层页面",
    page: "其他页面",
    unresolved_target: "未验证目标",
    selected: "已选页面",
    selectedFinding: "已选发现",
    pageContext: "已采集来源页上下文",
    inbound: "入链",
    outbound: "出链",
    depthLabel: "抓取深度",
    sitemapLabel: "Sitemap",
    yes: "是",
    no: "否",
    evidence: "观测证据",
    limitation: "解释边界",
    source: "观测到的来源页",
    anchor: "观测到的锚文本",
    findings: "优先复核清单",
    findingsBody: "这些是编辑复核提示，而不是自动改动。网站或导航更新后，请复核重要发现。",
    noFindings: "本次已采集页面中未发现需要优先处理的结构候选项。",
    errorInvalid: "请输入可公开访问的 HTTP(S) 域名。不接受本地地址、IP 地址、带凭据或保留地址。",
    errorRate: "该网络最近已发起多次抓取。每次都会从目标站点获取数百个页面，因此设有每小时上限。",
    errorTargetBusy: "这个站点在过去一小时内已被抓取多次（可能来自你，也可能来自其他人）。该限制用于保护被审计的站点免受重复的自动化流量。",
    errorRobotsDisallowed: "该站点的 robots.txt 要求爬虫不要抓取其页面，因此没有抓取任何内容。这是站点所有者的选择，与该站的链接结构无关。",
    errorRobotsUnreachable: "该站点的 robots.txt 无法读取，因此没有抓取任何内容。读不到规则的爬虫必须假定自己不被允许。",
    errorQuotaUnavailable: "用量限制服务当前不可用，因此本次抓取没有启动。该工具会从目标站点获取数百个页面，在限制不可用时不会运行。",
    errorProgress: "该浏览器地址已有一次审计正在进行，请等待它完成。",
    errorTimeout: "同步抓取在返回报告前触及执行时间边界。大型网站可能需要后续异步扫描版本。",
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
  // Deliberately not the orphan red: the crawl stopped early, so this node is
  // a question, not a finding.
  orphan_undetermined: { fill: "#8A8279", ring: "#B8AFA4" },
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

function errorMessage(
  code: string,
  copy: ToolCopy,
  locale: InternalLinkAuditLocale,
  retryAfterHeader: string | null,
): string {
  if (code === "invalid_url" || code === "invalid_request") return copy.errorInvalid;
  if (code === "rate_limited" || code === "target_busy") {
    const base =
      code === "target_busy" ? copy.errorTargetBusy : copy.errorRate;
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
  const visuallyIndented =
    level > 1 && level <= MAX_VISUAL_TREE_LEVEL;
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
          ? "before:absolute before:-left-3 before:top-6 before:w-3 before:border-t before:border-brand-accent/45 sm:before:-left-5 sm:before:w-5"
          : ""
      }`}
    >
      <div
        className={`group flex min-h-12 w-full items-stretch overflow-hidden rounded-lg border-l-2 transition-colors ${
          selected
            ? "border-brand-accent bg-brand-accent/12"
            : level === 1
              ? "border-brand-accent/55 bg-brand-accent/[0.045] hover:bg-brand-accent/[0.075]"
              : "border-brand-border bg-black/10 hover:bg-white/[0.025]"
        } ${directMatch ? "opacity-100" : "opacity-55"}`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={branchLabel}
            disabled={forceExpanded}
            onClick={() => onToggle(node.id)}
            className="flex w-10 shrink-0 items-center justify-center border-r border-brand-border/45 text-text-dark-secondary transition-colors hover:bg-white/[0.035] hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-dark-secondary"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="relative w-10 shrink-0 border-r border-brand-border/35 after:absolute after:left-1/2 after:top-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-brand-border"
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
                borderColor: selected ? "#F0EDE8" : nodeStyle.ring,
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="sr-only">{displayPath(node.url)}. </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <strong
                  aria-hidden="true"
                  className="min-w-0 break-words font-mono text-[12px] font-medium leading-5 text-text-dark-primary sm:text-[13px]"
                  title={displayPath(node.url)}
                >
                  {visiblePath}
                </strong>
                {node.kind !== "page" ? (
                  <span className="rounded border border-brand-border/70 px-1.5 py-px text-[9px] uppercase tracking-[0.08em] text-text-dark-secondary">
                    {copy[node.kind]}
                  </span>
                ) : null}
                {parentRelation === "observed_link" ? (
                  <span className="inline-flex items-center gap-1 rounded border border-brand-accent/30 bg-brand-accent/[0.06] px-1.5 py-px text-[9px] text-brand-accent-text">
                    <Link2 aria-hidden="true" className="h-2.5 w-2.5" />
                    {copy.linkGrouped}
                  </span>
                ) : null}
                {secondaryInbound > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] text-brand-accent-text"
                    title={`${secondaryInbound} ${copy.additionalInbound}`}
                  >
                    <GitBranch aria-hidden="true" className="h-3 w-3" />
                    +{secondaryInbound}
                    <span className="sr-only">
                      {" "}
                      {copy.additionalInbound}
                    </span>
                  </span>
                ) : null}
              </span>
              {node.title && node.title !== visiblePath ? (
                <span className="mt-0.5 block truncate text-[10px] leading-4 text-text-dark-secondary">
                  {node.title}
                </span>
              ) : null}
              <span className="mt-1 flex items-center gap-3 text-[10px] leading-4 text-text-dark-secondary sm:hidden">
                <span>{copy.inbound} {node.inboundLinks}</span>
                <span>{copy.outbound} {node.outboundLinks}</span>
                <span>{copy.depthLabel} {node.depth}</span>
              </span>
            </span>
            {hasChildren ? (
              <span
                aria-hidden="true"
                className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-text-dark-secondary"
              >
                {children.length}
              </span>
            ) : null}
          </span>
          <span className="hidden text-center font-mono text-[11px] text-text-dark-secondary sm:block">
            <span className="sr-only">{copy.inbound} </span>
            {node.inboundLinks}
          </span>
          <span className="hidden text-center font-mono text-[11px] text-text-dark-secondary sm:block">
            <span className="sr-only">{copy.outbound} </span>
            {node.outboundLinks}
          </span>
          <span className="hidden text-center font-mono text-[11px] text-text-dark-secondary sm:block">
            <span className="sr-only">{copy.depthLabel} </span>
            {node.depth}
          </span>
          {parentRelation === "url_path" ? (
            <span className="sr-only">
              {copy.pathGrouped}
            </span>
          ) : null}
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul
          className={
            level < MAX_VISUAL_TREE_LEVEL
              ? "ml-3 mt-1.5 space-y-1.5 border-l border-brand-accent/35 pl-3 sm:ml-5 sm:pl-5"
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
  const [filter, setFilter] = useState<TreeFilter>("all");
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
    ["orphan_undetermined", copy.orphan_undetermined],
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
          <div className="ml-auto flex min-h-11 items-center gap-1">
            <button
              type="button"
              disabled={forceExpanded}
              onClick={() => setCollapsedIds(new Set())}
              className="min-h-9 rounded-lg px-2.5 text-[11px] text-text-dark-secondary hover:bg-white/[0.035] hover:text-text-dark-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-dark-secondary"
            >
              {copy.expandAll}
            </button>
            <button
              type="button"
              disabled={forceExpanded}
              onClick={() => setCollapsedIds(new Set(expandableIds))}
              className="min-h-9 rounded-lg px-2.5 text-[11px] text-text-dark-secondary hover:bg-white/[0.035] hover:text-text-dark-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-dark-secondary"
            >
              {copy.collapseAll}
            </button>
            <span className="ml-1 font-mono text-[11px] text-text-dark-secondary">
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
              className="mb-2 hidden items-center border-b border-brand-border/55 pb-2 text-[9px] font-medium uppercase tracking-[0.1em] text-text-dark-secondary sm:flex"
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
                  className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-brand-accent-text"
                >
                  {copy.connectedBranch}
                </h4>
                <ul aria-labelledby="internal-link-tree-connected" className="space-y-2">
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
        body.data.result.findings.find((finding) => finding.nodeId === initialNodeId)?.id ?? null,
      );
      setPhase("result");
    } catch { setError(copy.errorGeneric); setPhase("error"); }
  }
  const metricItems = report ? [[copy.mapped, String(report.pagesCrawled), Waypoints], [copy.links, String(report.linksObserved), Link2], [copy.sitemap, report.sitemapFetched ? String(report.sitemapUrlsObserved) : "—", Network], [copy.fixes, String(report.findings.length), Route]] as const : [];

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
                <p className="mt-3 text-[14px] leading-6 text-text-dark-secondary">
                  {coverageSummary(report, locale)}
                </p>
              </div>
              <div className="rounded-xl border border-brand-border/70 bg-black/10 px-4 py-3 text-[12px] leading-5 text-text-dark-secondary">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-dark-secondary">
                  {report.availability === "partial"
                    ? copy.stopLabel
                    : copy.completeLabel}
                </p>
                <p className="mt-2 text-[16px] font-semibold leading-6 text-text-dark-primary">
                  {report.availability === "partial"
                    ? stopReasonLabel(report.stopReason, locale)
                    : copy.completeReason}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-text-dark-secondary">
                  {report.availability === "partial"
                    ? copy.partialBody
                    : copy.completeBody}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-brand-border/60 lg:grid-cols-4">
              {metricItems.map(([label, value, Icon]) => (
                <div key={label} className="bg-[#151516] p-4 md:p-5">
                  <dt className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.1em] text-text-dark-secondary">
                    <span>{label}</span>
                    <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-accent-text" />
                  </dt>
                  <dd
                    className="mt-3 font-mono text-[24px] leading-none text-text-dark-primary"
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
