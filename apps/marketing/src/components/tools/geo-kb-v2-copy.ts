// @input -- the current display locale only
// @output -- typed local copy for the V2 read-only knowledge-base view
// @pos -- temporary local dictionary; no source content is translated here
import type { GeoCompetitorSourceV2 } from "../../lib/geo-tools/kb-source-contract.ts";
export interface GeoKbV2Copy {
  readonly profileDescription: string;
  readonly sections: Readonly<Record<"identity" | "competitors" | "roles" | "facts" | "questions" | "sources" | "adoptable" | "version", string>>;
  readonly fields: Readonly<Record<"website" | "officialName" | "aliases" | "categories" | "market" | "language" | "domain" | "brandName" | "confirmation" | "questionLabel" | "segment" | "painPoints" | "alternatives" | "criteria" | "vocabulary" | "review" | "source" | "generation" | "sourceItem" | "evidenceRefs" | "userEdited" | "eligibleLayers" | "declaredValue" | "admittedValue" | "declaredSource" | "declaredTime" | "admittedSource" | "admittedTime" | "supportRef" | "reason" | "question" | "layer" | "role" | "entities" | "questionPolicy" | "generator" | "template" | "queryCount" | "property" | "window" | "truncated" | "observedAt" | "selected" | "available" | "candidate" | "kbId" | "payloadHash" | "questionHash" | "contextHash" | "schema" | "registry" | "method" | "skippedLayers", string>>;
  readonly reviews: Readonly<Record<"pending" | "accepted" | "excluded", string>>;
  readonly sources: Readonly<Record<"manual" | "profile" | "model" | "gsc" | "crawl" | "user_confirmed" | "none", string>>;
  readonly layers: Readonly<Record<"problem" | "discovery" | "comparison" | "evaluation" | "branded", string>>;
  readonly reasons: Readonly<Record<"notPublished" | "fetchFailed" | "lowConfidence" | "conflicting", string>>;
  readonly modes: Readonly<Record<"demand" | "retrieval", string>>;
  readonly provenance: Readonly<Record<"semantic" | "registry", string>>;
  readonly unknown: string; readonly empty: string; readonly allRoles: string; readonly unknownRole: string;
  readonly yes: string; readonly no: string; readonly confirmed: string; readonly unconfirmed: string;
  readonly notAdmitted: string; readonly factsHelp: string; readonly calibrated: string; readonly uncalibrated: string;
  readonly available: string; readonly unavailable: string; readonly notRecorded: string;
  readonly rawEvidence: string; readonly receipts: string; readonly questionEvidence: string;
  readonly roleEvidence: {
    readonly details: string; readonly referencedQueries: string; readonly queryHelp: string; readonly noQueries: string;
    readonly noEvidence: string; readonly missingEvidence: string; readonly missingRefs: string; readonly inference: string;
    readonly basis: Readonly<Record<"profile" | "gsc" | "crawl" | "manual", string>>;
  };
  readonly competitorCapture: {
    readonly mapping: string; readonly lastCapture: string; readonly separate: string; readonly noCapture: string;
    readonly sovConfirmed: string; readonly sovExcluded: string; readonly receiptTime: string; readonly captureMethod: string;
    readonly signals: string; readonly signalKind: string; readonly hostMatched: string; readonly signalExclusion: string;
    readonly receiptIdentity: string; readonly evidenceId: string; readonly receiptHash: string; readonly bodyHash: string;
    readonly statuses: Readonly<Record<GeoCompetitorSourceV2["status"], string>>;
    readonly reasons: Readonly<Record<NonNullable<GeoCompetitorSourceV2["reason"]>, string>>;
  };
}
export const GEO_KB_V2_COPY: Readonly<Record<"en" | "zh", GeoKbV2Copy>> = {
  en: {
    profileDescription: "These complete Profile values belong to the knowledge-base version shown here. This view does not read another draft or the current Profile.",
    sections: { identity: "Brand and measurement scope", competitors: "Competitor identities", roles: "Roles and review history", facts: "Fact declarations and admitted evidence", questions: "Complete question set", sources: "Source summary", adoptable: "Ready to take from the last crawl", version: "Version identity" },
    fields: { website: "Website", officialName: "Matching name", aliases: "Brand aliases", categories: "Question categories", market: "Market", language: "Question language", domain: "Domain", brandName: "Brand name", confirmation: "Identity confirmation", questionLabel: "Question-facing role name", segment: "Segment", painPoints: "Pain points", alternatives: "Existing alternatives", criteria: "Decision criteria", vocabulary: "Vocabulary", review: "Review state", source: "Source basis", generation: "Generation ID", sourceItem: "Original item ID", evidenceRefs: "Evidence references", userEdited: "User edited the model proposal", eligibleLayers: "Eligible demand layers", declaredValue: "Declared value", admittedValue: "Value admitted to downstream evidence", declaredSource: "Declared source URL", declaredTime: "Declared capture time", admittedSource: "Admitted source URL", admittedTime: "Admitted capture time", supportRef: "Crawl support reference", reason: "Reason / conflict", question: "Question", layer: "Layer", role: "Role", entities: "Required entities", questionPolicy: "Mode and provenance", generator: "Generator version", template: "Registry template", queryCount: "Observed query count", property: "GSC property", window: "Query window", truncated: "Truncated", observedAt: "Observed at", selected: "Selected evidence", available: "Available evidence", candidate: "Candidate ID", kbId: "Knowledge-base ID", payloadHash: "Payload hash", questionHash: "Question-set hash", contextHash: "Context hash", schema: "Schema", registry: "Registry version", method: "Question method", skippedLayers: "Skipped demand layers" },
    reviews: { pending: "Pending review", accepted: "Accepted by user", excluded: "Excluded" },
    sources: { manual: "Manual input", profile: "Profile", model: "Model proposal", gsc: "Search Console", crawl: "Crawl-supported", user_confirmed: "User-confirmed declaration", none: "Not admitted" },
    layers: { problem: "Problem", discovery: "Discovery", comparison: "Comparison", evaluation: "Evaluation", branded: "Branded" },
    reasons: { notPublished: "Not published", fetchFailed: "Fetch failed", lowConfidence: "Insufficient confidence", conflicting: "Conflicting evidence" },
    modes: { demand: "Demand question", retrieval: "Retrieval probe" }, provenance: { semantic: "Semantic generation", registry: "Exact registry probe" },
    unknown: "Unknown", empty: "Not provided", allRoles: "All roles", unknownRole: "Role unavailable", yes: "Yes", no: "No", confirmed: "Confirmed", unconfirmed: "Not confirmed",
    notAdmitted: "Not admitted as positive evidence", factsHelp: "Declarations are shown separately from the values admitted by this version's source policy. A filled value or user acceptance is not proof of crawl verification.",
    calibrated: "Calibrated registry probe", uncalibrated: "Uncalibrated", available: "Available", unavailable: "Unavailable", notRecorded: "Not recorded",
    rawEvidence: "Inspect the original selected evidence", receipts: "Exact source receipts", questionEvidence: "Inspect question provenance",
    roleEvidence: { details: "Inspect role generation and original references", referencedQueries: "Referenced distinct GSC queries", queryHelp: "This is a count of referenced query texts, not a count of people or verified customer segments. Role wording remains an interpretation, not a calibrated observation.", noQueries: "No GSC query references in this role's recorded evidence.", noEvidence: "No linked source evidence recorded", missingEvidence: "Source evidence unavailable", missingRefs: "Some role references are unavailable in this version; no evidence was borrowed from other roles or current data.", inference: "Model inference", basis: { profile: "Profile", gsc: "GSC query evidence", crawl: "Public-page evidence", manual: "Manual input" } },
    competitorCapture: { mapping: "Current mapping in this version", lastCapture: "Last selected extraction", separate: "This is the last selected extraction, not proof that the current mapping came from it. Manual wording and confirmation are shown separately above.", noCapture: "No extraction capture recorded in this version.", sovConfirmed: "Confirmed mapping: actual SOV applies brand deduplication and excludes this site's own identity. Aliases do not create extra competitors.", sovExcluded: "Excluded from SOV: this mapping is unconfirmed or has no matching brand name.", receiptTime: "Receipt recorded at", captureMethod: "Extraction method", signals: "Inspect captured identity signals", signalKind: "Signal kind", hostMatched: "Matches competitor host", signalExclusion: "Signal exclusion reason", receiptIdentity: "Inspect exact receipt identity", evidenceId: "Capture evidence ID", receiptHash: "Receipt content hash", bodyHash: "Captured body hash",
      statuses: { available: "Capture succeeded", conflict: "Identity conflict", unavailable: "Capture unavailable" }, reasons: { missing_url: "No source URL", fetch_failed: "Fetch failed", not_found: "Page not found", target_redirected: "Source redirected", partial_body: "Incomplete page capture", not_html: "Not an HTML page", invalid_response: "Invalid response", rate_limited: "Source rate limited", insufficient_identity: "Insufficient identity evidence", identity_overflow: "Identity signals exceeded the capture limit", identity_conflict: "Conflicting identity signals" } },
  },
  zh: {
    profileDescription: "以下完整 Profile 资料属于当前展示的知识库版本；此视图不会读取其他草稿或今天的 Profile。",
    sections: { identity: "品牌与测量范围", competitors: "竞品身份", roles: "角色与审阅记录", facts: "事实声明与实际采用的证据", questions: "完整提问集", sources: "来源汇总", adoptable: "上次抓取中可以采用的内容", version: "版本身份" },
    fields: { website: "网站", officialName: "提及匹配名称", aliases: "品牌别名", categories: "提问品类词", market: "市场", language: "提问语言", domain: "域名", brandName: "品牌名称", confirmation: "身份确认", questionLabel: "提问使用的角色名称", segment: "角色描述", painPoints: "痛点", alternatives: "现有替代方案", criteria: "决策标准", vocabulary: "使用词汇", review: "审阅状态", source: "来源依据", generation: "生成记录 ID", sourceItem: "原始条目 ID", evidenceRefs: "证据引用", userEdited: "用户已改写模型建议", eligibleLayers: "可用于需求提问的层", declaredValue: "原声明值", admittedValue: "实际采用的证据值", declaredSource: "声明的来源 URL", declaredTime: "声明的采集时间", admittedSource: "实际采用的来源 URL", admittedTime: "实际采用的采集时间", supportRef: "抓取支持引用", reason: "原因／冲突", question: "提问", layer: "层", role: "角色", entities: "必要实体", questionPolicy: "模式与来源", generator: "生成方法版本", template: "固定探针模板", queryCount: "实际查询词数", property: "GSC 资源", window: "查询窗口", truncated: "是否截断", observedAt: "实际采集时间", selected: "已选证据", available: "可用证据", candidate: "候选版本 ID", kbId: "知识库 ID", payloadHash: "内容哈希", questionHash: "提问集哈希", contextHash: "上下文哈希", schema: "数据版本", registry: "探针注册表版本", method: "提问生成方法", skippedLayers: "跳过的需求层" },
    reviews: { pending: "待审阅", accepted: "用户已接受", excluded: "已排除" },
    sources: { manual: "人工填写", profile: "Profile", model: "模型建议", gsc: "Search Console", crawl: "抓取证据支持", user_confirmed: "用户确认的声明", none: "未采用" },
    layers: { problem: "问题", discovery: "发现", comparison: "对比", evaluation: "评估", branded: "品牌" },
    reasons: { notPublished: "未公开", fetchFailed: "抓取失败", lowConfidence: "置信度不足", conflicting: "证据冲突" },
    modes: { demand: "需求问题", retrieval: "检索探针" }, provenance: { semantic: "语义生成", registry: "原样固定探针" },
    unknown: "未知", empty: "未提供", allRoles: "全部角色", unknownRole: "角色信息不可用", yes: "是", no: "否", confirmed: "已确认", unconfirmed: "未确认",
    notAdmitted: "未作为正向证据采用", factsHelp: "原始声明与这个版本实际采用的证据分开呈现。填写了值或经用户接受，不等于已经通过抓取核实。",
    calibrated: "已校准固定探针", uncalibrated: "未校准", available: "可用", unavailable: "不可用", notRecorded: "未记录",
    rawEvidence: "查看原始选中证据", receipts: "精确来源记录", questionEvidence: "查看提问来源",
    roleEvidence: { details: "查看角色生成记录与原始引用", referencedQueries: "实际引用的去重 GSC 查询词", queryHelp: "这里统计引用的查询文本，不是人数或已验证的客户分群。角色措辞仍是解释，不是经过校准的观测。", noQueries: "这个角色已记录的证据未引用 GSC 查询词。", noEvidence: "未记录关联来源证据", missingEvidence: "来源证据不可用", missingRefs: "此版本中的部分角色引用不可用；没有从其他角色或当前资料补造证据。", inference: "模型推断", basis: { profile: "Profile", gsc: "GSC 查询词证据", crawl: "公开页面证据", manual: "人工输入" } },
    competitorCapture: { mapping: "此版本的当前映射", lastCapture: "最后一次选中采集的解析结果", separate: "这里展示最后一次选中的解析结果，不证明当前映射源于这次采集。手工名称与确认状态在上方独立显示。", noCapture: "此版本未记录身份采集证据。", sovConfirmed: "映射已确认：实际 SOV 按品牌去重并排除本站身份；多个别名不会增加竞品数量。", sovExcluded: "不参与 SOV：映射未确认或缺少用于匹配的品牌名称。", receiptTime: "来源记录时间", captureMethod: "解析方法", signals: "查看采集到的身份信号", signalKind: "信号类型", hostMatched: "匹配竞品域名", signalExclusion: "信号排除原因", receiptIdentity: "查看精确来源记录标识", evidenceId: "采集证据 ID", receiptHash: "来源记录内容哈希", bodyHash: "采集正文哈希",
      statuses: { available: "采集成功", conflict: "身份冲突", unavailable: "采集不可用" }, reasons: { missing_url: "没有来源 URL", fetch_failed: "抓取失败", not_found: "页面不存在", target_redirected: "来源发生跳转", partial_body: "页面采集不完整", not_html: "不是 HTML 页面", invalid_response: "响应格式无效", rate_limited: "来源限流", insufficient_identity: "身份依据不足", identity_overflow: "身份信号超过采集上限", identity_conflict: "身份信号互相冲突" } },
  },
};
export function geoKbV2Copy(locale: string): GeoKbV2Copy { return GEO_KB_V2_COPY[locale.toLowerCase().startsWith("zh") ? "zh" : "en"]; }
