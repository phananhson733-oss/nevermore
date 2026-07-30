// @input  — 无
// @output — BlogPost 接口
// @pos    — 博客数据类型，对应 SPEC 4.2.12 blog_posts 表
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  category:
    | "case_study"
    | "methodology"
    | "weekly_review"
    | "experiment_log";
  pillar_slug?: string;
  locale: string;
  locale_exclusive: boolean;
  author: string;
  published_at: string;
  updated_at: string;
  reading_time: number;
  status: "draft" | "published" | "archived";
  created_at: string;
  /** Static root-relative path or immutable HTTPS URL for the article cover. */
  hero_image?: string;
  /** Required when hero_image comes from a repository-backed Markdown article. */
  hero_image_alt?: string;
  /** Local Markdown content is canonical; Supabase values are transitional only. */
  content_source?: "local" | "legacy_supabase";
}
