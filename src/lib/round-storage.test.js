import {
  buildRoundStoragePayload,
  getRoundStorageMetadata,
  normalizeStoredRound
} from "./round-storage";

const buildHoles = (count, routeId = "route-a") =>
  Array.from({ length: count }, (_, index) => ({
    routeId,
    routeName: "Percorso",
    routePosition: count === 18 && index >= 9 ? 2 : 1,
    physicalHoleNumber: (index % 9) + 1,
    par: 4,
    strokeIndex: (index % 9) + 1,
    sourceStrokeIndex: (index % 9) + 1
  }));

describe("round storage", () => {
  test("maps a repeated 9-hole round to the normalized schema", () => {
    const competitionHoles = buildHoles(18);
    const payload = buildRoundStoragePayload({
      userId: "user-a",
      clubId: "club-a",
      setup: {
        totalCompetitionHoles: 18,
        startHole: 3,
        selectionMode: "repeated_single_9_18",
        selectedCombinationId: null
      },
      competitionName: "Coppa domenica",
      competitionHoles,
      scores: Array(18).fill(5),
      receivedShots: Array(18).fill(1),
      stablefordPoints: Array(18).fill(2),
      grossStablefordPoints: Array(18).fill(1),
      grossTotal: 90,
      netTotal: 72,
      estimatedHcpAfterRound: 35.8,
      handicapIndex: 36,
      playingHandicap: 36,
      selectedRouteTeeId: "tee-a",
      selectedCombinationTeeId: null,
      teeSnapshot: {
        tee_label: "Giallo",
        tee_color: "yellow",
        course_rating: 72.1,
        slope_rating: 129,
        par_total: 72
      }
    });

    expect(payload.round).toMatchObject({
      club_id: "club-a",
      holes_count: 18,
      total_par: 72,
      round_type: "repeat_9",
      gross_total: 90,
      net_total: 72,
      stableford_gross_total: 18,
      stableford_net_total: 36,
      selected_route_tee_id: "tee-a"
    });
    expect(payload.holes).toHaveLength(18);
    expect(payload.holes[9]).toMatchObject({
      round_hole_number: 10,
      route_position: 2,
      received_shots: 1,
      strokes: 5,
      stableford_points: 2
    });
    expect(getRoundStorageMetadata(payload.round.selected_routes)).toEqual({
      competitionName: "Coppa domenica",
      startHole: 3,
      routeName: "Percorso",
      teeSnapshot: {
        tee_label: "Giallo",
        tee_color: "yellow",
        course_rating: 72.1,
        slope_rating: 129,
        par_total: 72
      }
    });
  });

  test("maps two routes to a combined round", () => {
    const competitionHoles = [
      ...buildHoles(9, "route-a"),
      ...buildHoles(9, "route-b").map((hole) => ({ ...hole, routePosition: 2 }))
    ];
    const payload = buildRoundStoragePayload({
      userId: "user-a",
      clubId: "club-a",
      setup: { totalCompetitionHoles: 18, selectionMode: "manual_combination_18" },
      competitionName: "",
      competitionHoles,
      scores: Array(18).fill(4),
      receivedShots: Array(18).fill(0),
      stablefordPoints: Array(18).fill(2),
      grossStablefordPoints: Array(18).fill(2),
      grossTotal: 72,
      netTotal: 72,
      estimatedHcpAfterRound: 18,
      handicapIndex: 18,
      playingHandicap: 18
    });

    expect(payload.round.round_type).toBe("combined_9x2");
    expect(payload.round.selected_routes.map((route) => route.route_id)).toEqual([
      "route-a",
      "route-b"
    ]);
  });

  test("rejects an incomplete round", () => {
    expect(() =>
      buildRoundStoragePayload({
        setup: { totalCompetitionHoles: 18 },
        competitionHoles: buildHoles(9)
      })
    ).toThrow("La sequenza delle buche non è completa.");
  });

  test("restores scorecard history from normalized hole rows", () => {
    const storedRound = normalizeStoredRound(
      {
        id: "round-a",
        club_id: "club-a",
        created_at: "2026-09-23T10:00:00.000Z",
        holes_count: 9,
        selected_routes: [
          { competition_name: "Gara sociale", start_hole: 4 }
        ],
        gross_total: 45,
        net_total: 36,
        stableford_net_total: 37,
        playing_handicap: 18,
        round_holes: [
          {
            round_hole_number: 2,
            route_id: "route-a",
            route_position: 1,
            physical_hole_number: 5,
            par: 4,
            stroke_index: 2,
            received_shots: 1,
            strokes: 5
          },
          {
            round_hole_number: 1,
            route_id: "route-a",
            route_position: 1,
            physical_hole_number: 4,
            par: 3,
            stroke_index: 8,
            received_shots: 0,
            strokes: 3
          }
        ]
      },
      "Club prova"
    );

    expect(storedRound.savedName).toBe("Gara sociale");
    expect(storedRound.displayTitle).toBe("Gara sociale");
    expect(storedRound.displayMetadata).toBe("Club prova · 23/09/2026");
    expect(storedRound.courseName).toBe("Club prova");
    expect(storedRound.scores).toEqual([3, 5]);
    expect(storedRound.receivedShots).toEqual([0, 1]);
    expect(storedRound.manualReceivedShots).toEqual({});
    expect(storedRound.holes.map((hole) => hole.physicalHoleNumber)).toEqual([4, 5]);
  });

  test("uses club and route naming for a legacy unnamed round without inventing tee data", () => {
    const storedRound = normalizeStoredRound(
      {
        id: "legacy-round",
        club_id: "club-a",
        created_at: "2026-09-23T10:00:00.000Z",
        selected_routes: [{
          competition_name: "Giro",
          route_name: "18 Buche",
          start_hole: 1
        }],
        gross_total: 100,
        net_total: 58,
        stableford_gross_total: 8,
        stableford_net_total: 50,
        handicap_index_snapshot: 36.7,
        playing_handicap: 42,
        round_holes: []
      },
      "Marco Simone"
    );

    expect(storedRound.displayTitle).toBe("Marco Simone");
    expect(storedRound.displayMetadata).toBe("18 Buche · 23/09/2026");
    expect(storedRound.savedName).toBe("Marco Simone");
    expect(storedRound.tee).toBeNull();
    expect(storedRound).toMatchObject({
      handicapIndex: 36.7,
      playingHandicap: 42,
      grossTotal: 100,
      netTotal: 58,
      stablefordGrossTotal: 8,
      stablefordNetTotal: 50
    });
  });

  test("restores a legacy tee from the current catalog only when its stored id still matches", () => {
    const storedRound = normalizeStoredRound(
      {
        id: "legacy-round",
        club_id: "club-a",
        created_at: "2026-09-23T10:00:00.000Z",
        selected_route_tee_id: "tee-yellow",
        selected_routes: [{ route_name: "18 Buche" }],
        round_holes: []
      },
      {
        name: "Marco Simone",
        routes: [{
          id: "route-a",
          tees: [{
            id: "tee-yellow",
            teeName: "Giallo",
            teeColor: "yellow",
            courseRating: 72.1,
            slopeRating: 129,
            parTotal: 72
          }]
        }]
      }
    );

    expect(storedRound.tee).toEqual({
      label: "Giallo",
      color: "yellow",
      courseRating: 72.1,
      slopeRating: 129,
      par: 72
    });
  });

  test("keeps a new round tee snapshot even when the current catalog changes", () => {
    const storedRound = normalizeStoredRound(
      {
        id: "snapshot-round",
        club_id: "club-a",
        created_at: "2026-09-23T10:00:00.000Z",
        selected_route_tee_id: "tee-yellow",
        selected_routes: [{
          route_name: "18 Buche",
          tee_snapshot: {
            tee_label: "Giallo",
            tee_color: "yellow",
            course_rating: 72.1,
            slope_rating: 129,
            par_total: 72
          }
        }],
        round_holes: []
      },
      {
        name: "Marco Simone",
        routes: [{
          tees: [{
            id: "tee-yellow",
            teeName: "Bianco",
            courseRating: 74,
            slopeRating: 140,
            parTotal: 72
          }]
        }]
      }
    );

    expect(storedRound.tee).toEqual({
      label: "Giallo",
      color: "yellow",
      courseRating: 72.1,
      slopeRating: 129,
      par: 72
    });
  });
});
