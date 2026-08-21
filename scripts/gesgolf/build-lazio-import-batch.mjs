import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_CATALOG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

const CLUBS = [
  {
    name: "Archi Claudio",
    dataStatus: "verified",
    approved: true,
    physicalHoleCount: 9,
    importProfile: "physical_9_with_official_18_variants",
    holeSource: "official_club_site_images",
    notes:
      "Stablr Approved: FIG CR/Slope + official Archi di Claudio course page/images. Official images expose PAR/HCP pairs for the 9 physical holes and repeated 18-hole numbering; current official page confirms Par 32.",
    officialCourseLinks: [
      "https://www.archidiclaudiogolf.it/percorsi/percorso-9-buche/"
    ],
    holes9: [
      [1, 3, 5],
      [2, 3, 17],
      [3, 3, 11],
      [4, 4, 15],
      [5, 4, 1],
      [6, 3, 13],
      [7, 4, 9],
      [8, 3, 7],
      [9, 5, 3]
    ],
    routes: [
      { figCourse: "9 Buche Provvisorio 2026", name: "9 Buche", holes: "front9", displayOrder: 1, defaultForHoles: 9 },
      { figCourse: "18 Buche Provvisorio 2026", name: "18 Buche", holes: "repeat9Pairs", displayOrder: 2, defaultForHoles: 18 }
    ]
  },
  {
    name: "Castelgandolfo",
    dataStatus: "verified",
    approved: true,
    physicalHoleCount: 18,
    importProfile: "physical_18_simple_current",
    holeSource: "official_club_site",
    notes:
      "Stablr Approved: FIG Campionato CR/Slope + official Country Club Castelgandolfo course page with full PAR/HCP table. The temporary par-71/par-3 variants caused by course works are intentionally not exposed as the main UX structure.",
    officialCourseLinks: [
      "https://www.countryclubcastelgandolfo.it/it9/golf/percorso"
    ],
    holes18: [
      [1, 4, 5],
      [2, 3, 15],
      [3, 4, 7],
      [4, 4, 1],
      [5, 5, 11],
      [6, 4, 9],
      [7, 3, 13],
      [8, 5, 3],
      [9, 4, 17],
      [10, 4, 4],
      [11, 5, 12],
      [12, 3, 16],
      [13, 4, 6],
      [14, 4, 14],
      [15, 5, 2],
      [16, 4, 10],
      [17, 3, 18],
      [18, 4, 8]
    ],
    routes: [
      { figCourse: "Campionato", name: "18 Buche", holes: "all18", displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", holes: "front9", displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", holes: "back9", displayOrder: 3, defaultForHoles: null }
    ]
  },
  {
    name: "Fiuggi 1928",
    dataStatus: "needs_review",
    approved: false,
    physicalHoleCount: 18,
    importProfile: "physical_18_simple",
    holeSource: "third_party_scorecard_cross_checked_with_fig_and_official_site_par",
    notes:
      "FIG CR/Slope + official club/Federgolf Lazio page confirms 18-hole Par 70. Hole-by-hole PAR/SI imported from public scorecard sources; keep orange until official club scorecard/PDF confirms SI.",
    officialCourseLinks: [
      "https://golfclubfiuggi1928.it/percorso/",
      "https://www.federgolflazio.it/circoli-del-lazio/golf-club-fiuggi-1928/"
    ],
    holes18: [
      [1, 5, 9],
      [2, 4, 17],
      [3, 3, 15],
      [4, 4, 3],
      [5, 3, 13],
      [6, 4, 1],
      [7, 4, 5],
      [8, 5, 11],
      [9, 3, 7],
      [10, 5, 12],
      [11, 3, 2],
      [12, 4, 18],
      [13, 3, 4],
      [14, 4, 8],
      [15, 5, 6],
      [16, 3, 16],
      [17, 4, 14],
      [18, 4, 10]
    ],
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", holes: "all18", displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", holes: "front9", displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", holes: "back9", displayOrder: 3, defaultForHoles: null }
    ]
  },
  {
    name: "Marina Velka",
    dataStatus: "needs_review",
    approved: false,
    physicalHoleCount: 9,
    importProfile: "physical_9_with_official_18_variants",
    holeSource: "third_party_scorecard_cross_checked_with_fig_and_official_site_par",
    notes:
      "FIG CR/Slope + official club/Federgolf Lazio pages confirm physical 9-hole Par 35. Hole-by-hole PAR/SI imported from public scorecard evidence; keep orange until official club scorecard confirms SI.",
    officialCourseLinks: [
      "https://www.marinavelkagolfclub.it/",
      "https://www.federgolflazio.it/circoli-del-lazio/marina-velka-club/"
    ],
    holes9: [
      [1, 4, 7],
      [2, 3, 9],
      [3, 5, 1],
      [4, 3, 17],
      [5, 4, 5],
      [6, 4, 13],
      [7, 3, 11],
      [8, 5, 3],
      [9, 4, 15]
    ],
    routes: [
      { figCourse: "9 Buche", name: "9 Buche", holes: "front9", displayOrder: 1, defaultForHoles: 9 },
      { figCourse: "18 Buche", name: "18 Buche", holes: "repeat9Pairs", displayOrder: 2, defaultForHoles: 18 }
    ]
  },
  {
    name: "Nazionale",
    dataStatus: "needs_review",
    approved: false,
    physicalHoleCount: 18,
    importProfile: "physical_18_simple",
    gesSlug: "nazionale",
    gesCircoloId: "601",
    gesRoute: "SCORE",
    gesRouteId: "1615",
    holeSource: "gesgolf",
    notes:
      "FIG Campionato CR/Slope + GesGolf SCORE hole-by-hole import. Official club site confirms course structure but a full official PAR/HCP scorecard was not found in the third-level scan; keep orange pending official confirmation.",
    officialCourseLinks: [
      "https://golfnazionale.it/"
    ],
    routes: [
      { figCourse: "Campionato", name: "18 Buche", holes: "gesAll18", displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", holes: "gesFront9", displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", holes: "gesBack9", displayOrder: 3, defaultForHoles: null }
    ]
  },
  {
    name: "Parco Roma",
    dataStatus: "verified",
    approved: true,
    physicalHoleCount: 18,
    importProfile: "physical_18_simple",
    gesSlug: "parco-roma",
    gesCircoloId: "783",
    gesRoute: "STANDARD",
    gesRouteId: "2433",
    holeSource: "fig_gesgolf_official_site",
    notes:
      "Stablr Approved: FIG Castello CR/Slope + GesGolf STANDARD hole-by-hole import + official Parco di Roma hole pages exposing PAR/HCP. Official hole page data matches the selected GesGolf sequence.",
    officialCourseLinks: [
      "https://www.golfparcodiroma.it/buche/buca-1/",
      "https://www.gesgolf.it/GolfOnline/Clubs/percorsi.aspx?circolo_id=783"
    ],
    routes: [
      { figCourse: "Castello", name: "18 Buche", holes: "gesAll18", displayOrder: 1, defaultForHoles: 18 },
      { figCourse: "Castello 1&#176;Nove", name: "Prime Nove", holes: "gesFront9", displayOrder: 2, defaultForHoles: 9 },
      { figCourse: "Castello 2&#176;Nove", name: "Seconde Nove", holes: "gesBack9", displayOrder: 3, defaultForHoles: null }
    ]
  },
  {
    name: "Rieti",
    dataStatus: "needs_review",
    approved: false,
    physicalHoleCount: 9,
    importProfile: "physical_9_with_official_18_variants",
    holeSource: "third_party_scorecard_cross_checked_with_fig_and_official_site_par",
    notes:
      "FIG CR/Slope + official club/Federgolf Lazio pages confirm physical 9-hole Par 35. Hole-by-hole PAR/SI imported from public scorecard evidence; keep orange until official club scorecard confirms SI.",
    officialCourseLinks: [
      "https://www.golfclubrieti.com/",
      "https://www.federgolflazio.it/circoli-del-lazio/rieti-centro-ditalia/"
    ],
    holes9: [
      [1, 4, 5],
      [2, 4, 8],
      [3, 3, 9],
      [4, 4, 3],
      [5, 5, 1],
      [6, 4, 7],
      [7, 4, 4],
      [8, 4, 2],
      [9, 3, 6]
    ],
    routes: [
      { figCourse: "9 Buche", name: "9 Buche", holes: "front9", displayOrder: 1, defaultForHoles: 9 },
      { figCourse: "18 Buche", name: "18 Buche", holes: "repeat9Pairs", displayOrder: 2, defaultForHoles: 18 }
    ]
  },
  {
    name: "Terre Consoli",
    dataStatus: "needs_review",
    approved: false,
    isComplex: true,
    physicalHoleCount: 27,
    physicalRouteCount: 2,
    importProfile: "complex_27_championship_family",
    gesSlug: "terre-consoli",
    gesCircoloId: "499",
    holeSource: "gesgolf",
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import for Championship and Family/Executive routes. Official site confirms Championship Course and Family Course structure, but full official SI table was not found; keep orange pending manual/secretary confirmation.",
    officialCourseLinks: [
      "https://terredeiconsoligolfclub.it/en/course/championship-course/",
      "https://terredeiconsoligolfclub.it/tariffe/",
      "https://www.gesgolf.it/GolfOnline/Clubs/percorsi.aspx?circolo_id=499"
    ],
    routes: [
      { figCourse: "Executive PAR 31", name: "Family", gesRoute: "Family", gesRouteId: "1693", holes: "gesAll", displayOrder: 1, defaultForHoles: 9 },
      { figCourse: "prime 9 camp 2019", name: "Championship · Prime 9", gesRoute: "PRIME 9 CHAMP.", gesRouteId: "2495", holes: "gesAll", displayOrder: 2, defaultForHoles: null },
      { figCourse: "seconde 9 camp 2019", name: "Championship · Seconde 9", gesRoute: "SECONDE 9 CHAMP", gesRouteId: "2496", holes: "gesAll", displayOrder: 3, defaultForHoles: null },
      { figCourse: "18 buche 2019", name: "Championship", gesRoute: "Championship 20", gesRouteId: "1876", holes: "gesAll", displayOrder: 4, defaultForHoles: 18 },
      { figCourse: "18 Buche Par 73", name: "Championship · Par 73", gesRoute: "C. PAR 73 NEW", gesRouteId: "2717", holes: "gesAll", displayOrder: 5, defaultForHoles: null },
      { figCourse: "Executive PAR 62", name: "Family × 2", gesRoute: "Family 18", gesRouteId: "1694", holes: "gesAll", displayOrder: 6, defaultForHoles: null }
    ]
  }
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFigClub(figCatalog, name) {
  const club = (figCatalog.clubs || []).find((candidate) => candidate.name === name);
  assert(club, `Club FIG non trovato: ${name}`);
  return club;
}

