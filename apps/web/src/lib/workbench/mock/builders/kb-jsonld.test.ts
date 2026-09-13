import { describe, expect, it } from "vitest";
import type { KbEntry, Profile } from "../../types.ts";
import { stampArtifact } from "../provenance.ts";
import { FIXTURE_PROFILE } from "./builder-fixtures.ts";
import { FIXTURE_KB_ENTRIES, withEntry } from "./builder-fixtures-kb.ts";
import { HOSTILE_VALUES } from "./hostile-fixtures.ts";
import { kbJsonLd } from "./kb.ts";

interface Input {
  readonly profile: Profile;
  readonly entries: readonly KbEntry[];
}

interface Node {
  readonly "@type": string;
  readonly name?: string;
  readonly url?: string;
  readonly description?: string;
  readonly mainEntity?: readonly {
    readonly name: string;
    readonly acceptedAnswer: { readonly text: string };
  }[];
}

interface Graph {
  readonly "@context": string;
  readonly "@graph": readonly Node[];
}

const BASE: Input = { profile: FIXTURE_PROFILE, entries: FIXTURE_KB_ENTRIES };

function parse(input: Input): Graph {
  return JSON.parse(kbJsonLd(input)) as Graph;
}

function faqEntry(statement: string, id = "kb-90"): KbEntry {
  return { id, cat: "faq", statement, evidence: "", source: "", from: "manual" };
}

describe("kbJsonLd", () => {
  it("builds an Organization and an FAQPage in one JSON-LD graph", () => {
    expect(parse(BASE)).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: "Acme",
          url: "https://acme.io",
          description: "Acme 是给小团队用的 SEO 检查工具",
          sameAs: [],
        },
        {
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Acme 支持中文站吗",
              acceptedAnswer: { "@type": "Answer", text: "支持 → 需要先填市场" },
            },
          ],
        },
      ],
    });
  });

  it("splits a FAQ statement at its first arrow only", () => {
    const graph = parse({ ...BASE, entries: [faqEntry("问 → 答 → 补充")] });
    const answer = graph["@graph"][1]?.mainEntity?.[0]?.acceptedAnswer.text;
    expect(answer).toBe("答 → 补充");
  });

  it("drops FAQ entries with a blank question or no arrow, and the FAQPage with them", () => {
    const graph = parse({
      ...BASE,
      entries: [faqEntry(" → 只有答案"), faqEntry("没有箭头"), faqEntry("")],
    });
    expect(graph["@graph"].map((node) => node["@type"])).toEqual([
      "Organization",
    ]);
  });

  it("keeps a question whose answer is blank", () => {
    const graph = parse({ ...BASE, entries: [faqEntry("只有问题 →")] });
    expect(graph["@graph"][1]?.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "只有问题",
        acceptedAnswer: { "@type": "Answer", text: "" },
      },
    ]);
  });

  it("describes the organization with the first written definition, else the positioning", () => {
    const blankFirst = withEntry(FIXTURE_KB_ENTRIES, 0, { statement: " " });
    expect(parse({ ...BASE, entries: blankFirst })["@graph"][0]?.description).toBe(
      "Acme 是第二条定义",
    );
    const noDefinition = FIXTURE_KB_ENTRIES.filter(
      (entry) => entry.cat !== "definition",
    );
    expect(
      parse({ ...BASE, entries: noDefinition })["@graph"][0]?.description,
    ).toBe("给小团队用的 SEO 检查工具");
  });

  it("is a JSON object, so the json provenance stamp accepts it", () => {
    expect(() => stampArtifact("json", kbJsonLd(BASE), "示例数据")).not.toThrow();
  });

  it("never says 实测", () => {
    expect(kbJsonLd(BASE)).not.toContain("实测");
  });

  it.each(HOSTILE_VALUES)(
    "round-trips hostile values as JSON strings: $name",
    ({ value }) => {
      const graph = parse({
        profile: { ...FIXTURE_PROFILE, brand: value, url: value },
        entries: [
          { ...faqEntry(`${value} → ${value}`), id: "kb-01" },
          {
            id: "kb-02",
            cat: "definition",
            statement: value,
            evidence: "",
            source: "",
            from: "manual",
          },
        ],
      });
      const [org, faq] = graph["@graph"];
      expect(org?.name).toBe(value);
      expect(org?.url).toBe(value);
      expect(org?.description).toBe(value.trim());
      expect(faq?.mainEntity?.[0]?.name).toBe(value.trim());
    },
  );
});
