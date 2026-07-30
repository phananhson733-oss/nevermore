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
  Link2,
  Network,
  Route,
  ScanLine,
  Waypoints,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { type InternalLinkAuditLocale } from "./internal-link-audit-content";

type Phase = "idle" | "running" | "result" | "error";
type GraphFilter = "all" | InternalLinkAuditNode["kind"];

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
    progress: ["Checking robots and sitemap", "Following same-origin HTML links", "Building the relationship map"],
    result: "Real bounded crawl result",
    partial: "Partial coverage",
    available: "Completed within the crawl budget",
    mapped: "Pages collected",
    links: "HTML links observed",
    sitemap: "Sitemap URLs observed",
    fixes: "Prioritized findings",
    graph: "Observed site relationship map",
    graphBody: "Each node and line comes from this request's bounded static-HTML crawl. A missing node is not evidence that a URL does not exist.",
    all: "All pages",
    home: "Homepage",
    orphan_candidate: "Orphan candidates",
    deep: "Deep pages",
    page: "Other pages",
    unresolved_target: "Unresolved targets",
    selected: "Selected page",
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
    running: "正在在安全预算内抓取公开 HTML…",
    help: "工具从网站根域开始抓取、遵守 robots.txt，不保存 URL 或页面内容。当前预览仅读取同源静态 HTML。",
    scope: "最多 25 页 · 最深 4 层 · 最长 40 秒 · 无需登录",
    progress: ["检查 robots 与 Sitemap", "跟随同源 HTML 链接", "生成页面关系图"],
    result: "真实受限抓取结果",
    partial: "覆盖不完整",
    available: "在抓取预算内完成",
    mapped: "已采集页面",
    links: "已观测 HTML 内链",
    sitemap: "已观测 Sitemap URL",
    fixes: "优先发现",
    graph: "已观测的网站关系图",
    graphBody: "每个节点和连线都来自本次受限静态 HTML 抓取。图中未出现的节点，不代表对应 URL 不存在。",
    all: "全部页面",
    home: "首页",
    orphan_candidate: "候选孤岛",
    deep: "深层页面",
    page: "其他页面",
    unresolved_target: "未验证目标",
    selected: "已选页面",
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

const STYLE: Record<InternalLinkAuditNode["kind"], { fill: string; ring: string; text: string }> = {
  home: { fill: "#F0EDE8", ring: "#F0EDE8", text: "#131314" },
  page: { fill: "#6F9C8B", ring: "#8FC8B2", text: "#101714" },
  deep: { fill: "#D4A843", ring: "#F0C761", text: "#131314" },
  orphan_candidate: { fill: "#D95757", ring: "#F27A7A", text: "#F0EDE8" },
  unresolved_target: { fill: "#9B9690", ring: "#D5D0CA", text: "#131314" },
};

function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function graphPosition(index: number, total: number): { x: number; y: number } {
  if (index === 0) return { x: 450, y: 250 };
  const ring = Math.floor((index - 1) / 8) + 1;
  const position = (index - 1) % 8;
  const count = Math.min(8, Math.max(1, total - (ring - 1) * 8 - 1));
  const angle = (Math.PI * 2 * position) / count - Math.PI / 2;
  const radiusX = Math.min(355, 130 + ring * 95);
  const radiusY = Math.min(180, 70 + ring * 54);
  return { x: 450 + Math.cos(angle) * radiusX, y: 250 + Math.sin(angle) * radiusY };
}

function errorMessage(code: string, copy: ToolCopy): string {
  if (code === "invalid_url" || code === "invalid_request") return copy.errorInvalid;
  if (code === "rate_limited") return copy.errorRate;
  if (code === "scan_in_progress") return copy.errorProgress;
  if (code === "scan_timeout") return copy.errorTimeout;
  return copy.errorGeneric;
}