function findFigCourse(figClub, name) {
  const course = (figClub.playable_courses || []).find((candidate) => candidate.name === name);
  assert(course, `Percorso FIG non trovato per ${figClub.name}: ${name}`);
  return course;
}

async function loadGesRoute(config, routeConfig = null) {
  const gesPath = path.join(
    GESGOLF_NORMALIZED_DIR,
    config.gesSlug,
    `circolo-${config.gesCircoloId}.json`
  );
  const gesNormalized = await readJson(gesPath);
  const name = routeConfig?.gesRoute || config.gesRoute;
  const routeId = routeConfig?.gesRouteId || config.gesRouteId;
  const route = (gesNormalized.playable_courses || []).find(
    (candidate) => candidate.name === name && String(candidate.percorso_id) === String(routeId)
  );
  assert(route, `Route GesGolf non trovata: ${config.name} / ${name} (${routeId})`);
  assert(route.status === "safe", `Route GesGolf non safe: ${config.name} / ${route.status}`);
  return { gesNormalized, route };
}

function holesFromTriples(triples) {
  return triples.map(([holeNumber, par, strokeIndex]) => ({
    physical_hole_number: holeNumber,
    par,
    stroke_index: strokeIndex,
    display_label: String(holeNumber)
  }));
}

function repeatNineWithPairs(holes9) {
  const front = holes9.map(([holeNumber, par, strokeIndex]) => ({
    physical_hole_number: holeNumber,
    par,
    stroke_index: strokeIndex,
    display_label: String(holeNumber)
  }));
  const back = holes9.map(([holeNumber, par, strokeIndex]) => ({
    physical_hole_number: holeNumber + 9,
    par,
    stroke_index: Number(strokeIndex) + 1,
    display_label: String(holeNumber + 9)
  }));
  return [...front, ...back];
}

