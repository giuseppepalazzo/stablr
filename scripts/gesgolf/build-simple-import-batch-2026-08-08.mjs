import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_CATALOG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

const PROTECTED_CLUB_NAMES = new Set(["mare di roma", "parco de' medici", "parco de’ medici", "parco de medici"]);

const CLUBS = [
  {
    name: "Acaya",
    gesSlug: "acaya",
    circoloId: "792",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 2009 VALIDO par-71 hole-by-hole import. Alternate par-72/legacy routes are intentionally not exposed until official Evidence confirms the current setup.",
    routes: [
      { figCourse: "18 Buche Par 71", name: "18 Buche", gesRoute: "2009 VALIDO", gesRouteId: 1673, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "2009 VALIDO", gesRouteId: 1673, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove Par 35", name: "Seconde Nove", gesRoute: "2009 VALIDO", gesRouteId: 1673, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Panorama Golf",
    gesSlug: "panorama-golf",
    circoloId: "765",
    physicalHoleCount: 9,
    notes: "FIG official catalog + GesGolf PANORAMA hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "9 Buche", name: "9 Buche", gesRoute: "PANORAMA", gesRouteId: 2211, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "PANORAMA", gesRouteId: 2211, start: 0, count: 18, defaultForHoles: 18 }
    ]
  },
  {
    name: "Piandisole 2025",
    gesSlug: "piandisole-2025",
    circoloId: "849",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 18 Buche hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "18 Buche", gesRouteId: 2927, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "18 Buche", gesRouteId: 2927, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "18 Buche", gesRouteId: 2927, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Riva Toscana",
    gesSlug: "riva-toscana",
    circoloId: "816",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 18 Riva hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "18 Riva", gesRouteId: 2603, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "18 Riva", gesRouteId: 2603, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "18 Riva", gesRouteId: 2603, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Tesino",
    gesSlug: "tesino",
    circoloId: "226",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 18 Buche hole-by-hole import. Prior third-level review found official site structure evidence but not enough route/SI confidence for Stablr certification.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "18 Buche", gesRouteId: 882, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "18 Buche", gesRouteId: 882, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "18 Buche", gesRouteId: 882, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Bellosguardo",
    gesSlug: "bellosguardo",
    circoloId: "343",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf MONNALISA 2023 hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "Monnalisa New 2023", name: "18 Buche", gesRoute: "MONNALISA 2023", gesRouteId: 2720, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Monnalisa New Prime Nove 2023", name: "Prime Nove", gesRoute: "MONNALISA 2023", gesRouteId: 2720, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Monnalisa New Seconde Nove 2023", name: "Seconde Nove", gesRoute: "MONNALISA 2023", gesRouteId: 2720, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Bologna",
    gesSlug: "bologna",
    circoloId: "8",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf Par 72 hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "Par 72", gesRouteId: 2607, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "Par 72", gesRouteId: 2607, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "Par 72", gesRouteId: 2607, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Ca' Amata",
    gesSlug: "ca-amata",
    circoloId: "144",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf 18 buche 2025 hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "18 buche 2025", gesRouteId: 2930, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "18 buche 2025", gesRouteId: 2930, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "18 buche 2025", gesRouteId: 2930, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Castello Spessa",
    gesSlug: "castello-spessa",
    circoloId: "80",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf Castello Spessa hole-by-hole import. Duplicate 2x front-nine route is intentionally not exposed in UX.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "Castello Spessa", gesRouteId: 751, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "Castello Spessa", gesRouteId: 751, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "Castello Spessa", gesRouteId: 751, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Cerreto Miglianico",
    gesSlug: "cerreto-miglianico",
    circoloId: "838",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf Pescara hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "Pescara", gesRouteId: 2832, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "Pescara", gesRouteId: 2832, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "Pescara", gesRouteId: 2832, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Courmayeur",
    gesSlug: "courmayeur",
    circoloId: "14",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf PAR 70 2026 hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "18 Buche Par 70 Standard", name: "18 Buche", gesRoute: "PAR 70 2026", gesRouteId: 3051, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove 2015", name: "Prime Nove", gesRoute: "PAR 70 2026", gesRouteId: 3051, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove 2015", name: "Seconde Nove", gesRoute: "PAR 70 2026", gesRouteId: 3051, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Croara Ssd",
    gesSlug: "croara-ssd",
    circoloId: "855",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf CROARA 1 hole-by-hole import. Provisional par-71 route is intentionally not exposed in UX.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "CROARA 1", gesRouteId: 2970, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "CROARA 1", gesRouteId: 2970, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "CROARA 1", gesRouteId: 2970, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Dolomiti",
    gesSlug: "dolomiti",
    circoloId: "140",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf DOLOMITI hole-by-hole import. 2x back-nine route is intentionally not exposed in UX.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "DOLOMITI", gesRouteId: 180, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "DOLOMITI", gesRouteId: 180, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "DOLOMITI", gesRouteId: 180, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Faenza Cicogne",
    gesSlug: "faenza-cicogne",
    circoloId: "166",
    physicalHoleCount: 9,
    notes: "FIG official catalog + GesGolf G.C.FAEN hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "9 buche", name: "9 Buche", gesRoute: "G.C.FAEN", gesRouteId: 773, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "G.C.FAEN", gesRouteId: 773, start: 0, count: 18, defaultForHoles: 18 }
    ]
  },
  {
    name: "Garlenda",
    gesSlug: "garlenda",
    circoloId: "17",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf GARLENDA hole-by-hole import. Provisional/duplicate routes are intentionally not exposed in UX.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "GARLENDA", gesRouteId: 106, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "Prime Nove", name: "Prime Nove", gesRoute: "GARLENDA", gesRouteId: 106, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "Seconde Nove", name: "Seconde Nove", gesRoute: "GARLENDA", gesRouteId: 106, start: 9, count: 9, defaultForHoles: null }
    ]
  },
  {
    name: "Grado",
    gesSlug: "grado",
    circoloId: "238",
    physicalHoleCount: 18,
    notes: "FIG official catalog + GesGolf CHAMPIONSHIP hole-by-hole import. 9-hole mixed route is intentionally not exposed until confirmed by official Evidence.",
    routes: [
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "CHAMPIONSHIP", gesRouteId: 380, start: 0, count: 18, defaultForHoles: 18 },
      { figCourse: "prime 9", name: "Prime Nove", gesRoute: "CHAMPIONSHIP", gesRouteId: 380, start: 0, count: 9, defaultForHoles: 9 }
    ]
  },
  {
    name: "Santo Stefano Golf",
    gesSlug: "santo-stefano-golf",
    circoloId: "828",
    physicalHoleCount: 9,
    notes: "FIG official catalog + GesGolf GIAL-ROS_25 hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "Nove Buche", name: "9 Buche", gesRoute: "GIAL-ROS_25", gesRouteId: 2909, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "GIAL-ROS_25", gesRouteId: 2909, start: 0, count: 18, defaultForHoles: 18 }
    ]
  },
  {
    name: "Palermo",
    gesSlug: "palermo",
    circoloId: "769",
    physicalHoleCount: 9,
    notes: "FIG official catalog + GesGolf 18 Holes hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "9 buche", name: "9 Buche", gesRoute: "18 Holes", gesRouteId: 2288, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "18 buche", name: "18 Buche", gesRoute: "18 Holes", gesRouteId: 2288, start: 0, count: 18, defaultForHoles: 18 }
    ]
  },
  {
    name: "Colombera Asd",
    gesSlug: "colombera-asd",
    circoloId: "824",
    physicalHoleCount: 9,
    notes: "FIG official catalog + GesGolf New Course 2025 hole-by-hole import. Third-level official club scorecard evidence still pending.",
    routes: [
      { figCourse: "Rosa 2025", name: "9 Buche", gesRoute: "New Course 2025", gesRouteId: 2888, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "New Course 2025", name: "18 Buche", gesRoute: "New Course 2025", gesRouteId: 2888, start: 0, count: 18, defaultForHoles: 18 }
    ]
  },
  {
    name: "Bormio Ssd",
    gesSlug: "bormio-ssd",
    circoloId: "825",
    physicalHoleCount: 9,
    notes: "FIG official catalog + GesGolf BORMIO hole-by-hole import. Par-62 provisional route is intentionally not exposed in UX.",
    routes: [
      { figCourse: "9 Buche", name: "9 Buche", gesRoute: "BORMIO", gesRouteId: 2664, start: 0, count: 9, defaultForHoles: 9 },
      { figCourse: "18 Buche", name: "18 Buche", gesRoute: "BORMIO", gesRouteId: 2664, start: 0, count: 18, defaultForHoles: 18 }
    ]
  }
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNotProtected(name) {
  assert(!PROTECTED_CLUB_NAMES.has(String(name).trim().toLowerCase()), `Club protetto nel batch automatico: ${name}`);
}

