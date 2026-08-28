// @input  -- nothing; this module is types only
// @output -- the shape a connected tool's long-form article is written in
// @pos    -- shared contract between the article copy modules and their renderer
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * One shape for every connected tool's explainer.
 *
 * `/tools/low-competition-keywords` and `/tools/seo-quick-wins` each grew
 * their own markup for the same three ideas — an example, a run of prose
 * sections, and two columns of onward links. A third and fourth hand-written
 * copy would be four places to fix a heading level, so the sections below are
 * data and the renderer is shared. Copy never lives in the renderer, and
 * nothing here describes a capability the tool behind the page lacks.
 */

export interface ToolArticleItem {
  readonly heading: string;
  readonly body: string;
}

/**
 * A table inside a section.
 *
 * `invented` is declared rather than inferred from the label, because the two
 * kinds of table on these pages carry opposite obligations. A table of made-up
 * rows showing the shape of a result MUST say so, or a reader takes it for a
 * live run; a table of the engine's own thresholds must NOT, because it is the
 * implementation. A regex over the label cannot tell them apart, and the one
 * that tried marked the threshold table as dishonest for being accurate.
 */
export interface ToolArticleTable {
  readonly label: string;
  /** True when the cells are illustrative rather than measured or implemented. */
  readonly invented: boolean;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ToolArticleSection {
  readonly heading: string;
  readonly intro?: string;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly ToolArticleItem[];
  readonly table?: ToolArticleTable;
}

export interface ToolArticleLink {
  readonly label: string;
  /** Locale-agnostic in-site path; `localePath` adds the prefix at render. */
  readonly href: string;
  readonly description: string;
}

export interface ToolArticle {
  readonly exampleHeading: string;
  readonly example: readonly ToolArticleItem[];
  readonly sections: readonly ToolArticleSection[];
  readonly relatedToolsHeading: string;
  readonly relatedTools: readonly ToolArticleLink[];
  readonly relatedReadingHeading: string;
  readonly relatedReading: readonly ToolArticleLink[];
}