function holesFromGes(gesHoles, start = 0, count = gesHoles.length, labelPrefix = "") {
  return gesHoles.slice(start, start + count).map((hole, index) => ({
    physical_hole_number: index + 1,
    par: hole.par,
    stroke_index: hole.hcp,
    display_label: labelPrefix ? `${labelPrefix} ${index + 1}` : String(index + 1)
  }));
}

function selectHoles(config, routeConfig, gesRoute = null) {
  switch (routeConfig.holes) {
    case "all18":
      return holesFromTriples(config.holes18);
    case "front9":
      return holesFromTriples(config.holes9 || config.holes18.slice(0, 9));
    case "back9":
      return holesFromTriples(config.holes18.slice(9, 18).map(([holeNumber, par, strokeIndex], index) => [index + 1, par, strokeIndex]));
    case "repeat9Pairs":
      return repeatNineWithPairs(config.holes9);
    case "gesAll18":
      return holesFromGes(gesRoute.holes, 0, 18);
    case "gesFront9":
      return holesFromGes(gesRoute.holes, 0, 9);
    case "gesBack9":
      return holesFromGes(gesRoute.holes, 9, 9);
    case "gesAll":
      return holesFromGes(gesRoute.holes, 0, gesRoute.holes.length);
    default:
      throw new Error(`Tipo holes non gestito per ${config.name}: ${routeConfig.holes}`);
  }
}

