import { describe, expect, it } from "vitest";

import { createAgentProfileDraft } from "./agent-profile";
import { getSuppliedProductInformation } from "./agent-product-information";

describe("supplied Product Information presentation", () => {
  it("preserves every document section needed by the AstrologyWiki Product Profile", () => {
    const content = getSuppliedProductInformation(
      createAgentProfileDraft("seo", "astrologywiki.com"),
      "en",
    );

    expect(content).not.toBeNull();
    expect(content).toMatchObject({
      website: "astrologywiki.com",
      productType: "Software as a service (SaaS)",
      functionOverview:
        "Users enter a birth date, time, and place to generate an accurate natal chart in 30 seconds, covering the Sun, Moon, Ascendant, and every planetary position.",
      targetCustomers:
        "People interested in astrology who use a birth chart for self-understanding and psychological exploration, especially personal growth, relationship analysis, and emotional insight.",
      paymentProcessor: "Airwallex",
      currencies: ["USD", "EUR", "GBP", "CNY"],
    });
    expect(content?.pricing).toEqual([
      {
        name: "Free",
        price: "$0",
        detail: "Core birth chart, encyclopedia, and CBT journal",
      },
      {
        name: "Pro monthly",
        price: "$6.99 / month",
        detail: "Cancel anytime",
      },
      {
        name: "Pro annual",
        price: "$41.99 / year",
        detail: "50% off the first subscription · 7-day Pro trial",
      },
      {
        name: "Credit packs",
        price: "$4.99 – $34.99",
        detail:
          "100 / $4.99 · 300 / $12.49 · 500 / $19.99 · 1,000 / $34.99",
      },
    ]);
    expect(content?.features[4]).toEqual({
      name: "AI oracle",
      detail: "3 questions / week on Free · 10 questions / week on Pro",
    });
    expect(content?.features[6].detail).toContain("Saturn return calculator");
    expect(content?.technicalSignals).toContain(
      "Anonymous calculation; birth data is not written to URLs or analytics events",
    );
  });

  it("localizes the supplied document content without inventing it for another host", () => {
    const zh = getSuppliedProductInformation(
      createAgentProfileDraft("tech", "astrologywiki.com", "zh-CN"),
      "zh-CN",
    );

    expect(zh?.productType).toBe("软件即服务（SaaS）");
    expect(zh?.pricing[2]).toEqual({
      name: "专业版年付",
      price: "$41.99 / 年",
      detail: "首次订阅 5 折 · 7 天专业版试用",
    });
    expect(
      getSuppliedProductInformation(
        createAgentProfileDraft("seo", "example.com"),
        "en",
      ),
    ).toBeNull();
  });
});
