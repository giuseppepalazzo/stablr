import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const IMPORT_CANDIDATES_PATH = path.join(
  repoRoot,
  "data",
  "gesgolf",
  "mappings",
  "import-candidates.json"
);
const FIG_CATALOG_PATH = path.join(
  repoRoot,
  "data",
  "fig",
  "normalized",
  "fig-catalog-normalized.json"
);
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

function getArgValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function getBooleanArgValue(flag, fallback = false) {
  const value = getArgValue(flag, null);
  if (value === null) return fallback;
  return ["1", "true", "yes", "si", "sì"].includes(String(value).trim().toLowerCase());
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function arraysEqual(left = [], right = []) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hasCompressedNineHoleStrokeIndexes(holes = []) {
  if (!Array.isArray(holes) || holes.length !== 9) {
    return false;
  }

  const indexes = holes.map((hole) => hole.hcp);
  return indexes.every((value) => Number.isInteger(value) && value >= 1 && value <= 9);
}

function findOfficialNineHoleStrokeIndexSegment(gesRoute, gesPlayableCourses) {
  if (!hasCompressedNineHoleStrokeIndexes(gesRoute.holes)) {
    return null;
  }

  const routePars = gesRoute.holes.map((hole) => hole.par);

  const matchingOfficial18 = (gesPlayableCourses || []).find((candidate) => {
    if (candidate.holes_count !== 18 || !Array.isArray(candidate.holes) || candidate.holes.length !== 18) {
      return false;
    }

    const frontNinePars = candidate.holes.slice(0, 9).map((hole) => hole.par);
    const backNinePars = candidate.holes.slice(9, 18).map((hole) => hole.par);

    return arraysEqual(frontNinePars, routePars) || arraysEqual(backNinePars, routePars);
  });

  if (!matchingOfficial18) {
    return null;
  }

  const frontNineHoles = matchingOfficial18.holes.slice(0, 9);
  const backNineHoles = matchingOfficial18.holes.slice(9, 18);
  const frontNinePars = frontNineHoles.map((hole) => hole.par);
  const backNinePars = backNineHoles.map((hole) => hole.par);

  if (arraysEqual(frontNinePars, routePars)) {
    return frontNineHoles.map((hole) => hole.hcp);
  }

  if (arraysEqual(backNinePars, routePars)) {
    return backNineHoles.map((hole) => hole.hcp);
  }

  return null;
}

function buildRouteHoles(gesRoute, gesPlayableCourses, importProfile) {
  const officialNineHoleIndexes = findOfficialNineHoleStrokeIndexSegment(
    gesRoute,
    gesPlayableCourses
  );
  const requiresOfficialNineHoleSegment =
    Number(gesRoute.holes_count) === 9 &&
    hasCompressedNineHoleStrokeIndexes(gesRoute.holes) &&
    ["physical_9_with_official_18_variants", "physical_18_with_official_9_segments"].includes(
      importProfile
    );

  assert(
    !requiresOfficialNineHoleSegment || officialNineHoleIndexes,
    `Stroke Index compressi non risolti per ${gesRoute.name}: nessun segmento 18 ufficiale combacia con par buca-per-buca.`
  );

  return gesRoute.holes.map((hole, index) => ({
    physical_hole_number: hole.hole_number,
    par: hole.par,
    stroke_index: officialNineHoleIndexes?.[index] ?? hole.hcp,
    display_label: String(hole.hole_number)
  }));
}

function normalizeRouteName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&#176;|°/g, " ")
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPrimeNineName(value) {
  const normalized = normalizeRouteName(value);
  return (
    normalized.includes("prime nove") ||
    normalized.includes("prima nove") ||
    normalized.includes("first 9") ||
    normalized.includes("1 nove") ||
    normalized.includes("1 9")
  );
}

function isSecondNineName(value) {
  const normalized = normalizeRouteName(value);
  return (
    normalized.includes("seconde nove") ||
    normalized.includes("seconda nove") ||
    normalized.includes("second 9") ||
    normalized.includes("2 nove") ||
    normalized.includes("2 9")
  );
}

function inferImportProfile(routeCandidates, figClub) {
  const hasOfficialEighteen = routeCandidates.some(
    (candidate) => Number(candidate.ges_holes_count) === 18
  );
  const nineHoleCandidates = routeCandidates.filter(
    (candidate) => Number(candidate.ges_holes_count) === 9
  );

  const routeNames = [
    ...routeCandidates.map((candidate) => candidate.ges_route_name),
    ...(figClub.playable_courses || []).map((course) => course.name)
  ];

  const hasPrimeAndSecondNines =
    routeNames.some((name) => isPrimeNineName(name)) &&
    routeNames.some((name) => isSecondNineName(name));

  if (hasOfficialEighteen && hasPrimeAndSecondNines) {
    return {
      physicalHoleCount: 18,
      importProfile: "physical_18_with_official_9_segments"
    };
  }

  if (hasOfficialEighteen && nineHoleCandidates.length > 0) {
    return {
      physicalHoleCount: 9,
      importProfile: "physical_9_with_official_18_variants"
    };
  }

  return {
    physicalHoleCount: hasOfficialEighteen ? 18 : 9,
    importProfile: hasOfficialEighteen ? "physical_18" : "physical_9"
  };
}

function selectSimplePhysicalNineRouteCandidate(routeCandidates) {
  const nineHoleCandidates = routeCandidates.filter(
    (candidate) => Number(candidate.ges_holes_count) === 9
  );

  assert(
    nineHoleCandidates.length > 0,
    "Campo fisico 9 buche senza route GesGolf da 9 buche import_ready."
  );

  return [...nineHoleCandidates].sort((left, right) => {
    const leftName = `${left.suggested_fig_name || ""} ${left.ges_route_name || ""}`;
    const rightName = `${right.suggested_fig_name || ""} ${right.ges_route_name || ""}`;
    const leftIsGenericNine = !isPrimeNineName(leftName) && !isSecondNineName(leftName);
    const rightIsGenericNine = !isPrimeNineName(rightName) && !isSecondNineName(rightName);

    if (leftIsGenericNine !== rightIsGenericNine) {
      return leftIsGenericNine ? -1 : 1;
    }

    const leftPar = Number(left.ges_total_par || 0);
    const rightPar = Number(right.ges_total_par || 0);
    if (leftPar !== rightPar) return leftPar - rightPar;

    return String(left.ges_route_name || "").localeCompare(String(right.ges_route_name || ""), "it");
  })[0];
}

function isOfficialEighteenRouteCandidate(candidate) {
  return (
    Number(candidate?.ges_holes_count) === 18 &&
    String(candidate?.ges_playable_kind || "").trim().toLowerCase() === "official_18"
  );
}

function getDefaultPhysicalNineOfficialEighteenPar(clubName) {
  const normalizedClubName = normalizeRouteName(clubName);

  if (normalizedClubName === "albisola") {
    return 65;
  }

  return null;
}

function getDefaultPhysicalNineRoutePar(clubName) {
  const normalizedClubName = normalizeRouteName(clubName);

  if (normalizedClubName === "albisola") {
    return 32;
  }

  return null;
}

function shouldKeepPhysicalNineRouteVariants(clubName) {
  const normalizedClubName = normalizeRouteName(clubName);
  return normalizedClubName === "albisola";
}

function getPhysicalNineRouteDisplayName(routeCandidate, gesRoute) {
  if (normalizeRouteName(routeCandidate.fig_club) === "albisola") {
    return `Prime 9 · Par ${gesRoute.total_par}`;
  }

  return "9 Buche";
}

function buildRoundVariantPayload(routeCandidate, gesRoute, importProfile, isDefaultOfficialEighteenVariant) {
  if (importProfile === "physical_9_with_official_18_variants") {
    if (Number(gesRoute.holes_count) === 9) {
      const defaultNineHolePar = getDefaultPhysicalNineRoutePar(routeCandidate.fig_club);
      const isDefaultNineHoleRoute = Number(gesRoute.total_par) === Number(defaultNineHolePar);

      return {
        holes_count: 9,
        default_for_holes: isDefaultNineHoleRoute ? 9 : null,
        default_source: isDefaultNineHoleRoute ? "official_club_site_and_gesgolf" : "gesgolf",
        note:
          "GesGolf is considered a highly reliable operational source for official 9-hole variants on physical 9-hole clubs."
      };
    }

    if (Number(gesRoute.holes_count) === 18) {
      return {
        holes_count: 18,
        default_for_holes: isDefaultOfficialEighteenVariant ? 18 : null,
        default_source: isDefaultOfficialEighteenVariant
          ? "official_club_site_and_gesgolf"
          : "gesgolf",
        note:
          "GesGolf is considered a highly reliable operational source for official 18-hole variants on physical 9-hole clubs."
      };
    }
  }

  if (importProfile === "physical_18_with_official_9_segments") {
    if (Number(gesRoute.holes_count) === 18) {
      return {
        holes_count: 18,
        default_for_holes: 18,
        default_source: "fig_gesgolf_official_site",
        note: "Default full round for physical 18-hole clubs."
      };
    }

    if (Number(gesRoute.holes_count) === 9) {
      return {
        holes_count: 9,
        default_for_holes: isPrimeNineName(gesRoute.name) ? 9 : null,
        default_source: isPrimeNineName(gesRoute.name) ? "fig_gesgolf_official_site" : "gesgolf",
        note:
          "For physical 18-hole clubs, Prime Nove is the default 9-hole option and Seconde Nove remains the secondary option."
      };
    }
  }

  return null;
}

function simplifyRouteCandidatesForProduct(routeCandidates, importProfile) {
  if (importProfile !== "physical_9_with_official_18_variants") {
    return routeCandidates;
  }

  const defaultNineHoleRoute = selectSimplePhysicalNineRouteCandidate(routeCandidates);
  const nineHoleRouteVariants = shouldKeepPhysicalNineRouteVariants(defaultNineHoleRoute.fig_club)
    ? routeCandidates
        .filter((candidate) => Number(candidate.ges_holes_count) === 9)
        .sort((left, right) => {
          const defaultPar = getDefaultPhysicalNineRoutePar(left.fig_club);
          const leftIsDefault = Number(left.ges_total_par) === Number(defaultPar);
          const rightIsDefault = Number(right.ges_total_par) === Number(defaultPar);
          if (leftIsDefault !== rightIsDefault) return leftIsDefault ? -1 : 1;
          return Number(left.ges_total_par || 0) - Number(right.ges_total_par || 0);
        })
    : [defaultNineHoleRoute];
  const officialEighteenVariants = routeCandidates.filter(isOfficialEighteenRouteCandidate);

  return [...nineHoleRouteVariants, ...officialEighteenVariants];
}

async function findGesGolfNormalizedPath(figClubName, circoloId) {
  const expectedPath = path.join(
    GESGOLF_NORMALIZED_DIR,
    slugify(figClubName),
    `circolo-${circoloId}.json`
  );

  if (await fileExists(expectedPath)) {
    return expectedPath;
  }

  const directories = await fs.readdir(GESGOLF_NORMALIZED_DIR, { withFileTypes: true });
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const candidatePath = path.join(GESGOLF_NORMALIZED_DIR, entry.name, `circolo-${circoloId}.json`);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`File GesGolf normalizzato non trovato per ${figClubName} (${circoloId}).`);
}

