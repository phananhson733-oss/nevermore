// @input  — @/lib/legal-content, @/types/legal
// @output — getLegalDocument() / getLegalVersions() 数据获取函数
// @pos    — 法务数据层，effective_date 自动切换逻辑，SPEC 3.16 + 4.2.16-17
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { getLocalLegalDocument } from "@/lib/legal-content";
import type { LegalDocument, LegalDocumentVersion } from "@/types";

/**
 * 获取当前生效的法务文档
 *
 * Content lives in `content/legal/{locale}/{docType}.md` rather than in
 * Supabase. The `legal_documents` tables only ever existed in a Supabase
 * project that became permanently unreachable when its owning account was
 * lost, so these four pages had rendered "coming soon" against a table that
 * was not there. Repository-backed content also puts the text under review in
 * the same pull request as the code that serves it, which is the right place
 * for a document with legal consequences.
 *
 * Returns null for a missing or still-draft document, which the pages already
 * render as their explicit fallback.
 */
export async function getLegalDocument(
  docType: string,
  locale: string,
): Promise<LegalDocument | null> {
  return getLocalLegalDocument(docType, locale);
}

/**
 * 获取历史版本列表
 *
 * Empty by construction: the repository keeps exactly one current file per
 * document, and its history is the git history. The template already guards on
 * `versions.length > 0`, so the version panel simply does not render.
 *
 * If published superseded versions ever need to be shown on the page, they
 * belong in `content/legal/{locale}/{docType}/` as dated files — not restored
 * from the lost database.
 */
export async function getLegalVersions(
  _documentId: string,
): Promise<LegalDocumentVersion[]> {
  return [];
}
