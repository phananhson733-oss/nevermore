// @input  — @/lib/supabase, @/types/legal
// @output — getLegalDocument() / getLegalVersions() 数据获取函数
// @pos    — 法务数据层，effective_date 自动切换逻辑，SPEC 3.16 + 4.2.16-17
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { getSupabase } from "@/lib/supabase";
import type { LegalDocument, LegalDocumentVersion } from "@/types";

/**
 * 获取当前生效的法务文档
 */
export async function getLegalDocument(
  docType: string,
  locale: string,
): Promise<LegalDocument | null> {
  try {
    const supabase = getSupabase();
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("legal_documents")
      .select("*")
      .eq("doc_type", docType)
      .eq("locale", locale)
      .eq("is_current", true)
      .lte("effective_date", today)
      .order("effective_date", { ascending: false })
      .single();

    if (error) return null;
    return data as LegalDocument;
  } catch {
    // Legal documents are deployment-managed content. Missing optional database
    // configuration must render the page's explicit fallback, never turn a
    // Footer link into a 500 response.
    return null;
  }
}

/**
 * 获取历史版本列表
 */
export async function getLegalVersions(
  documentId: string,
): Promise<LegalDocumentVersion[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("legal_document_versions")
      .select("*")
      .eq("document_id", documentId)
      .order("effective_date", { ascending: false });

    if (error) return [];
    return (data as LegalDocumentVersion[]) || [];
  } catch {
    return [];
  }
}
