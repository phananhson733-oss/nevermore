import { describe, expect, it } from "vitest";
import {
  createGrowthMapNavigationJournal,
  observeGrowthMapCanonicalSearch,
  requestGrowthMapNavigation,
  settleGrowthMapNavigation,
} from "./_growth-map-navigation.ts";

const PATHNAME = "/p/project/growth-map";

describe("Growth Map navigation journal", () => {
  it("composes repeated pending URL selections from the latest intent", () => {
    let journal = createGrowthMapNavigationJournal(
      "object=pages&selectedSitePageId=product",
    );

    const gone = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "gone",
      selectedFindingId: null,
    });
    journal = gone.journal;
    const home = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "home",
      selectedFindingId: null,
    });
    journal = home.journal;
    const productAgain = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "product",
      selectedFindingId: null,
    });
    journal = productAgain.journal;

    expect(gone.href).toBe(
      `${PATHNAME}?object=pages&selectedSitePageId=gone`,
    );
    expect(home.href).toBe(
      `${PATHNAME}?object=pages&selectedSitePageId=home`,
    );
    expect(productAgain.href).toBe(
      `${PATHNAME}?object=pages&selectedSitePageId=product`,
    );
    expect(journal.requestedSearch).toBe(
      "object=pages&selectedSitePageId=product",
    );
  });

  it("keeps the latest intent while older canonical navigations settle", () => {
    let journal = createGrowthMapNavigationJournal(
      "object=pages&selectedSitePageId=product",
    );
    journal = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "gone",
    }).journal;
    journal = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "home",
    }).journal;
    journal = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "product",
    }).journal;

    journal = observeGrowthMapCanonicalSearch(
      journal,
      "object=pages&selectedSitePageId=gone",
    );
    expect(journal.requestedSearch).toBe(
      "object=pages&selectedSitePageId=product",
    );
    expect(journal.pendingSearches).toEqual([
      "object=pages&selectedSitePageId=home",
      "object=pages&selectedSitePageId=product",
    ]);

    journal = observeGrowthMapCanonicalSearch(
      journal,
      "object=pages&selectedSitePageId=home",
    );
    expect(journal.requestedSearch).toBe(
      "object=pages&selectedSitePageId=product",
    );
    expect(journal.pendingSearches).toEqual([
      "object=pages&selectedSitePageId=product",
    ]);

    journal = observeGrowthMapCanonicalSearch(
      journal,
      "object=pages&selectedSitePageId=product",
    );
    expect(journal.pendingSearches).toEqual([]);
    expect(journal.requestedSearch).toBe(
      "object=pages&selectedSitePageId=product",
    );
  });

  it("lets an optimistic object switch and its new pane share one query baseline", () => {
    let journal = createGrowthMapNavigationJournal(
      "object=pages&q=product&selectedSitePageId=page-a",
    );

    const keywords = requestGrowthMapNavigation(journal, PATHNAME, {
      mode: "keywords",
    });
    journal = keywords.journal;
    const pagesAgain = requestGrowthMapNavigation(journal, PATHNAME, {
      mode: "pages",
    });
    journal = pagesAgain.journal;
    const selected = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "page-b",
    });

    expect(keywords.href).toBe(`${PATHNAME}?object=keywords`);
    expect(pagesAgain.href).toBe(`${PATHNAME}?object=pages`);
    expect(selected.href).toBe(
      `${PATHNAME}?object=pages&selectedSitePageId=page-b`,
    );
  });

  it("forgets a same-canonical round trip after its transition settles", () => {
    const initialSearch = "object=pages&selectedSitePageId=product";
    let journal = createGrowthMapNavigationJournal(initialSearch);
    journal = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "gone",
    }).journal;
    journal = requestGrowthMapNavigation(journal, PATHNAME, {
      selectedSitePageId: "product",
    }).journal;

    journal = settleGrowthMapNavigation(journal, initialSearch);
    expect(journal.pendingSearches).toEqual([]);

    journal = observeGrowthMapCanonicalSearch(
      journal,
      "object=pages&selectedSitePageId=gone",
    );
    expect(journal).toEqual(
      createGrowthMapNavigationJournal(
        "object=pages&selectedSitePageId=gone",
      ),
    );
  });
});