function buildRoute({ config, routeConfig, figCourse, holes, gesRoute = null }) {
  return {
    external_key: figCourse.source_external_id,
    name: routeConfig.name,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: routeConfig.displayOrder,
    is_active: figCourse.is_active ?? true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: config.holeSource,
      ...(routeConfig.name !== figCourse.name
        ? {
            fig_display_name: figCourse.name,
            stablr_product_name: routeConfig.name
          }
        : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: routeConfig.defaultForHoles,
        default_source: config.approved ? "fig_gesgolf_official_site" : "fig_operational_sources",
        note:
          config.physicalHoleCount === 18
            ? "Physical 18-hole club: full 18 is default; Prime Nove is default for 9-hole play and Seconde Nove is secondary."
            : "Physical 9-hole club: expose 9-hole play and the FIG-rated 18-hole repeated variant."
      },
      ...(gesRoute
        ? {
            gesgolf: {
              circolo_id: config.gesCircoloId,
              route_name: gesRoute.name,
              percorso_id: gesRoute.percorso_id
            }
          }
        : {})
    },
    holes,
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

async function buildPayload(figCatalog, config) {
  const figClub = findFigClub(figCatalog, config.name);
  const routes = [];

  for (const routeConfig of config.routes) {
    const figCourse = findFigCourse(figClub, routeConfig.figCourse);
    const gesRoute = routeConfig.holes.startsWith("ges")
      ? (await loadGesRoute(config, routeConfig)).route
      : null;
    const holes = selectHoles(config, routeConfig, gesRoute);
    assert(holes.length === Number(figCourse.holes_count), `${config.name}/${routeConfig.name}: holes count mismatch`);
    assert(
      holes.reduce((sum, hole) => sum + Number(hole.par), 0) === Number(figCourse.total_par),
      `${config.name}/${routeConfig.name}: par mismatch`
    );
    routes.push(buildRoute({ config, routeConfig, figCourse, holes, gesRoute }));
  }

  const payload = {
    schema_version: "1.0",
    source: {
      system: config.holeSource,
      scraped_at: new Date().toISOString(),
      club_external_id: figClub.source_external_id,
      notes: config.notes
    },
    club: {
      name: figClub.name,
      name_normalized: figClub.name_normalized,
      city: figClub.city || null,
      country: figClub.country || "Italia",
      data_status: config.dataStatus,
      source_type: "fig_import",
      is_complex: config.isComplex ?? false,
      playable: true,
      is_active: figClub.is_active ?? true,
      source_system: "fig",
      source_external_id: figClub.source_external_id,
      source_payload: {
        ...(figClub.source_payload || {}),
        kind: "club",
        official_catalog: "fig",
        hole_by_hole_source: config.holeSource,
        verification_status: config.dataStatus === "verified" ? "verified" : "playable_review",
        ...(config.approved ? { stablr_approved: true } : {}),
        verification_notes: config.notes,
        website_evidence_status: config.approved ? "verified" : "pending_manual_review",
        physical_hole_count: config.physicalHoleCount,
        ...(config.physicalRouteCount ? { physical_route_count: config.physicalRouteCount } : {}),
        import_profile: config.importProfile,
        official_course_links: config.officialCourseLinks,
        product_rule:
          "Lazio completion batch: expose the simplest Stablr-playable structure. Ignore temporary/provisional routes unless they represent the current stable club setup."
      }
    },
    routes: routes.sort((left, right) => (left.display_order ?? 999) - (right.display_order ?? 999)),
    route_combinations: []
  };

  validateNormalizedPayload(payload);
  return payload;
}

async function main() {
  const figCatalog = await readJson(FIG_CATALOG_PATH);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const outputs = [];
  for (const config of CLUBS) {
    const payload = await buildPayload(figCatalog, config);
    const outputPath = path.join(OUTPUT_DIR, `${slugify(config.name)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    outputs.push({
      club: config.name,
      status: config.dataStatus,
      approved: config.approved,
      routes: payload.routes.map((route) => `${route.name} (${route.holes_count}, Par ${route.total_par})`),
      output: outputPath
    });
  }

  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