function buildRoutePayload(routeCandidate, gesRoute, figCourse, gesPlayableCourses, importProfile) {
  const isSimplifiedPhysicalNine = importProfile === "physical_9_with_official_18_variants";
  const isPhysicalNineOfficialEighteenVariant =
    isSimplifiedPhysicalNine && Number(gesRoute.holes_count) === 18;
  const isPhysicalNineRouteVariant =
    isSimplifiedPhysicalNine && Number(gesRoute.holes_count) === 9;
  const defaultNineHolePar = getDefaultPhysicalNineRoutePar(routeCandidate.fig_club);
  const defaultOfficialEighteenPar = getDefaultPhysicalNineOfficialEighteenPar(
    routeCandidate.fig_club
  );
  const isDefaultNineHoleRoute =
    isPhysicalNineRouteVariant && Number(gesRoute.total_par) === Number(defaultNineHolePar);
  const isDefaultOfficialEighteenVariant =
    isPhysicalNineOfficialEighteenVariant &&
    Number(gesRoute.total_par) === Number(defaultOfficialEighteenPar);
  const roundVariantPayload = buildRoundVariantPayload(
    routeCandidate,
    gesRoute,
    importProfile,
    isDefaultOfficialEighteenVariant
  );
  const displayName =
    isPhysicalNineRouteVariant
      ? getPhysicalNineRouteDisplayName(routeCandidate, gesRoute)
      : figCourse.name;
  const displayOrder =
    isDefaultNineHoleRoute
      ? 1
      : isPhysicalNineRouteVariant
        ? 10 + Number(gesRoute.total_par || 0)
      : isDefaultOfficialEighteenVariant
        ? 2
        : isPhysicalNineOfficialEighteenVariant
          ? 20 + Number(gesRoute.total_par || 0)
          : figCourse.display_order ?? null;

  return {
    external_key: figCourse.source_external_id,
    name: displayName,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: displayOrder,
    is_active: figCourse.is_active ?? true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: "gesgolf",
      ...(displayName !== figCourse.name
        ? {
            fig_display_name: figCourse.name,
            stablr_product_name: displayName
          }
        : {}),
      ...(isSimplifiedPhysicalNine
        ? {
            product_simplification:
              Number(gesRoute.holes_count) === 9
                ? "physical_9_route_variant"
                : "physical_9_official_18_variant",
            ...(roundVariantPayload ? { round_variant: roundVariantPayload } : {})
          }
        : {}),
      ...(!isSimplifiedPhysicalNine && roundVariantPayload
        ? {
            round_variant: roundVariantPayload
          }
        : {}),
      gesgolf: {
        circolo_id: routeCandidate.circolo_id,
        gesgolf_club: routeCandidate.gesgolf_club,
        route_name: routeCandidate.ges_route_name,
        playable_kind: routeCandidate.ges_playable_kind,
        percorso_id: gesRoute.percorso_id
      }
    },
    holes: buildRouteHoles(gesRoute, gesPlayableCourses, importProfile),
    tees: (figCourse.tees || []).map((tee) => ({
      tee_name: tee.tee_name,
      tee_color: tee.tee_color || null,
      gender: tee.gender || null,
      course_rating: tee.course_rating ?? null,
      slope_rating: tee.slope_rating ?? null,
      par_total: tee.par_total ?? figCourse.total_par ?? null,
      is_active: tee.is_active ?? true,
      source_system: "fig",
      source_external_id: tee.source_external_id,
      source_payload: {
        ...(tee.source_payload || {}),
        official_catalog: "fig"
      }
    }))
  };
}

