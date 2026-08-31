// @input -- a measured C gap and its real reference-page URLs
// @output -- local third-party review tasks, never a content-generation handoff
// @pos -- the sole C action; no email, publisher write or promised placement
import type { VisibilityReportV2 } from "./visibility-v2-contract.ts";
const plain = (value: string): string => value.replace(/[\\`*_{}[\]<>|]/g, "\\$&").replace(/\r?\n/g, " ");
export function thirdPartyGapMarkdown(report: VisibilityReportV2, gapId: string, locale: string): string | null {
  const gap = report.gaps.find((gap) => gap.id === gapId && gap.kind === "C" && gap.action === "third_party");
  const question = report.questions.find((question) => question.questionId === gap?.questionId);
  if (gap === undefined || question === undefined || gap.sourceUrls.length === 0) return null;
  const zh = locale === "zh";
  return [zh ? "# 第三方在位待办" : "# Third-party placement tasks", "", zh ? "这是第三方页面的核查待办，不是内容草稿，也没有发送任何消息。" : "This is third-party review work, not a content draft. No message has been sent.", "", `Run: ${report.manifest.runId}`, `KB: ${report.manifest.kbId} · ${report.manifest.snapshotId}`, `Question set: ${report.manifest.questionSetHash}`, `Question: ${question.questionId} · ${plain(question.text)}`, `Evidence: ${gap.evidenceIds.join(", ")}`, `Read: ${report.siteEvidence?.collectedAt ?? "unavailable"}`, "", ...gap.sourceUrls.flatMap((url) => [`## ${plain(url)}`, zh ? `- [ ] 确认此页面是否适合介绍 ${plain(report.context.officialName)}。` : `- [ ] Review whether this page is relevant to ${plain(report.context.officialName)}.`, zh ? "- [ ] 核对发布方的收录要求，并记录联系人或提交入口。" : "- [ ] Check publisher inclusion requirements and record an appropriate contact or submission route.", zh ? "- [ ] 只有事实准确且符合发布方要求时，再人工决定是否申请补充。" : "- [ ] Decide manually whether to request inclusion, using verified facts and the publisher's requirements.", ""]), zh ? "限制：未在一次完整读取中发现品牌，并不证明该网站所有页面都没有品牌，也不保证后续收录或 AI 引用。" : "Limit: absence in this complete page read does not establish absence across the publisher's site or guarantee future inclusion or AI citation."].join("\n");
}