function routeHolesFromGesHoles(gesHoles, startIndex, count) {
  return gesHoles.slice(startIndex, startIndex + count).map((hole, index) => ({
    physical_hole_number: index + 1,
    par: hole.par,
    stroke_index: hole.hcp,
    display_label: String(index + 1)
  }));
}

function teePayload(figCourse) {
  return (figCourse.tees || []).map((tee) => ({
    tee_name: tee.tee_name,
    tee_color: tee.tee_color || null,
    gender: tee.gender || null,
    course_rating: tee.course_rating ?? null,
    slope_rating: tee.slope_rating ?? null,
    par_total: tee.par_total ?? figCourse.total_par ?? null,
    is_active: tee.is_active ?? true,
    source_system: "fig",
    source_external_id: tee.source_external_id,
    source_payload: { ...(tee.source_payload || {}), official_catalog: "fig" }
  }));
}

function findFigCourse(figClub, name) {
  const course = (figClub.playable_courses || []).find((candidate) => candidate.name === name);
  assert(course, `Percorso FIG non trovato per ${figClub.name}: ${name}`);
  return course;
}

function findGesRoute(gesNormalized, routeSpec, clubName) {
  const route = (gesNormalized.playable_courses || []).find(
    (candidate) =>
      candidate.name === routeSpec.gesRoute &&
      Number(candidate.percorso_id) === Number(routeSpec.gesRouteId)
  );
  assert(route, `Route GesGolf non trovata: ${clubName} / ${routeSpec.gesRoute}#${routeSpec.gesRouteId}`);
  assert(route.status === "safe", `Route GesGolf non safe: ${clubName} / ${route.name} / ${route.status}`);
  assert(Array.isArray(route.holes), `Route GesGolf senza buche: ${clubName} / ${route.name}`);
  assert(route.holes.length >= routeSpec.start + routeSpec.count, `${clubName}: route GesGolf troppo corta per ${routeSpec.gesRoute}`);
  return route;
}

