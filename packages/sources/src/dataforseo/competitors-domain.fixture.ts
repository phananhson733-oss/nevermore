/**
 * Trimmed fixture matching the documented DataForSEO Labs
 * `google/competitors_domain/live` response shape. Fields that this package
 * does not retain are intentionally present so tests prove the HTTP boundary
 * produces a small, credential-free response rather than persisting the
 * provider envelope.
 */
export function officialCompetitorsDomainLiveFixture(): unknown {
  return {
    version: "0.1.20260722",
    status_code: 20_000,
    status_message: "Ok.",
    time: "0.4481 sec.",
    cost: 0.0203,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "07291542-0000-0451-0000-1f0522c14d2b",
        status_code: 20_000,
        status_message: "Ok.",
        time: "0.4012 sec.",
        cost: 0.0203,
        result_count: 1,
        path: ["v3", "dataforseo_labs", "google", "competitors_domain", "live"],
        data: {
          api: "dataforseo_labs",
          function: "competitors_domain",
          se_type: "google",
          target: "example.com",
          location_name: "United States",
          language_code: "en",
        },
        result: [
          {
            se_type: "google",
            target: "example.com",
            location_code: 2_840,
            language_code: "en",
            total_count: 2,
            items_count: 2,
            items: [
              {
                se_type: "google",
                domain: "rival-one.example",
                avg_position: 12.25,
                sum_position: 49,
                intersections: 4,
                full_domain_metrics: {
                  organic: {
                    pos_1: 3,
                    pos_2_3: 9,
                    pos_4_10: 20,
                    etv: 3_210.5,
                  },
                },
                metrics: {
                  organic: {
                    pos_1: 1,
                    pos_2_3: 2,
                    pos_4_10: 1,
                    etv: 900.25,
                  },
                },
                competitor_metrics: {
                  organic: {
                    pos_1: 4,
                    pos_2_3: 8,
                    pos_4_10: 17,
                    count: 29,
                    etv: 1_850.75,
                    estimated_paid_traffic_cost: 4_200.5,
                    is_new: 1,
                    is_up: 3,
                    is_down: 2,
                    is_lost: 0,
                  },
                },
              },
              {
                se_type: "google",
                domain: "rival-two.example",
                avg_position: 8,
                sum_position: 8,
                intersections: 1,
                full_domain_metrics: {
                  organic: {
                    pos_1: 1,
                    pos_2_3: 2,
                    pos_4_10: 4,
                    etv: 1_100,
                  },
                },
                metrics: {
                  organic: {
                    pos_1: 0,
                    pos_2_3: 1,
                    pos_4_10: 0,
                    etv: 120,
                  },
                },
                competitor_metrics: {
                  organic: {
                    pos_1: 2,
                    pos_2_3: 3,
                    pos_4_10: 5,
                    count: 10,
                    etv: 700,
                    estimated_paid_traffic_cost: 950,
                    is_new: 0,
                    is_up: 1,
                    is_down: 0,
                    is_lost: 0,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