async function main() {
  const clubName = getArgValue("--club");
  const dataStatus = getArgValue("--data-status", "verified");
  const stablrApproved = getBooleanArgValue("--stablr-approved", false);
  const verificationStatus = getArgValue(
    "--verification-status",
    dataStatus === "verified" ? "verified" : "playable_review"
  );
  const verificationNotes = getArgValue("--verification-notes", "");
  assert(clubName, "Uso: node scripts/gesgolf/build-normalized-import.mjs --club \"Albisola\"");
  assert(
    ["verified", "community", "needs_review"].includes(dataStatus),
    "--data-status deve essere uno tra verified, community, needs_review."
  );

  const importCandidates = await readJson(IMPORT_CANDIDATES_PATH);
  const figCatalog = await readJson(FIG_CATALOG_PATH);

  const clubSummary = (importCandidates.clubs || []).find((club) => club.fig_club === clubName);
  assert(clubSummary, `Club non trovato in import-candidates: ${clubName}`);
  assert(
    clubSummary.club_status === "import_ready",
    `${clubName} non e' ancora import_ready (status: ${clubSummary.club_status}).`
  );
  assert(clubSummary.protected_live !== "yes", `${clubName} e' protetto e non puo' essere esportato.`);

  const routeCandidates = (importCandidates.routes || []).filter(
    (route) => route.fig_club === clubName && route.import_bucket === "import_ready"
  );
  assert(routeCandidates.length > 0, `Nessuna route import_ready trovata per ${clubName}.`);
  assert(
    routeCandidates.length === clubSummary.import_required_routes,
    `${clubName} non ha ancora tutte le route richieste pronte (${routeCandidates.length}/${clubSummary.import_required_routes}).`
  );

  const figClub = (figCatalog.clubs || []).find((club) => club.name === clubName);
  assert(figClub, `Club FIG non trovato nel catalogo normalizzato: ${clubName}`);

  const normalizedPath = await findGesGolfNormalizedPath(clubName, clubSummary.circolo_id);
  const gesNormalized = await readJson(normalizedPath);

  const figCourseMap = new Map(
    (figClub.playable_courses || []).map((course) => [course.source_external_id, course])
  );
  const { physicalHoleCount, importProfile } = inferImportProfile(routeCandidates, figClub);
  const productRouteCandidates = simplifyRouteCandidatesForProduct(routeCandidates, importProfile);

  const routes = productRouteCandidates
    .map((candidate) => {
      const figCourse = figCourseMap.get(candidate.suggested_fig_source_external_id);
      assert(
        figCourse,
        `Percorso FIG non trovato per ${candidate.ges_route_name}: ${candidate.suggested_fig_source_external_id}`
      );

      const gesRoute = (gesNormalized.playable_courses || []).find(
        (route) =>
          route.name === candidate.ges_route_name &&
          route.holes_count === candidate.ges_holes_count &&
          route.total_par === candidate.ges_total_par
      );
      assert(
        gesRoute,
        `Percorso GesGolf non trovato nel file normalizzato: ${candidate.ges_route_name}`
      );
      assert(
        gesRoute.status === "safe",
        `Percorso GesGolf non sicuro per ${candidate.ges_route_name}: ${gesRoute.status}.`
      );

      return buildRoutePayload(
        candidate,
        gesRoute,
        figCourse,
        gesNormalized.playable_courses || [],
        importProfile
      );
    })
    .sort((left, right) => (left.display_order ?? 999) - (right.display_order ?? 999));

  const payload = {
    schema_version: "1.0",
    source: {
      system: "gesgolf",
      scraped_at: gesNormalized.source?.scraped_at || new Date().toISOString(),
      club_external_id: figClub.source_external_id,
      notes: `Official FIG catalog + GesGolf hole-by-hole import pilot for ${clubName}`
    },
    club: {
      name: figClub.name,
      name_normalized: figClub.name_normalized,
      city: figClub.city || null,
      country: figClub.country || "Italia",
      data_status: dataStatus,
      source_type: "fig_import",
      is_complex: false,
      playable: true,
      is_active: figClub.is_active ?? true,
      source_system: "fig",
      source_external_id: figClub.source_external_id,
      source_payload: {
        ...(figClub.source_payload || {}),
        official_catalog: "fig",
        hole_by_hole_source: "gesgolf",
        verification_status: verificationStatus,
        ...(stablrApproved ? { stablr_approved: true } : {}),
        ...(verificationNotes ? { verification_notes: verificationNotes } : {}),
        physical_hole_count: physicalHoleCount,
        import_profile: importProfile,
        gesgolf: {
          circolo_id: clubSummary.circolo_id,
          gesgolf_club: clubSummary.gesgolf_club
        }
      }
    },
    routes,
    route_combinations: []
  };

  validateNormalizedPayload(payload);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `${slugify(clubName)}-normalized.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        club: clubName,
        routes: routes.length,
        route_combinations: 0,
        input: normalizedPath,
        output: outputPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
