import { describe, expect, it } from "vitest";
import en from "../../../../../../packages/i18n/src/messages/en.json";
import zhCN from "../../../../../../packages/i18n/src/messages/zh-CN.json";
import {
  PRIMARY_NAV_ITEMS,
  activePrimaryNavKey,
  currentProjectPageLabelKey,
  primaryNavigation,
} from "./_nav-model.ts";

describe("customer-visible primary navigation", () => {
  it("contains exactly the four approved entries in order", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.key)).toEqual([
      "overview",
      "growth-map",
      "execution",
      "results",
    ]);
    expect(primaryNavigation("project-1").map((item) => item.href)).toEqual([
      "/p/project-1/overview",
      "/p/project-1/growth-map",
      "/p/project-1/execution",
      "/p/project-1/results",
    ]);
    expect(PRIMARY_NAV_ITEMS.map((item) => item.badgeKey)).toEqual([
      null,
      "diagnosis",
      "studio",
      null,
    ]);
  });

  it("recognizes canonical routes and legacy aliases without exposing aliases as entries", () => {
    expect(activePrimaryNavKey("/p/project-1/execution", "project-1")).toBe(
      "execution",
    );
    expect(activePrimaryNavKey("/p/project-1/results", "project-1")).toBe(
      "results",
    );
    expect(activePrimaryNavKey("/p/project-1/plan", "project-1")).toBe(
      "execution",
    );
    expect(activePrimaryNavKey("/p/project-1/studio", "project-1")).toBe(
      "execution",
    );
    expect(activePrimaryNavKey("/p/project-1/report", "project-1")).toBe(
      "results",
    );
    expect(activePrimaryNavKey("/p/project-1/diagnosis", "project-1")).toBe(
      "growth-map",
    );
    expect(currentProjectPageLabelKey("/p/project-1/context", "project-1")).toBe(
      "context",
    );
    expect(currentProjectPageLabelKey("/p/project-1/sources", "project-1")).toBe(
      "sources",
    );
  });

  it("uses the approved Chinese-first and English labels", () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => zhCN.nav[item.labelKey])).toEqual([
      "概览",
      "增长地图",
      "执行中心",
      "效果追踪",
    ]);
    expect(PRIMARY_NAV_ITEMS.map((item) => en.nav[item.labelKey])).toEqual([
      "Overview",
      "Growth Map",
      "Execution",
      "Results",
    ]);
  });
});
