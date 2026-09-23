function toFiniteNumber(value, fallback = 0) {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toNullableFiniteNumber(value) {
  if (value === null || typeof value === "undefined" || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getStoredRoundType(setup, competitionHoles) {
  const holesCount = Number(setup?.totalCompetitionHoles || competitionHoles.length || 0);
  if (holesCount === 9) return "single_9";

  const selectionMode = String(setup?.selectionMode || "");
  const routeIds = new Set(
    competitionHoles.map((hole) => hole?.routeId).filter(Boolean)
  );

  if (
    setup?.selectedCombinationId ||
    selectionMode === "official_combination_18" ||
    selectionMode === "manual_combination_18" ||
    routeIds.size > 1
  ) {
    return "combined_9x2";
  }

  if (selectionMode === "repeated_single_9_18") return "repeat_9";
  return "single_18";
}

function getSelectedRoutes(setup, competitionHoles, competitionName, teeSnapshot) {
  const selectedRoutes = [];
  const seenSegments = new Set();

  competitionHoles.forEach((hole) => {
    const routeId = String(hole?.routeId || "");
    const routePosition = Math.min(2, Math.max(1, toFiniteNumber(hole?.routePosition, 1)));
    const segmentKey = `${routeId}:${routePosition}`;

    if (!routeId || seenSegments.has(segmentKey)) return;
    seenSegments.add(segmentKey);
    selectedRoutes.push({
      route_id: routeId,
      route_position: routePosition,
      route_name: String(hole?.routeName || ""),
      competition_name: String(competitionName || ""),
      start_hole: Math.max(1, toFiniteNumber(setup?.startHole, 1)),
      selection_mode: String(setup?.selectionMode || ""),
      ...(teeSnapshot ? { tee_snapshot: teeSnapshot } : {})
    });
  });

  return selectedRoutes;
}

export function buildRoundStoragePayload({
  userId,
  clubId,
  setup,
  competitionName,
  competitionHoles,
  scores,
  receivedShots,
  stablefordPoints,
  grossStablefordPoints,
  grossTotal,
  netTotal,
  estimatedHcpAfterRound,
  handicapIndex,
  playingHandicap,
  selectedRouteTeeId,
  selectedCombinationTeeId,
  teeSnapshot
}) {
  const holesCount = Number(setup?.totalCompetitionHoles || competitionHoles?.length || 0);

  if (![9, 18].includes(holesCount) || competitionHoles?.length !== holesCount) {
    throw new Error("La sequenza delle buche non è completa.");
  }

  const holeRows = competitionHoles.map((hole, index) => {
    if (!hole?.routeId) {
      throw new Error(`Manca il percorso associato alla buca ${index + 1}.`);
    }

    return {
      user_id: userId,
      club_id: clubId,
      route_id: hole.routeId,
      route_combination_id: setup?.selectedCombinationId || null,
      round_hole_number: index + 1,
      route_position: Math.min(2, Math.max(1, toFiniteNumber(hole.routePosition, 1))),
      physical_hole_number: toFiniteNumber(
        hole.physicalHoleNumber || hole.courseHoleNumber,
        index + 1
      ),
      par: toFiniteNumber(hole.par),
      stroke_index: hole.strokeIndex ? toFiniteNumber(hole.strokeIndex) : null,
      source_stroke_index: hole.sourceStrokeIndex
        ? toFiniteNumber(hole.sourceStrokeIndex)
        : null,
      received_shots: Math.min(3, Math.max(0, toFiniteNumber(receivedShots[index]))),
      strokes: Math.min(20, Math.max(0, toFiniteNumber(scores[index]))),
      stableford_points: Math.min(
        10,
        Math.max(0, toFiniteNumber(stablefordPoints[index]))
      )
    };
  });

  return {
    round: {
      user_id: userId,
      club_id: clubId,
      route_combination_id: setup?.selectedCombinationId || null,
      holes_count: holesCount,
      total_par: competitionHoles.reduce(
        (sum, hole) => sum + toFiniteNumber(hole?.par),
        0
      ),
      round_type: getStoredRoundType(setup, competitionHoles),
      selected_routes: getSelectedRoutes(
        setup,
        competitionHoles,
        competitionName,
        teeSnapshot
      ),
      gross_total: toFiniteNumber(grossTotal),
      net_total: toFiniteNumber(netTotal),
      stableford_gross_total: grossStablefordPoints.reduce(
        (sum, points) => sum + toFiniteNumber(points),
        0
      ),
      stableford_net_total: stablefordPoints.reduce(
        (sum, points) => sum + toFiniteNumber(points),
        0
      ),
      estimated_hcp_after_round: toFiniteNumber(estimatedHcpAfterRound),
      selected_route_tee_id: selectedRouteTeeId || null,
      selected_combination_tee_id: selectedCombinationTeeId || null,
      handicap_index_snapshot: toFiniteNumber(handicapIndex),
      playing_handicap: Math.round(toFiniteNumber(playingHandicap)),
      whs_source:
        selectedRouteTeeId || selectedCombinationTeeId ? "catalog_tee" : "profile_fallback"
    },
    holes: holeRows
  };
}

export function getRoundStorageMetadata(selectedRoutes) {
  const firstRoute = Array.isArray(selectedRoutes) ? selectedRoutes[0] : null;
  return {
    competitionName: String(firstRoute?.competition_name || ""),
    startHole: Math.max(1, toFiniteNumber(firstRoute?.start_hole, 1)),
    routeName: (Array.isArray(selectedRoutes) ? selectedRoutes : [])
      .map((route) => String(route?.route_name || "").trim())
      .filter((name, index, names) => name && names.indexOf(name) === index)
      .join(" / "),
    teeSnapshot: firstRoute?.tee_snapshot || null
  };
}

function formatStoredRoundDate(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function isCustomCompetitionName(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "giro") return false;
  return !/^giro(?:[_\s-]+\d{1,2}[/-]\d{1,2}[/-]\d{4})?$/i.test(normalized);
}

function getDisplayRouteName(routeName, holesCount) {
  const normalizedName = String(routeName || "").trim();
  const isGenericRouteName = /^(percorso|route)$/i.test(normalizedName);
  if (normalizedName && !isGenericRouteName) return normalizedName;

  const numericHolesCount = Number(holesCount);
  return [9, 18].includes(numericHolesCount) ? `${numericHolesCount} Buche` : "";
}

function findCurrentCatalogTee(round, course) {
  if (!course || typeof course !== "object") return null;

  if (round?.selected_combination_tee_id) {
    const combinations = Array.isArray(course.routeCombinations)
      ? course.routeCombinations
      : [];
    for (const combination of combinations) {
      const tee = (Array.isArray(combination?.tees) ? combination.tees : []).find(
        (candidate) => candidate?.id === round.selected_combination_tee_id
      );
      if (tee) return tee;
    }
  }

  if (round?.selected_route_tee_id) {
    const routes = Array.isArray(course.routes) ? course.routes : [];
    for (const route of routes) {
      const tee = (Array.isArray(route?.tees) ? route.tees : []).find(
        (candidate) => candidate?.id === round.selected_route_tee_id
      );
      if (tee) return tee;
    }
  }

  return null;
}

function normalizeTeeSnapshot(snapshot, fallbackTee) {
  const source = snapshot || fallbackTee;
  if (!source) return null;

  const label = String(
    source.tee_label || source.teeLabel || source.teeName || source.name || ""
  ).trim();
  const color = String(
    source.tee_color || source.teeColor || source.color || label || ""
  ).trim();
  const courseRating = toNullableFiniteNumber(
    source.course_rating ?? source.courseRating
  );
  const slopeRating = toNullableFiniteNumber(
    source.slope_rating ?? source.slopeRating
  );
  const par = toNullableFiniteNumber(
    source.par_total ?? source.parTotal
  );

  if (!label && !color && courseRating === null && slopeRating === null) return null;
  return { label, color, courseRating, slopeRating, par };
}

export function normalizeStoredRound(round, course = "") {
  const metadata = getRoundStorageMetadata(round?.selected_routes);
  const formattedDate = formatStoredRoundDate(round?.created_at);
  const courseName = typeof course === "string" ? course : String(course?.name || "");
  const hasCustomName = isCustomCompetitionName(metadata.competitionName);
  const routeName = getDisplayRouteName(metadata.routeName, round?.holes_count);
  const tee = normalizeTeeSnapshot(
    metadata.teeSnapshot,
    findCurrentCatalogTee(round, course)
  );
  const storedHoles = (Array.isArray(round?.round_holes) ? round.round_holes : [])
    .slice()
    .sort(
      (left, right) =>
        toFiniteNumber(left?.round_hole_number) - toFiniteNumber(right?.round_hole_number)
    );
  const derivedGrossTotal = storedHoles.length
    ? storedHoles.reduce((sum, hole) => sum + toFiniteNumber(hole?.strokes), 0)
    : null;
  const derivedNetTotal = storedHoles.length
    ? storedHoles.reduce(
        (sum, hole) =>
          sum + toFiniteNumber(hole?.strokes) - toFiniteNumber(hole?.received_shots),
        0
      )
    : null;
  const derivedStablefordGrossTotal = storedHoles.length
    ? storedHoles.reduce(
        (sum, hole) =>
          sum + Math.max(0, 2 + toFiniteNumber(hole?.par) - toFiniteNumber(hole?.strokes)),
        0
      )
    : null;
  const canUseStoredStablefordNet =
    storedHoles.length > 0 &&
    storedHoles.every(
      (hole) => hole?.stableford_points !== null && typeof hole?.stableford_points !== "undefined"
    );
  const derivedStablefordNetTotal = storedHoles.length
    ? storedHoles.reduce(
        (sum, hole) =>
          sum +
          (canUseStoredStablefordNet
            ? toFiniteNumber(hole?.stableford_points)
            : Math.max(
                0,
                2 +
                  toFiniteNumber(hole?.par) -
                  (toFiniteNumber(hole?.strokes) - toFiniteNumber(hole?.received_shots))
              )),
        0
      )
    : null;

  return {
    id: round?.id,
    savedName: hasCustomName ? metadata.competitionName : courseName,
    displayTitle: hasCustomName ? metadata.competitionName : courseName,
    displayMetadata: [hasCustomName ? courseName : routeName, formattedDate]
      .filter(Boolean)
      .join(" · "),
    competitionName: hasCustomName ? metadata.competitionName : "",
    courseId: round?.club_id,
    courseName,
    routeName,
    createdAt: round?.created_at,
    formattedDate,
    handicapIndex: toNullableFiniteNumber(round?.handicap_index_snapshot),
    playingHandicap: toNullableFiniteNumber(round?.playing_handicap),
    playerHcp: toFiniteNumber(round?.playing_handicap, toFiniteNumber(round?.handicap_index_snapshot)),
    tee,
    selectedRouteTeeId: round?.selected_route_tee_id || null,
    selectedCombinationTeeId: round?.selected_combination_tee_id || null,
    totalCompetitionHoles: toFiniteNumber(round?.holes_count, storedHoles.length),
    totalPar:
      toNullableFiniteNumber(round?.total_par) ??
      (storedHoles.length ? storedHoles.reduce((sum, hole) => sum + toFiniteNumber(hole?.par), 0) : 0),
    startHole: metadata.startHole,
    grossTotal: toNullableFiniteNumber(round?.gross_total) ?? derivedGrossTotal,
    netTotal: toNullableFiniteNumber(round?.net_total) ?? derivedNetTotal,
    stablefordGrossTotal:
      toNullableFiniteNumber(round?.stableford_gross_total) ?? derivedStablefordGrossTotal,
    stablefordNetTotal:
      toNullableFiniteNumber(round?.stableford_net_total) ?? derivedStablefordNetTotal,
    stablefordTotal: toFiniteNumber(
      round?.stableford_net_total,
      toFiniteNumber(round?.stableford_gross_total)
    ),
    estimatedHcpAfterRound: toFiniteNumber(round?.estimated_hcp_after_round),
    scores: storedHoles.map((hole) => toFiniteNumber(hole?.strokes)),
    receivedShots: storedHoles.map((hole) => toFiniteNumber(hole?.received_shots)),
    manualReceivedShots: {},
    holes: storedHoles.map((hole) => ({
      competitionHoleNumber: toFiniteNumber(hole?.round_hole_number),
      routeId: hole?.route_id,
      routePosition: toFiniteNumber(hole?.route_position, 1),
      courseHoleNumber: toFiniteNumber(hole?.physical_hole_number),
      physicalHoleNumber: toFiniteNumber(hole?.physical_hole_number),
      par: toFiniteNumber(hole?.par),
      strokeIndex: hole?.stroke_index ? toFiniteNumber(hole.stroke_index) : null,
      sourceStrokeIndex: hole?.source_stroke_index
        ? toFiniteNumber(hole.source_stroke_index)
        : null,
      stablefordNet: toNullableFiniteNumber(hole?.stableford_points)
    }))
  };
}
