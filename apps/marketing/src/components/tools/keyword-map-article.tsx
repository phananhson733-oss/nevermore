// @input  -- locale
// @output -- the long-form explainer for /tools/low-competition-keywords
// @pos    -- static marketing copy; every claim in here must be provable from the tool's code
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
// Relative, not `@/`: the shared Vitest config maps `@/` to apps/web only, so
// an aliased import would make this file unimportable from a test.
import { localePath } from "../../lib/locale-path";

/**
 * Two full articles rather than one keyed message tree.
 *
 * The copy is long-form prose with structure, and the two languages do not
 * map sentence-for-sentence. What both versions share is the constraint the
 * file header states: nothing in here describes a capability the tool does
 * not have. The tool's bounded SERP interpretation is identified as an LLM
 * inference with provenance; reading the ranking pages and making the final
 * commercial/page-type decisions remain the reader's work.
 */

const H2 =
  "max-w-2xl text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary";
const H3 = "mt-8 text-[15.5px] font-semibold text-text-dark-primary";
const P =
  "mt-3 max-w-[46em] text-[13.5px] leading-[1.7] text-text-dark-secondary";
const SECTION = "border-b border-brand-border py-16 md:py-22";
const LINK =
  "flex items-center gap-1.5 text-[13.5px] text-brand-accent-2 transition-colors hover:text-brand-info";
const TABLE_LABEL =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";

