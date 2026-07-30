// @input  — 无
// @output — LegalDocument / LegalDocumentVersion 接口
// @pos    — 法律文档数据类型，对应 SPEC 4.2.16-17 表
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export interface LegalDocument {
  id: string;
  doc_type: "privacy" | "terms" | "cookies" | "copyright";
  locale: string;
  title: string;
  content: string;
  version: string;
  effective_date: string;
  is_current: boolean;
  published_at: string;
  created_at: string;
}

export interface LegalDocumentVersion {
  id: string;
  document_id: string;
  version: string;
  content_snapshot: string;
  change_summary: string;
  effective_date: string;
  created_at: string;
}
