// @input -- actual public Content Brief and Draft landing copy in both locales
// @output -- prevents old primary-only, cluster-gated and CJK-disabled promises
// @pos -- acquisition copy contract for confirmed v2/v3 inputs and Draft v2 output
import { describe, expect, it } from "vitest";
import { getConnectedToolContent } from "./connected-tool-content.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";

describe("current content tool landing copy", () => {
  for (const locale of ["en", "zh"] as const) {
    const brief = getConnectedToolContent(locale, "content-brief");
    const draft = getConnectedToolContent(locale, "content-draft");
    it(`${locale}: names both confirmed input versions without claiming a Draft v3 result`, () => {
      expect(draft.sourceDetail).toContain("Content Brief v2/v3");
      expect(draft.sourceDetail).toContain("Draft v2");
      expect(draft.sourceDetail).toContain("GEO Brief v1.1");
      expect(draft.sourceDetail).toContain("SEO v1");
      expect(draft.faq.find(item => /refused|被拒绝/.test(item.question))?.answer).toContain("v2/v3");
      expect(draft.faq.find(item => /languages|语言/.test(item.question))?.answer).toContain("v2/v3");
      expect(JSON.stringify(draft)).not.toContain("Draft v3");
    });
    it(`${locale}: gives exact current schema examples and keeps supported legacy intake explicit`, () => {
      const copy = (locale === "en" ? en : zh).tools.contentDraft;
      expect(copy.intake.pastePlaceholder).toContain('"schema": "gengrowth.confirmed_brief/v3"');
      expect(copy.intake.pastePlaceholder).toContain("v2");
      for (const text of [copy.intake.confirmationRequired, copy.intake.supportedSchemas, copy.intake.maxBytes, copy.intake.geoDocument,
        copy.v2.errors.brief_schema_mismatch, copy.v2.errors.brief_reference_invalid, copy.v2.errors.brief_fingerprint_mismatch, copy.errors.brief_schema_mismatch]) expect(text).toContain("v2/v3");
      for (const text of [copy.intake.supportedSchemas, copy.errors.brief_schema_mismatch]) { expect(text).toContain("SEO"); expect(text).toContain("v1.1"); }
      expect(copy.v2.fullJson).toContain("Draft v2 JSON");
      expect(copy.errors.brief_schema_mismatch).not.toMatch(/not a Content Brief v1|不是 Content Brief v1/);
    });
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
