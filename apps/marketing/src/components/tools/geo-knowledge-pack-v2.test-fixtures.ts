// @input  -- literal v2 pack content, built through the real contract builder
// @output -- one valid published pack exercising every origin, decision and group state
// @pos    -- test fixture; the builder is what proves the fixture is contract-valid
import { buildGeoKnowledgePackV2 } from "../../lib/geo-tools/kb-knowledge-pack-v2-contract.ts";

const AT = "2026-09-04T07:11:15.461Z";
const LATER = "2026-12-03T00:00:00.000Z";
const key = (digit: string) => digit.repeat(64);

const provenance = (over: Record<string, unknown>) => ({
  origin: "synthesized",
  decision: "accepted_in_bulk",
  sourceRefs: ["source:home"],
  priorSourceRefs: [],
  ownerDeclaredAt: null,
  evidenceChecks: "cited_and_literals_match",
  ...over,
});

const statement = (id: string, itemKey: string, text: string) => ({ id, text, itemKey, ...provenance({}) });

/**
 * Everything a renderer has to tell apart, in one pack:
 * three origins, both published decisions, an owner correction with a
 * superseded reference, and evidence groups in all three collection states.
 */
export function geoKnowledgePackV2Fixture() {
  return buildGeoKnowledgePackV2({
    schemaVersion: "marketing-geo-knowledge-pack.v2",
    meta: {
      generatedAt: AT,
      lastScanAt: AT,
      market: "US",
      language: "en",
      counts: { facts: 3, qa: 1, comparisons: 1, accepted: 2, acceptedInBulk: 8 },
    },
    entity: {
      status: "available",
      value: {
        name: "Example Cloud",
        aliases: ["Example"],
        categories: { primary: "Workflow software", secondary: ["Team software"] },
        definitions: {
          w25: "Example Cloud is workflow software for small teams.",
          w55: "Example Cloud gives small teams a shared workflow with documented handoffs.",
          w120: "Example Cloud gives small teams a shared workflow with documented handoffs and keeps human approval in the loop.",
        },
        audience: { who: "Small operations teams", notFor: "Fully autonomous decisions" },
        founded: { year: null, team: null, location: null },
        disambiguation: "Example Cloud is the workflow product, not the similarly named consultancy.",
        links: {
          home: "https://example.com/",
          pricing: null,
          docs: "https://example.com/docs",
          about: null,
          changelog: null,
          faq: null,
        },
        sameAs: [],
        sourceRefs: ["source:home"],
        fields: [{
          field: "name",
          itemKey: key("a"),
          origin: "declared_profile",
          decision: "accepted",
          sourceRefs: ["source:home"],
          priorSourceRefs: [],
          ownerDeclaredAt: null,
          evidenceChecks: "not_applicable",
        }],
      },
    },
    facts: {
      status: "available",
      value: [
        {
          id: "fact:approval",
          type: "feature",
          statement: "Example Cloud keeps human approval in each workflow.",
          label: "Approval",
          value: "Human approval required",
          reason: "",
          subject: "Example Cloud",
          attribute: "approval",
          qualifiers: [],
          observedAt: AT,
          nextReviewAt: LATER,
          itemKey: key("b"),
          ...provenance({}),
        },
        {
          // An owner correction: it cites nothing, and the page that carried
          // the value it replaced moves to priorSourceRefs.
          id: "fact:price",
          type: "price",
          statement: "The Pro plan costs nine US dollars per month.",
          label: "Pro price",
          value: "nine US dollars per month",
          reason: "",
          subject: "Example Cloud",
          attribute: "price",
          qualifiers: ["Pro"],
          observedAt: null,
          nextReviewAt: null,
          itemKey: key("c"),
          ...provenance({
            origin: "declared_owner",
            decision: "accepted",
            sourceRefs: [],
            priorSourceRefs: ["source:home"],
            ownerDeclaredAt: AT,
            evidenceChecks: "owner_declared",
          }),
        },
        {
          id: "fact:coverage",
          type: "company",
          statement: "An independent review describes the approval workflow.",
          label: "Coverage",
          value: "Independent review published",
          reason: "",
          subject: "Example Cloud",
          attribute: "coverage",
          qualifiers: [],
          observedAt: AT,
          nextReviewAt: null,
          itemKey: key("d"),
          ...provenance({ origin: "observed_third_party", sourceRefs: ["source:press"] }),
        },
      ],
    },
    qa: {
      status: "partial",
      limitation: "Only questions supported by the published pages are included.",
      value: [{
        id: "qa:approval",
        intent: "trust",
        question: "Does Example Cloud replace human approval?",
        canonicalQuestion: "does example cloud replace human approval",
        variants: ["Is approval automated?"],
        directAnswer: "No. A person approves each workflow.",
        expansion: "The documentation describes the approval step in every workflow.",
        itemKey: key("e"),
        ...provenance({}),
      }],
    },
    comparisons: {
      status: "available",
      value: [{
        id: "comparison:rival",
        competitor: { key: "rival.example", name: "Rival", confirmed: true },
        checkedAt: AT,
        rows: [{
          id: "row:approval",
          dimension: "Approval",
          product: "Human approval required",
          competitor: "Configurable approval",
          availability: "available",
          itemKey: key("f"),
          ...provenance({ sourceRefs: ["source:home", "source:rival"] }),
        }],
        verdict: "Both keep a person in the approval loop.",
        sourceRefs: ["source:home", "source:rival"],
      }],
    },
    scope: {
      status: "available",
      value: {
        does: [statement("scope:does", key("0"), "Documents workflow handoffs.")],
        doesNot: [statement("scope:not", key("1"), "Does not replace human approval.")],
        needsHuman: [statement("scope:human", key("2"), "A person approves each workflow.")],
        misconceptions: [statement("scope:myth", key("3"), "It is workflow software, not a human team.")],
      },
    },
    evidence: {
      status: "available",
      value: {
        proof: [{
          id: "evidence:docs",
          label: "Product documentation",
          summary: "The documentation describes the human approval workflow.",
          url: "https://example.com/docs",
          sourceRefs: ["source:home"],
          independence: "first_party",
        }],
        changelog: [],
        press: [{
          id: "evidence:press",
          label: "Independent review",
          summary: "A review with its own byline describes the approval workflow.",
          url: "https://press.example/example-cloud",
          sourceRefs: ["source:press"],
          independence: "independent",
        }],
        thirdPartyProfiles: [],
        firstPartyProof: [],
        // press was looked for and found; changelog was looked for and empty;
        // the other two were never looked for at all.
        collected: ["proof", "changelog", "press"],
      },
    },
    machine: {
      status: "available",
      value: {
        jsonLd: { status: "present", types: ["Organization"], sourceRefs: ["source:home"] },
        llms: { status: "present", sourceRefs: ["source:llms"] },
        robots: { status: "present", sourceRefs: ["source:robots"] },
        sitemap: { status: "present", urlCount: "2", knowledgePagesListed: true, sourceRefs: ["source:sitemap"] },
        hreflang: { status: "present", locales: ["en"], sourceRefs: ["source:home"] },
        aiCrawlers: {
          search: [{ agent: "OAI-SearchBot", access: "allowed" }],
          training: [{ agent: "GPTBot", access: "disallowed" }],
          sourceRefs: ["source:robots"],
        },
        snippets: { status: "allowed", sourceRefs: ["source:home"] },
      },
    },
    coverage: {
      status: "available",
      value: [{
        id: "coverage:entity",
        label: "Entity definition",
        status: "partial",
        summary: "The product definition is published, but no public company history was found.",
        nextAction: "Publish an About page with company history.",
        sourceRefs: ["source:home"],
      }],
    },
    sourceCatalogue: [
      {
        id: "source:home",
        kind: "own_page",
        label: "Product page",
        url: "https://example.com/",
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: key("a"),
        excerpts: ["Example Cloud is workflow software. Human approval remains required."],
        independence: null,
      },
      {
        id: "source:rival",
        kind: "competitor_page",
        label: "Rival product page",
        url: "https://rival.example/",
        competitor: { key: "rival.example", name: "Rival", confirmed: true },
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: key("b"),
        excerpts: ["Rival offers configurable approval."],
        independence: null,
      },
      {
        id: "source:press",
        kind: "third_party_page",
        label: "Press review",
        url: "https://press.example/example-cloud",
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: key("c"),
        excerpts: ["An independent review describes the approval workflow of Example Cloud."],
        independence: "independent",
      },
      {
        id: "source:llms",
        kind: "llms",
        label: "llms.txt",
        url: "https://example.com/llms.txt",
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: key("d"),
        excerpts: ["Example Cloud product index."],
        independence: null,
      },
      {
        id: "source:robots",
        kind: "robots",
        label: "robots.txt",
        url: "https://example.com/robots.txt",
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: key("e"),
        excerpts: ["User-agent: OAI-SearchBot Allow: /"],
        independence: null,
      },
      {
        id: "source:sitemap",
        kind: "sitemap",
        label: "sitemap.xml",
        url: "https://example.com/sitemap.xml",
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: key("f"),
        excerpts: ["Two product URLs were observed."],
        independence: null,
      },
    ],
  });
}
