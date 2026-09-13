import type { WorkbenchPageId } from "../../../lib/workbench/routes.ts";
import type { WorkbenchCounts } from "../../../lib/workbench/store/selectors.ts";

export type NavTone = "neutral" | "seo" | "geo";
export type NavGroupId =
  | "workspace"
  | "research"
  | "diagnosis"
  | "site"
  | "output"
  | "space";

export interface NavItem {
  readonly id: WorkbenchPageId;
  readonly tone: NavTone;
  /** Which `WorkbenchCounts` field feeds the badge; null = never badged. */
  readonly badge: keyof WorkbenchCounts | null;
}

export interface NavGroup {
  readonly id: NavGroupId;
  readonly items: readonly NavItem[];
}

/** Six groups, fifteen items — order and tones from the jsx NAV (L310–316). */
export const WORKBENCH_NAV: readonly NavGroup[] = [
  {
    id: "workspace",
    items: [
      { id: "overview", tone: "neutral", badge: null },
      { id: "week", tone: "neutral", badge: null },
    ],
  },
  {
    id: "research",
    items: [
      { id: "keywords", tone: "seo", badge: "keywords" },
      { id: "keywordLibrary", tone: "seo", badge: "keywordLibrary" },
      { id: "competitors", tone: "seo", badge: "competitors" },
    ],
  },
  {
    id: "diagnosis",
    items: [
      { id: "audit", tone: "seo", badge: "audit" },
      { id: "visibility", tone: "geo", badge: "visibility" },
    ],
  },
  {
    id: "site",
    items: [
      { id: "profile", tone: "neutral", badge: null },
      { id: "dataSources", tone: "neutral", badge: "dataSources" },
      { id: "links", tone: "seo", badge: "links" },
    ],
  },
  {
    id: "output",
    items: [
      { id: "content", tone: "seo", badge: null },
      { id: "kb", tone: "geo", badge: "kb" },
      { id: "answers", tone: "geo", badge: null },
    ],
  },
  {
    id: "space",
    items: [
      { id: "artifacts", tone: "neutral", badge: "artifacts" },
      { id: "settings", tone: "neutral", badge: null },
    ],
  },
];

export const TONE_DOT: Readonly<Record<NavTone, string>> = {
  neutral: "bg-zinc-500",
  seo: "bg-emerald-500",
  geo: "bg-fuchsia-500",
};
