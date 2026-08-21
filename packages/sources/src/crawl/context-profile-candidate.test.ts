import { describe, expect, it } from "vitest";

import {
  classifyContextProfileCandidate,
  type ContextProfileCandidateExclusionReason,
  type ContextProfileCandidateKind,
} from "./context-profile-candidate.ts";

const EN = { targetLanguage: "en", maxDepth: 3 } as const;

describe("classifyContextProfileCandidate", () => {
  it.each([
    ["/about", "company_utility"],
    ["/en/about", "company_utility"],
    ["/zh/about-us", "company_utility"],
    ["/contact-us", "company_utility"],
    ["/careers", "company_utility"],
    ["/jobs", "company_utility"],
    ["/privacy", "legal_policy"],
    ["/privacy-policy", "legal_policy"],
    ["/terms-of-service", "legal_policy"],
    ["/legal-notice", "legal_policy"],
    ["/impressum", "legal_policy"],
    ["/login", "account_auth"],
    ["/sign-in", "account_auth"],
    ["/signup", "account_auth"],
    ["/register", "account_auth"],
    ["/my-account", "account_auth"],
    ["/dashboard", "account_auth"],
    ["/auth/login", "account_auth"],
    ["/customer-dashboard", "account_auth"],
  ] as const)("hard-excludes %s as %s", (path, reason) => {
    expect(classifyContextProfileCandidate(path, EN)).toMatchObject({
      eligible: false,
      reason: reason satisfies ContextProfileCandidateExclusionReason,
    });
  });

  it.each([
    ["/company/privacy-policy", "legal_policy"],
    ["/portal/login", "account_auth"],
    ["/company/careers", "company_utility"],
    ["/customer/account/login", "account_auth"],
  ] as const)("hard-excludes nested utility route %s as %s", (path, reason) => {
    expect(classifyContextProfileCandidate(path, EN)).toMatchObject({
      eligible: false,
      reason: reason satisfies ContextProfileCandidateExclusionReason,
    });
  });

  it.each([
    "/blog/how-to-price",
    "/resources/how-to-price",
    "/articles/how-to-price",
    "/posts/how-to-price",
    "/en/resources/how-to-price",
  ])("excludes the content detail page %s", (path) => {
    expect(classifyContextProfileCandidate(path, EN)).toMatchObject({
      eligible: false,
      reason: "content_detail",
    });
  });

  it.each([
    "/pricing?page=2",
    "/blog?paged=3",
    "/resources?page_number=4",
    "/pricing?offset=20",
    "/page/2",
    "/resources/page/2",
    "/en/blog/page/10",
  ])("excludes pagination before it can be ranked: %s", (path) => {
    expect(classifyContextProfileCandidate(path, EN)).toMatchObject({
      eligible: false,
      reason: "pagination",
    });
  });

  it.each([
    ["/features", "product"],
    ["/tools", "product"],
    ["/customers", "product"],
    ["/pricing", "pricing"],
    ["/pricing?utm_source=nav", "pricing"],
    ["/blog", "content_list"],
    ["/resources", "content_list"],
    ["/articles", "content_list"],
    ["/posts", "content_list"],
    ["/story-generators/fantasy", "fallback"],
  ] as const)("admits %s as %s", (path, kind) => {
    expect(classifyContextProfileCandidate(path, EN)).toMatchObject({
      eligible: true,
      kind: kind satisfies ContextProfileCandidateKind,
    });
  });

  it("keeps a foreign locale and an over-depth URL out of the frontier", () => {
    expect(classifyContextProfileCandidate("/fr/pricing", EN)).toMatchObject({
      eligible: false,
      reason: "foreign_locale",
    });
    expect(
      classifyContextProfileCandidate("/one/two/three/four", EN),
    ).toMatchObject({ eligible: false, reason: "depth_limit" });
  });

  it("does not misread ordinary query parameters as pagination", () => {
    expect(
      classifyContextProfileCandidate("/pricing?page=one&utm_source=x", EN),
    ).toMatchObject({ eligible: true, kind: "pricing" });
    expect(
      classifyContextProfileCandidate("/pricing?offset=0", EN),
    ).toMatchObject({ eligible: true, kind: "pricing" });
  });

  it.each(["/solutions/legal", "/product/account"])(
    "does not exclude a product page because a deeper segment is %s",
    (path) => {
      expect(classifyContextProfileCandidate(path, EN)).toMatchObject({
        eligible: true,
        kind: "product",
      });
    },
  );
});
