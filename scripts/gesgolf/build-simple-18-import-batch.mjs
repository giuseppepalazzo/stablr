import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_CATALOG_PATH = path.join(
  repoRoot,
  "data",
  "fig",
  "normalized",
  "fig-catalog-normalized.json"
);
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

const CLUBS = [
  {
    name: "Argenta",
    gesSlug: "argenta",
    circoloId: "135",
    gesRouteName: "Arg-EGA",
    gesRouteId: 194,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole cross-check; official club scorecard image confirms PAR/HCP."
  },
  {
    name: "Brianza",
    gesSlug: "brianza",
    circoloId: "117",
    gesRouteName: "Gare",
    gesRouteId: 75,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole cross-check; official club hole pages confirm PAR/HCP."
  },
  {
    name: "Ca' Nave Ssd",
    gesSlug: "ca-nave-ssd",
    circoloId: "852",
    gesRouteName: "CAMPIONATO",
    gesRouteId: 2955,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole cross-check; official club hole images confirm PAR/HCP."
  },
  {
    name: "Frassanelle",
    gesSlug: "frassanelle",
    circoloId: "88",
    gesRouteName: "CHAMP.",
    gesRouteId: 161,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import; official site not yet found with complete PAR/HCP scorecard."
  },
  {
    name: "Fronde",
    gesSlug: "fronde",
    circoloId: "23",
    gesRouteName: "Ega",
    gesRouteId: 934,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole cross-check; official club hole pages confirm PAR/HCP for all 18 holes."
  },
  {
    name: "Roma Acquasanta",
    gesSlug: "roma-acquasanta",
    circoloId: "36",
    gesRouteName: "NORMALE",
    gesRouteId: 182,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import; official site not yet found with complete PAR/HCP scorecard."
  },
  {
    name: "Saturnia",
    gesSlug: "saturnia",
    circoloId: "412",
    gesRouteName: "Saturnia 1-18",
    gesRouteId: 2589,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole cross-check; official Terme di Saturnia technical page confirms PAR/HCP. Duplicate GesGolf route with same name but different data was ignored."
  },
  {
    name: "Serra",
    gesSlug: "serra",
    circoloId: "22",
    gesRouteName: "Normale",
    gesRouteId: 125,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import; official site not yet found with complete PAR/HCP scorecard."
  },
  {
    name: "Trieste",
    gesSlug: "trieste",
    circoloId: "43",
    gesRouteName: "18 BUCHE",
    gesRouteId: 466,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import; official site confirms course page but not complete PAR/HCP scorecard."
  },
  {
    name: "Verona",
    gesSlug: "verona",
    circoloId: "47",
    gesRouteName: "VERONA",
    gesRouteId: 1001,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import; official course page did not provide complete PAR/HCP confirmation."
  },
  {
    name: "Salsomaggiore Terme",
    gesSlug: "salsomaggiore-terme",
    circoloId: "762",
    gesRouteName: "I COLLI",
    gesRouteId: 2219,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG CR/Slope + GesGolf hole-by-hole import; official Parma Golf page confirms 18-hole course but not complete PAR/HCP scorecard."
  }
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function routeHolesFromGesHoles(gesHoles, startIndex = 0, count = gesHoles.length) {
  return gesHoles.slice(startIndex, startIndex + count).map((hole, index) => ({
    physical_hole_number: index + 1,
    par: hole.par,
    stroke_index: hole.hcp,
    display_label: String(index + 1)
  }));
}

function buildRoute({
  figCourse,
  gesRoute,
  gesSource,
  name,
  displayOrder,
  holesStart,
  holesCount,
  defaultForHoles
}) {
  return {
    external_key: figCourse.source_external_id,
    name,
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
      ...(name !== figCourse.name
        ? {
            fig_display_name: figCourse.name,
            stablr_product_name: name
          }
        : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: defaultForHoles,
        default_source: "fig_gesgolf_official_site",
        note:
          "Simple physical 18-hole club: full 18 is default; Prime Nove is default for 9-hole play and Seconde Nove is secondary."
      },
      gesgolf: {
        circolo_id: gesSource.circoloId,
        gesgolf_club: gesSource.gesClub,
        route_name: gesRoute.name,
        playable_kind: gesRoute.playable_kind,
        percorso_id: gesRoute.percorso_id
      }
    },
    holes: routeHolesFromGesHoles(gesRoute.holes, holesStart, holesCount),
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

function findFigCourse(figClub, name) {
  const course = (figClub.playable_courses || []).find((candidate) => candidate.name === name);
  assert(course, `Percorso FIG non trovato per ${figClub.name}: ${name}`);
  return course;
}

async function main() {
  const figCatalog = await readJson(FIG_CATALOG_PATH);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const outputs = [];

  for (const config of CLUBS) {
    const figClub = (figCatalog.clubs || []).find((club) => club.name === config.name);
    assert(figClub, `Club FIG non trovato: ${config.name}`);

    const gesPath = path.join(
      GESGOLF_NORMALIZED_DIR,
      config.gesSlug,
      `circolo-${config.circoloId}.json`
    );
    const gesNormalized = await readJson(gesPath);
    const gesRoute = (gesNormalized.playable_courses || []).find(
      (route) =>
        route.name === config.gesRouteName &&
        Number(route.percorso_id) === Number(config.gesRouteId) &&
        Number(route.holes_count) === 18
    );
    assert(gesRoute, `Route GesGolf non trovata: ${config.name} / ${config.gesRouteName}`);
    assert(gesRoute.status === "safe", `Route GesGolf non safe: ${config.name} / ${gesRoute.status}`);
    assert(Array.isArray(gesRoute.holes) && gesRoute.holes.length === 18, `${config.name}: route non 18 buche.`);

    const fig18 = findFigCourse(figClub, "18 Buche");
    const figPrime = findFigCourse(figClub, "Prime Nove");
    const figSeconde = findFigCourse(figClub, "Seconde Nove");

    const routes = [
      buildRoute({
        figCourse: fig18,
        gesRoute,
        gesSource: {
          circoloId: config.circoloId,
          gesClub: gesNormalized.club?.name || gesNormalized.club_name || config.name
        },
        name: "18 Buche",
        displayOrder: 1,
        holesStart: 0,
        holesCount: 18,
        defaultForHoles: 18
      }),
      buildRoute({
        figCourse: figPrime,
        gesRoute,
        gesSource: {
          circoloId: config.circoloId,
          gesClub: gesNormalized.club?.name || gesNormalized.club_name || config.name
        },
        name: "Prime Nove",
        displayOrder: 2,
        holesStart: 0,
        holesCount: 9,
        defaultForHoles: 9
      }),
      buildRoute({
        figCourse: figSeconde,
        gesRoute,
        gesSource: {
          circoloId: config.circoloId,
          gesClub: gesNormalized.club?.name || gesNormalized.club_name || config.name
        },
        name: "Seconde Nove",
        displayOrder: 3,
        holesStart: 9,
        holesCount: 9,
        defaultForHoles: null
      })
    ];

    const payload = {
      schema_version: "1.0",
      source: {
        system: "gesgolf",
        scraped_at: gesNormalized.source?.scraped_at || new Date().toISOString(),
        club_external_id: figClub.source_external_id,
        notes: `Official FIG catalog + GesGolf hole-by-hole simple import for ${config.name}`
      },
      club: {
        name: figClub.name,
        name_normalized: figClub.name_normalized,
        city: figClub.city || null,
        country: figClub.country || "Italia",
        data_status: config.dataStatus,
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
          verification_status: config.dataStatus === "verified" ? "verified" : "playable_review",
          ...(config.approved ? { stablr_approved: true } : {}),
          verification_notes: config.notes,
          physical_hole_count: 18,
          import_profile: "physical_18_simple",
          gesgolf: {
            circolo_id: config.circoloId,
            gesgolf_club: gesNormalized.club?.name || gesNormalized.club_name || config.name
          }
        }
      },
      routes,
      route_combinations: []
    };

    validateNormalizedPayload(payload);

    const outputPath = path.join(OUTPUT_DIR, `${slugify(config.name)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    outputs.push({ club: config.name, status: config.dataStatus, approved: config.approved, output: outputPath });
  }

  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
