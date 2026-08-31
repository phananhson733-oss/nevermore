// @input -- actual public Content Brief and Draft landing copy in both locales
// @output -- prevents old primary-only, cluster-gated and CJK-disabled promises
// @pos -- acquisition copy contract for the current confirmed-v2 workflow
import { describe, expect, it } from "vitest";
import { getConnectedToolContent } from "./connected-tool-content.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

describe("current content tool landing copy", () => {
  for (const locale of ["en", "zh"] as const) {
    const brief = getConnectedToolContent(locale, "content-brief");
    const draft = getConnectedToolContent(locale, "content-draft");
    it(`${locale}: preserves the newly merged shared GEO brief without accepting a legacy GEO report`, () => {
      const intake = (locale === "en" ? en : zh).tools.contentDraft.intake;
      expect(intake.supportedSchemas).toContain("v1.1");
      expect(intake.geoDocument).toMatch(/legacy|旧版/);
      expect(draft.sourceDetail).toContain("v1.1");
    });
    it(`${locale}: explains supporting-scope research and PAA without the old cluster gate`, () => {
      expect(brief.steps[0]?.text).toContain("Search Console");
      expect(brief.steps[2]?.text).toContain("PAA");
      expect(JSON.stringify(brief)).not.toMatch(/never take part|只交给大纲模型|Headings shared by enough|被足够多抓取页面共用/);
    });
    it(`${locale}: requires explicit confirmation before Draft and separates GEO documents`, () => {
      expect(brief.outputs.at(-1)?.body).toMatch(/confirm|确认/);
      expect(draft.sourceDetail).toMatch(/confirmed|已确认/);
      expect(draft.faq.find((item) => /refused|被拒绝/.test(item.question))?.answer).toContain("GEO");
    });
    it(`${locale}: supports CJK research and drafting with honest length units`, () => {
      for (const content of [brief, draft]) {
        const answer = content.faq.find((item) => /languages|语言/.test(item.question))?.answer ?? "";
        expect(answer).toMatch(/characters|字符/);
        expect(answer).not.toMatch(/unsupported|no writable|no draft can|不支持|不能生成|没有可写/);
      }
    });
    it(`${locale}: describes owned-page evidence and whole-draft coverage`, () => {
      expect(draft.sourceDetail).toMatch(/owned|自有/);
      expect(draft.outputs[1]?.body).not.toMatch(/otherwise it shows why its section failed|否则显示所在段失败/);
      expect(draft.outputs[2]?.body).toMatch(/observed page|观测页/);
    });
  }
});