function buildRoute({ figCourse, gesRoute, gesSource, routeSpec, physicalHoleCount }) {
  const productProfile =
    physicalHoleCount === 9 ? "physical_9_with_official_18_variants" : "physical_18_simple";

  return {
    external_key: figCourse.source_external_id,
    name: routeSpec.name,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order:
      physicalHoleCount === 9
        ? routeSpec.defaultForHoles === 9
          ? 1
          : routeSpec.defaultForHoles === 18
            ? 2
            : 3
        : routeSpec.defaultForHoles === 18
          ? 1
          : routeSpec.defaultForHoles === 9
            ? 2
            : 3,
    is_active: figCourse.is_active ?? true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: "gesgolf",
      ...(routeSpec.name !== figCourse.name
        ? {
            fig_display_name: figCourse.name,
            stablr_product_name: routeSpec.name,
            product_simplification: productProfile
          }
        : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: routeSpec.defaultForHoles,
        default_source: "fig_gesgolf_manual_batch",
        note:
          physicalHoleCount === 9
            ? "Simple physical 9-hole club: expose only 9 Buche and 18 Buche, preserving official 18-hole SI when available."
            : "Simple/semi-simple physical 18-hole club: expose only Stablr-playable 18 Buche, Prime Nove and Seconde Nove routes."
      },
      gesgolf: {
        circolo_id: gesSource.circoloId,
        gesgolf_club: gesSource.gesClub,
        route_name: gesRoute.name,
        playable_kind: gesRoute.playable_kind,
        percorso_id: gesRoute.percorso_id,
        ...(routeSpec.start || routeSpec.count !== gesRoute.holes.length
          ? { derived_segment: [routeSpec.start, routeSpec.start + routeSpec.count] }
          : {})
      }
    },
    holes: routeHolesFromGesHoles(gesRoute.holes, routeSpec.start, routeSpec.count),
    tees: teePayload(figCourse)
  };
}

async function main() {
  const figCatalog = await readJson(FIG_CATALOG_PATH);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputs = [];

  for (const config of CLUBS) {
    assertNotProtected(config.name);
    const figClub = (figCatalog.clubs || []).find((club) => club.name === config.name);
    assert(figClub, `Club FIG non trovato: ${config.name}`);
    assertNotProtected(figClub.name);

    const gesPath = path.join(GESGOLF_NORMALIZED_DIR, config.gesSlug, `circolo-${config.circoloId}.json`);
    const gesNormalized = await readJson(gesPath);
    const gesSource = {
      circoloId: config.circoloId,
      gesClub: gesNormalized.club?.name || gesNormalized.club_name || config.name
    };

    const routes = config.routes.map((routeSpec) => {
      const figCourse = findFigCourse(figClub, routeSpec.figCourse);
      const gesRoute = findGesRoute(gesNormalized, routeSpec, config.name);
      return buildRoute({ figCourse, gesRoute, gesSource, routeSpec, physicalHoleCount: config.physicalHoleCount });
    });

    const payload = {
      schema_version: "1.0",
      source: {
        system: "gesgolf",
        scraped_at: gesNormalized.source?.scraped_at || new Date().toISOString(),
        club_external_id: figClub.source_external_id,
        notes: `Official FIG catalog + GesGolf controlled batch import for ${config.name}`
      },
      club: {
        name: figClub.name,
        name_normalized: figClub.name_normalized,
        city: figClub.city || null,
        country: figClub.country || "Italia",
        data_status: "needs_review",
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
          verification_status: "playable_review",
          verification_notes: config.notes,
          physical_hole_count: config.physicalHoleCount,
          import_profile:
            config.physicalHoleCount === 9
              ? "physical_9_with_official_18_variants"
              : "physical_18_simple_or_trimmed",
          product_rule:
            "Expose only Stablr-playable routes for this controlled batch; noisy, duplicate, provisional or unconfirmed GesGolf/FIG variants stay out of UX.",
          gesgolf: gesSource
        }
      },
      routes,
      route_combinations: []
    };

    validateNormalizedPayload(payload);
    const outputPath = path.join(OUTPUT_DIR, `${slugify(config.name)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    outputs.push({ club: config.name, routes: routes.map((route) => route.name), output: outputPath });
  }

  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