/** A synthetic result table so an unconnected visitor can see the shape. */
function ExampleTable({ locale }: { readonly locale: string }) {
  const zh = locale === "zh";
  const columns = zh
    ? ["关键词", "搜索量", "KD", "最弱排名", "AI Overview"]
    : ["Keyword", "Volume", "KD", "Weakest rank", "AI Overview"];
  const rows = zh
    ? [
        [
          "travel espresso kit",
          "1,300",
          "12",
          "38 · smallbrew.example · #6",
          "未观测到",
        ],
        [
          "manual espresso maker cleaning",
          "320",
          "4",
          "55 · beanpress.example · #9",
          "第一页有",
        ],
        [
          "espresso ratio calculator",
          "590",
          "8",
          "24 · pullshot.example · #3",
          "未观测到",
        ],
      ]
    : [
        [
          "travel espresso kit",
          "1,300",
          "12",
          "38 · smallbrew.example · #6",
          "Not observed",
        ],
        [
          "manual espresso maker cleaning",
          "320",
          "4",
          "55 · beanpress.example · #9",
          "On page one",
        ],
        [
          "espresso ratio calculator",
          "590",
          "8",
          "24 · pullshot.example · #3",
          "Not observed",
        ],
      ];

  return (
    <div className="mt-6">
      <p className={TABLE_LABEL}>
        {zh
          ? "示例输出 · 数字为虚构，仅示意形状，非真实运行结果"
          : "Example output · made-up numbers to show the shape, not live data"}
      </p>
      <div className="rounded-card border-brand-border-card mt-3 overflow-x-auto border">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-brand-border-card bg-brand-panel">
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={`${TABLE_LABEL} px-4 py-2.5`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells) => (
              <tr
                key={cells[0]}
                className="border-b border-brand-border-card/60 last:border-b-0"
              >
                {cells.map((cell, index) => (
                  <td
                    key={`${cells[0]}-${String(index)}`}
                    className={`px-4 py-3 text-[12.5px] ${
                      index === 0
                        ? "text-text-dark-primary"
                        : "font-mono text-text-dark-secondary tabular-nums"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Articles this section points at, per locale.
 *
 * Not one list with translated labels. The blog is not published in both
 * languages: the three English keyword-selection articles this section named
 * have no Chinese translation, so the localized link built from the same slug
 * resolved to a 404 with a friendly label on it. Each locale therefore names
 * articles that exist in that locale, which the sibling test checks against
 * the content directory rather than against this list.
 */
export const RELATED_READING: Readonly<
  Record<"en" | "zh", readonly { readonly href: string; readonly label: string }[]>
> = {
  en: [
    {
      href: "/blog/how-to-find-low-hanging-fruit-keywords",
      label: "How to find low-hanging fruit keywords, the full method",
    },
    {
      href: "/blog/zero-search-volume-keywords",
      label: "Are zero-search-volume keywords worth writing for?",
    },
    {
      href: "/blog/striking-distance-keywords",
      label: "Striking-distance keywords: improving rankings you already have",
    },
  ],
  zh: [
    {
      href: "/blog/programmatic-seo-at-scale",
      label: "一组关键词什么时候撑得起一个模板",
    },
    {
      href: "/blog/public-seo-audit-boundaries",
      label: "公开 SEO 审计看得到和看不到什么",
    },
    {
      href: "/blog/evidence-first-growth-experiments",
      label: "证据优先的增长实验",
    },
  ],
};

function RelatedLinks({ locale }: { readonly locale: string }) {
  const zh = locale === "zh";
  const blog = RELATED_READING[zh ? "zh" : "en"];
  const tools = [
    {
      href: "/tools/seo-quick-wins",
      label: zh
        ? "SEO Quick Wins——从你已有的曝光里找缺口"
        : "SEO Quick Wins — find gaps in the impressions you already earn",
    },
    {
      href: "/tools/traffic-drop-diagnosis",
      label: zh
        ? "流量下降诊断——用你自己的数据排查下跌"
        : "Traffic Drop Diagnosis — investigate a drop with your own data",
    },
  ];

  return (
    <section className="py-16 md:py-22">
      <h2 className={H2}>
        {zh ? "继续读、继续查" : "Keep reading, keep checking"}
      </h2>
      <p className={P}>
        {zh
          ? "这张地图找的是「还没写的页面」。下面几篇讲的是同一套证据纪律在别处怎么用；两个姊妹工具则从你已有的数据里找机会。"
          : "This map hunts for pages you have not written yet. The articles below cover the selection method itself; the two sibling tools work the data you already have. All of them follow the same evidence discipline."}
      </p>
      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <div>
          <p className={TABLE_LABEL}>
            {zh ? "相关方法阅读" : "The method, in writing"}
          </p>
          <div className="mt-4 space-y-3">
            {blog.map((item) => (
              <Link
                key={item.href}
                href={localePath(locale, item.href)}
                className={LINK}
              >
                {item.label}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className={TABLE_LABEL}>
            {zh ? "同一套数据的其他工具" : "Other tools on the same data"}
          </p>
          <div className="mt-4 space-y-3">
            {tools.map((item) => (
              <Link
                key={item.href}
                href={localePath(locale, item.href)}
                className={LINK}
              >
                {item.label}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EnArticle() {
  return (
    <>
      <section className={SECTION}>
        <h2 className={H2}>What the map actually does, stage by stage</h2>

        <h3 className={H3}>A bounded crawl, confirmed by you</h3>
        <p className={P}>
          The run starts by fetching up to twenty of your pages, product pages
          first, and reading the site&apos;s positioning off them. It then stops
          and shows you what it understood — every statement with the URL it
          came from — before anything is spent. This gate exists because the
          candidates are generated from that reading: a wrong reading produces
          wrong keywords, and you are the only party who can tell. The seed
          field takes up to ten terms of your own, which travel into the
          generator alongside the crawl; use it when your buyers use words your
          site does not spell out.
        </p>

        <h3 className={H3}>Three-state pricing, with blanks kept blank</h3>
        <p className={P}>
          Up to 150 deduplicated candidates go to a search-data provider for
          volume, difficulty and intent. The answer comes back in three states
          that never collapse into each other: a measured volume, an explicit
          zero, or no data at all. Provider silence is not zero demand — in our
          own trials the provider stayed silent on roughly three quarters of
          generated candidates — so a term with no data is reported as exactly
          that, and no blank is ever dressed up as a number.
        </p>

        <h3 className={H3}>Your own queries as the duplicate filter</h3>
        <p className={P}>
          Your Search Console queries from the last 28 complete days tell the
          map which terms your site measurably already serves; those are
          withheld rather than recommended back to you. The check is honest
          about its own limits: Search Console anonymises a large share of
          queries, so absence from the sample is treated as &ldquo;not
          observed&rdquo;, never as proof of absence — and when the read fails
          outright, every row says the check did not run instead of quietly
          passing.
        </p>

        <h3 className={H3}>
          Every candidate except an explicit-zero term gets a real page one
        </h3>
        <p className={P}>
          Every deduplicated candidate except one the provider explicitly priced
          at zero enters durable waves of up to ten concurrent requests. Each
          completed keyword is checkpointed independently, so a provider gap
          stays attached to that keyword rather than silently shortening the
          plan. Each completed page reports three raw
          opportunity signals separately: a domain registered within 24 months,
          a domain whose estimated organic traffic is below the requesting
          site&apos;s tier threshold, or a community result. One observed signal
          makes a candidate eligible even when a sibling signal is unavailable;
          without a positive, unavailable evidence stays incomplete, and only
          three completed negatives exclude it.
        </p>
        <p className={P}>
          The provider&apos;s keyword intent and the model&apos;s interpretation of
          the organic top ten are different columns with different provenance.
          AI Overview availability is also a provider fact, while whether its
          returned answer fully addresses the query is an LLM assessment. A
          complete answer lowers ordering; it does not exclude the keyword.
        </p>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>The boundaries it will not cross</h2>
        <p className={P}>
          The weakest rank answers one narrow question — how weak is the weakest
          current holder — and remains raw context rather than the decision rule.
          The model interprets the bounded organic-result evidence, but it does
          not fetch and read every ranking page or model how many clicks an AI
          Overview absorbs. That is why its inferred intent and answer assessment
          carry model provenance, and why every row retains the decisions a
          reader still needs to make.
        </p>
        <p className={P}>
          The same discipline runs through the rest of the output. Term groups
          are lexical — words overlapping enough that one page might serve them
          — and are labelled a suggestion, because proving two terms share a
          page needs page-one overlap this run does not fetch. Numbers the run
          could not measure stay blank in the table and in the CSV export; a
          zero you did not measure is a lie with decimals. And a run that finds
          little says so: about a quarter of the sites we tested came back with
          the honest answer that public data does not support a keyword plan for
          them yet.
        </p>
        <ExampleTable locale="en" />
      </section>

      <section className={SECTION}>
        <h2 className={H2}>The method this feeds — and the half you keep</h2>
        <p className={P}>
          Our own selection method starts where difficulty scores end: open page
          one, read what the results actually answer, note who holds each place
          and whether an answer box has already taken the click. The map
          automates the measurable slice of that — pricing demand, opening the
          page, finding the weakest holder — and hands you everything it saw:
          the domain, its position, the page&apos;s features, the full audit
          trail of what was withheld and why.
        </p>
        <p className={P}>
          The final reading stays yours on purpose. Whether the weak site that
          broke through is defended or abandoned, whether the inferred intent
          matches the page you can actually build, whether the demand is your
          buyer — the tool has not read those ranking pages and will not pretend
          it has. Treat every row as a place worth looking, walk the remaining
          decisions printed on it, and spend your writing budget only on what
          survives your own eyes.
        </p>
      </section>

      <RelatedLinks locale="en" />
    </>
  );
}

function ZhArticle() {
  return (
    <>
      <section className={SECTION}>
        <h2 className={H2}>这张地图实际做了什么，一步一步说</h2>

        <h3 className={H3}>有边界的抓取，由你确认</h3>
        <p className={P}>
          运行从抓取你站点的至多二十个页面开始，产品页优先，并从中读出站点的定位。然后它会停下来，把读到的内容摆给你——每条陈述都带着来源
          URL——在花掉任何钱之前。这道确认门存在的原因是：候选词就是从这份读取里生成的，读错了词就会错，而只有你能看出读没读错。种子词一栏最多接受十个你自己的说法，它们会和抓取结果一起进入生成器——当买家用的词你的站点没有写出来时，用它。
        </p>

        <h3 className={H3}>三态核价，空白保持空白</h3>
        <p className={P}>
          去重后至多 150
          个候选词被送到搜索数据源，取回搜索量、难度和意图。答案永远是三种状态之一，且互不混淆：有实测量、明确为零、或完全没有数据。数据源的沉默不等于零需求——在我们自己的试跑里，大约四分之三的生成候选词数据源都没有回答——所以「无数据」就报告为无数据，任何空白都不会被打扮成数字。
        </p>

        <h3 className={H3}>用你自己的查询做去重过滤</h3>
        <p className={P}>
          你最近 28 个完整日的 Search Console
          查询，告诉地图哪些词你的站点已经在实测地服务；这些词会被拦下，而不是再推荐给你一遍。这项检查对自己的局限也诚实：Search
          Console
          会匿名化相当比例的查询，所以「不在样本里」只被当作「未观测到」，绝不当作「不存在」的证明——而当这一步读取彻底失败时，每一行都会写明「没查」，而不是悄悄放行。
        </p>

        <h3 className={H3}>除明确核价为零外，每个候选词都检查真实第一页</h3>
        <p className={P}>
          去重候选词中，除数据源明确核价为零的词以外，每一个都会进入每批最多十个并发请求的耐久步骤。每个完成的关键词都会独立写入检查点；数据源缺口会留在对应关键词上，不会悄悄缩短计划。每个完成的第一页分别报告三项原始机会信号：注册不超过
          24
          个月的域名、自然搜索预估流量低于当前站点层级阈值的域名、或社区结果。观测到任一信号即可进入机会区，即使同层另一项证据不可用也保留；没有正向信号时，缺失证据留在「检测未完成」；只有三项都完成且均为阴性才会排除。
        </p>
        <p className={P}>
          数据源返回的关键词意图，和模型对自然结果前十名的解读，会分列展示并保留各自来源。AI
          Overview
          是否出现也是数据源事实；它返回的答案是否完整回答查询，则是带模型来源的评估。完整回答只会降低排序，不会排除关键词。
        </p>
      </section>

      <section className={SECTION}>
        <h2 className={H2}>它刻意不越过的边界</h2>
        <p className={P}>
          「最弱排名」只回答一个很窄的问题——当前占位者里最弱的有多弱——它仍是原始上下文，不再单独作为判定规则。模型会解读有限的自然结果证据，但不会抓取并通读每一个排名页面，也不建模
          AI Overview
          会吸走多少点击。所以推断意图和答案评估都带着模型来源，每一行也保留仍需读者亲自作出的决定。
        </p>
        <p className={P}>
          同样的纪律贯穿其余输出。词组分组只看词面——措辞重合到可能共用一个页面——并被明确标注为建议，因为要证明两个词该共用页面，需要本次运行没有抓取的第一页重合度。运行测不到的数字，在表格里和
          CSV
          导出里都保持空白；一个没测过的零，是带小数点的谎言。而一次收获很少的运行会直说：我们测过的站点里大约四分之一得到的诚实答案是——公开数据目前撑不起这个站的关键词计划。
        </p>
        <ExampleTable locale="zh" />
      </section>

      <section className={SECTION}>
        <h2 className={H2}>它喂给的方法——以及留给你的那一半</h2>
        <p className={P}>
          我们自己的选词方法从难度分止步的地方开始：打开第一页，读清那些结果实际在回答什么，看清每个位置被谁占着、答案框是不是已经把点击拿走。这张地图把其中可测量的一段自动化了——核价需求、打开页面、找出最弱占位者——并把它看到的一切交给你：域名、排位、页面元素，以及每个词被拦下的完整台账。
        </p>
        <p className={P}>
          最后的阅读刻意留给你。攻进去的那个弱站是守得住还是已经废弃、推断意图和你真正能做的页面是不是一回事、这波需求是不是你的买家——工具没有读过那些排名页面，也不会假装读过。把每一行当成一个值得去看的地方，把行上保留的决定逐条走完，写作预算只花在通过你自己眼睛的词上。
        </p>
      </section>

      <RelatedLinks locale="zh" />
    </>
  );
}

export function KeywordMapArticle({ locale }: { readonly locale: string }) {
  return locale === "zh" ? <ZhArticle /> : <EnArticle />;
}
