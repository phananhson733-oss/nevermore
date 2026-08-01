import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../../../../../packages/i18n/src/messages/en.json";
import zhCN from "../../../../../../../packages/i18n/src/messages/zh-CN.json";

const settingsSource = readFileSync(
  new URL("./_settings.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../../../components/app-shell/AppShell.tsx", import.meta.url),
  "utf8",
);

describe("product deletion settings", () => {
  it("requires a second explicit action before crossing the DELETE boundary", () => {
    expect(settingsSource).toContain("const [confirmingDelete");
    expect(settingsSource).toContain("await deleteProject.mutateAsync()");
    expect(settingsSource).toContain('t("delete.confirmAction")');
    expect(settingsSource).toContain('router.replace("/new-project")');
  });

  it("exposes Settings only for an active project shell", () => {
    expect(shellSource).toContain('state === "project"');
    expect(shellSource).toContain("href={settingsHref}");
  });

  it("states the archival retention behavior in both supported UI languages", () => {
    expect(en.projectSettings.delete.retention).toMatch(/retained.*audit/iu);
    expect(zhCN.projectSettings.delete.retention).toMatch(/历史.*审计.*保留/u);
    expect(zhCN.projectSettings.delete.confirmAction).toBe("确认删除");
  });
});
