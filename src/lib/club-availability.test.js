import { isFigCatalogClubAwaitingPlayableData } from "./club-availability";

const figReviewClub = {
  sourceType: "fig_import",
  figClubId: "fig-villa-giusti",
  playable: false,
  dataStatus: "needs_review",
  sourcePayload: { governance_state: "in_review" },
  routes: [],
  routeCombinations: []
};

describe("isFigCatalogClubAwaitingPlayableData", () => {
  test("recognizes Villa Giusti's FIG review state", () => {
    expect(isFigCatalogClubAwaitingPlayableData(figReviewClub)).toBe(true);
  });

  test("does not affect green or orange playable clubs", () => {
    expect(
      isFigCatalogClubAwaitingPlayableData({
        ...figReviewClub,
        playable: true,
        dataStatus: "verified",
        routes: [{ id: "route" }]
      })
    ).toBe(false);
    expect(
      isFigCatalogClubAwaitingPlayableData({
        ...figReviewClub,
        playable: true,
        routes: [{ id: "route" }]
      })
    ).toBe(false);
  });

  test("does not replace the request flow for a user-created FIG placeholder", () => {
    expect(
      isFigCatalogClubAwaitingPlayableData({
        ...figReviewClub,
        sourceType: "user",
        clubTaxonomy: "complex_official"
      })
    ).toBe(false);
  });

  test("does not affect a configured complex club such as Parco de' Medici", () => {
    expect(
      isFigCatalogClubAwaitingPlayableData({
        sourceType: "stablr",
        figClubId: "fig-parco-medici",
        playable: true,
        dataStatus: "verified",
        sourcePayload: { protected_manual: true },
        routes: [{ id: "bianco" }],
        routeCombinations: [{ id: "championship" }]
      })
    ).toBe(false);
  });
});