function LinkGraph({
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
  const [filter, setFilter] = useState<GraphFilter>("all");
  const visible = useMemo(
    () => new Set(report.nodes.filter((node) => filter === "all" || node.kind === filter).map((node) => node.id)),
    [filter, report.nodes],
  );
  const filters: readonly [GraphFilter, string][] = [
    ["all", copy.all],
    ["home", copy.home],
    ["orphan_candidate", copy.orphan_candidate],
    ["deep", copy.deep],
    ["page", copy.page],
  ];
  const positionById = new Map(
    report.nodes.map((node, index) => [node.id, graphPosition(index, report.nodes.length)]),
  );
  function onKeyDown(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }

  return (
    <div className="rounded-2xl border border-brand-border/70 bg-[#111112]">
      <div className="border-b border-brand-border/60 p-5">
        <h3 className="text-[16px] font-semibold text-text-dark-primary">{copy.graph}</h3>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-text-dark-secondary">{copy.graphBody}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1.5 text-[10px] ${filter === value ? "border-brand-accent bg-brand-accent/15 text-brand-accent-text" : "border-brand-border text-text-dark-secondary"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden p-3 sm:p-5">
        <svg viewBox="0 0 900 500" role="img" aria-labelledby="internal-link-graph-title internal-link-graph-desc" className="aspect-[9/5] min-h-[260px] w-full" data-testid="internal-link-graph">
          <title id="internal-link-graph-title">{copy.graph}</title>
          <desc id="internal-link-graph-desc">{copy.graphBody}</desc>
          <g fill="none" stroke="rgba(240,237,232,.17)" strokeWidth="1.7" aria-hidden="true">
            {report.edges.map((edge) => {
              const from = positionById.get(edge.from); const to = positionById.get(edge.to);
              if (!from || !to) return null;
              const active = visible.has(edge.from) && visible.has(edge.to);
              const middle = (from.x + to.x) / 2;
              return <path key={`${edge.from}-${edge.to}-${edge.anchorText ?? ""}`} d={`M${from.x} ${from.y} C${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`} opacity={active ? 1 : 0.08} />;
            })}
          </g>
          {report.nodes.map((node, index) => {
            const position = positionById.get(node.id); if (!position) return null;
            const nodeStyle = STYLE[node.kind]; const active = visible.has(node.id); const selected = selectedNodeId === node.id;
            const radius = node.kind === "home" ? 34 : node.kind === "orphan_candidate" ? 25 : 20;
            return <g key={node.id} role="button" tabIndex={active ? 0 : -1} aria-label={`${displayPath(node.url)}: ${node.kind}`} aria-pressed={selected} opacity={active ? 1 : 0.08} onClick={() => active && onSelect(node.id)} onFocus={() => active && onSelect(node.id)} onKeyDown={(event) => onKeyDown(event, node.id)} className="cursor-pointer outline-none" data-testid={`internal-link-node-${node.id}`}>
              {node.kind === "orphan_candidate" ? <circle cx={position.x} cy={position.y} r={radius + 11} fill="none" stroke={nodeStyle.ring} strokeWidth="1.5" strokeDasharray="5 5" /> : null}
              <circle cx={position.x} cy={position.y} r={radius} fill={nodeStyle.fill} stroke={selected ? "#F0EDE8" : nodeStyle.ring} strokeWidth={selected ? 4 : 1.5} />
              <text x={position.x} y={position.y + 3} textAnchor="middle" fill={nodeStyle.text} fontSize="8" fontWeight="700" aria-hidden="true">{index === 0 ? "HOME" : String(index + 1)}</text>
            </g>;
          })}
        </svg>
        <p className="mt-2 border-t border-brand-border/50 pt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-text-dark-secondary">{copy.actualScope}</p>
      </div>
    </div>
  );
}

function NodeDetail({ node, report, copy }: { readonly node: InternalLinkAuditNode; readonly report: InternalLinkAuditPayload["result"]; readonly copy: ToolCopy }) {
  const finding = report.findings.find((item) => item.nodeId === node.id);
  return <aside className="rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.055] p-5" aria-live="polite" data-testid="internal-link-node-detail">
    <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-brand-accent-text">{copy.selected}</p>
    <h3 className="mt-2 break-all font-mono text-[15px] font-semibold text-text-dark-primary">{displayPath(node.url)}</h3>
    <p className="mt-1 text-[11px] text-text-dark-secondary">{node.title ?? node.url}</p>
    <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-brand-border/60 pt-5 text-[11px]">
      <div><dt className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">Inbound</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.inboundLinks}</dd></div>
      <div><dt className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">Outbound</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.outboundLinks}</dd></div>
      <div><dt className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">Depth</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.depth}</dd></div>
      <div><dt className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">Sitemap</dt><dd className="mt-1 font-mono text-text-dark-primary">{node.sitemapMember ? "yes" : "no"}</dd></div>
    </dl>
    {finding ? <div className="mt-5 space-y-4 border-t border-brand-border/60 pt-5 text-[11px] leading-relaxed"><div><p className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">{copy.evidence}</p><p className="mt-1 text-text-dark-primary">{finding.evidence}</p></div><div><p className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">{copy.limitation}</p><p className="mt-1 text-text-dark-primary">{finding.limitation}</p></div><div><p className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">{copy.source}</p><p className="mt-1 break-all font-mono text-text-dark-primary">{finding.suggestedSourceUrl ?? copy.sourceUnavailable}</p></div><div><p className="text-[9px] uppercase tracking-[0.14em] text-text-dark-secondary">{copy.anchor}</p><p className="mt-1 text-text-dark-primary">{finding.observedAnchorText ?? copy.anchorUnavailable}</p></div></div> : null}
  </aside>;
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
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (phase === "result") resultHeadingRef.current?.focus(); }, [phase]);
  useEffect(() => { if (phase !== "running") return; const first = window.setTimeout(() => setStage(1), 800); const second = window.setTimeout(() => setStage(2), 2200); return () => { window.clearTimeout(first); window.clearTimeout(second); }; }, [phase]);
  const report = payload?.result ?? null;
  const selectedNode = report?.nodes.find((node) => node.id === selectedNodeId) ?? report?.nodes[0] ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setPayload(null); setPhase("running"); setStage(0);
    try {
      const response = await fetch("/api/tools/internal-link-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = (await response.json().catch(() => null)) as { data?: InternalLinkAuditPayload; error?: { code?: string } } | null;
      if (!response.ok || !body?.data) { setError(errorMessage(body?.error?.code ?? "scan_failed", copy)); setPhase("error"); return; }
      setPayload(body.data); setSelectedNodeId(body.data.result.nodes[0]?.id ?? null); setPhase("result");
    } catch { setError(copy.errorGeneric); setPhase("error"); }
  }
  const metricItems = report ? [[copy.mapped, `${report.pagesCrawled}/${report.maxPages}`, Waypoints], [copy.links, String(report.linksObserved), Link2], [copy.sitemap, report.sitemapFetched ? String(report.sitemapUrlsObserved) : "—", Network], [copy.fixes, String(report.findings.length), Route]] as const : [];

  return <section id="internal-link-audit-tool" aria-busy={phase === "running"} className="scroll-mt-24" data-testid="internal-link-audit-tool">
    <div className="relative overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718] p-5 md:p-7">
      <form onSubmit={handleSubmit} className="relative grid gap-3 md:grid-cols-[1fr_auto] md:items-end"><label className="block"><span id="internal-link-url-label" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-text-dark-secondary">{copy.label}</span><span className="flex h-13 items-center gap-3 rounded-xl border border-brand-border/80 bg-brand-bg px-4 focus-within:border-brand-accent/70"><Link2 aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-accent-text"/><input id="internal-link-url" type="text" inputMode="url" autoComplete="url" required maxLength={2048} aria-invalid={phase === "error"} aria-labelledby="internal-link-url-label" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={copy.placeholder} className="min-w-0 flex-1 bg-transparent text-[14px] text-text-dark-primary outline-none placeholder:text-text-dark-secondary/60"/></span></label><button type="submit" disabled={phase === "running"} className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white disabled:cursor-wait disabled:opacity-70">{phase === "running" ? copy.running : copy.start}{phase === "running" ? <ScanLine aria-hidden="true" className="h-4 w-4 animate-pulse motion-reduce:animate-none"/> : <ArrowRight aria-hidden="true" className="h-4 w-4"/>}</button></form>
      {error ? <p role="alert" className="mt-3 text-[11px] text-red-200">{error}</p> : null}
      <div className="mt-4 grid gap-2 border-t border-brand-border/60 pt-4 text-[10px] leading-relaxed text-text-dark-secondary md:grid-cols-2"><p>{copy.help}</p><p>{copy.scope}</p></div>
    </div>
    {phase === "running" ? <div className="mt-5 rounded-2xl border border-brand-border/70 bg-[#151516] p-5" role="status" aria-live="polite" data-testid="internal-link-progress"><div className="mb-4 flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-accent-text">{copy.running}</p><span className="font-mono text-[10px] text-text-dark-secondary">0{stage + 1}/03</span></div><ol className="grid gap-2 md:grid-cols-3">{copy.progress.map((item, index) => <li key={item} className={`rounded-lg border px-3 py-3 text-[10px] ${index <= stage ? "border-brand-accent/40 bg-brand-accent/10 text-text-dark-primary" : "border-brand-border/60 text-text-dark-secondary"}`}>{item}</li>)}</ol></div> : null}
    {report && phase === "result" ? <div className="mt-6 space-y-5" data-testid="internal-link-audit-result"><div className="overflow-hidden rounded-2xl border border-brand-border/70 bg-[#171718]"><div className="grid gap-5 border-b border-brand-border/60 p-5 md:grid-cols-[1.3fr_0.7fr] md:p-7"><div><p className="text-[10px] font-medium uppercase tracking-[0.15em] text-brand-accent-text">{copy.result}</p><h2 ref={resultHeadingRef} tabIndex={-1} className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-text-dark-primary outline-none md:text-[30px]">{report.availability === "partial" ? copy.partial : copy.available}</h2><p className="mt-3 text-[12px] leading-relaxed text-text-dark-secondary">{report.limitation}</p></div><div className="rounded-xl border border-brand-border/70 bg-black/10 px-4 py-3 text-[10px] text-text-dark-secondary"><p>{copy.actualScope}</p>{report.stopReason ? <p className="mt-2 font-mono">stop: {report.stopReason}</p> : null}</div></div><dl className="grid grid-cols-2 gap-px bg-brand-border/60 lg:grid-cols-4">{metricItems.map(([label, value, Icon]) => <div key={label} className="bg-[#151516] p-4 md:p-5"><div className="flex items-center justify-between"><dt className="text-[9px] uppercase tracking-[0.13em] text-text-dark-secondary">{label}</dt><Icon aria-hidden="true" className="h-3.5 w-3.5 text-brand-accent-text"/></div><dd className="mt-3 font-mono text-[24px] leading-none text-text-dark-primary">{value}</dd></div>)}</dl></div><div className="grid gap-5 xl:grid-cols-[1fr_300px]"><LinkGraph report={report} copy={copy} selectedNodeId={selectedNode?.id ?? ""} onSelect={setSelectedNodeId}/>{selectedNode ? <NodeDetail node={selectedNode} report={report} copy={copy}/> : null}</div><section className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5"><h3 className="text-[16px] font-semibold text-text-dark-primary">{copy.findings}</h3><p className="mt-1 text-[11px] leading-relaxed text-text-dark-secondary">{copy.findingsBody}</p>{report.findings.length === 0 ? <p className="mt-5 text-[12px] text-text-dark-secondary">{copy.noFindings}</p> : <div className="mt-5 grid gap-2 lg:grid-cols-2">{report.findings.map((finding) => <button key={finding.id} type="button" onClick={() => setSelectedNodeId(finding.nodeId)} aria-pressed={selectedNode?.id === finding.nodeId} data-testid={`internal-link-finding-${finding.id}`} className={`rounded-xl border p-3 text-left ${selectedNode?.id === finding.nodeId ? "border-brand-accent/60 bg-brand-accent/10" : "border-brand-border/60 bg-black/10"}`}><span className="flex gap-3"><span className="rounded bg-brand-warning/10 px-1.5 py-1 font-mono text-[9px] text-brand-warning">{finding.priority}</span><span><strong className="block text-[11px] font-medium text-text-dark-primary">{finding.title}</strong><small className="mt-1 block text-[9px] text-text-dark-secondary">{finding.detail}</small></span></span></button>)}</div>}</section></div> : null}
  </section>;
}
