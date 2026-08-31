# DataForSEO adapters

Provider HTTP boundaries preserve observed values, availability, budgets, and charged cost. Tests inject the transport; they do not call live providers.

| Module | Responsibility |
| --- | --- |
| `client.ts`, `adapter.ts` | Shared DataForSEO client and source adapter. |
| `keyword-metrics.ts` | Keyword metrics, sampled organic SERP and bulk domain ranks. `includePeopleAlsoAsk` only retains initial PAA questions from the same response; it never enables paid expansion. PAA availability and malformed/truncated counts remain separate from organic-page counts. |
| `backlinks.ts` | Backlink source operations. |
| `labs-traffic.ts` | Labs traffic observations. |
| `market-language.ts`, `generated/` | Supported market/language metadata. |
| `search-landscape.ts`, `search-landscape-v2.ts`, `search-landscape-v3.ts` | Versioned search-landscape contracts and reads. |

Adjacent `*.test.ts` files cover the public adapters and their bounded, injected provider responses. PAA questions describe topics observed in a sampled SERP; they are not verified answers or proof that a competitor page covers the topic.
