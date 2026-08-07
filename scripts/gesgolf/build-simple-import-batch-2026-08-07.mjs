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

const PROTECTED_CLUB_NAMES = new Set([
  "mare di roma",
  "parco de' medici",
  "parco de’ medici",
  "parco de medici"
]);

const CLUBS = [
  {
    name: "Argentario",
    gesSlug: "argentario",
    circoloId: "365",
    gesRouteName: "AGC_new_rating",
    gesRouteId: 960,
    physicalHoleCount: 18,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG official catalog + GesGolf AGC_new_rating hole-by-hole import. Official Argentario page confirms the 18-hole par-71 course, but no official hole-by-hole PAR/HCP scorecard was found during the third-level audit.",
    officialLinks: ["https://www.argentarioresort.it/argentario-golf-club/"]
  },
  {
    name: "Castellaro",
    gesSlug: "castellaro",
    circoloId: "634",
    gesRouteName: "DEFINITIVO",
    gesRouteId: 1768,
    physicalHoleCount: 9,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG official catalog + GesGolf hole-by-hole import. Official Castellaro course page exposes the 9-hole scorecard with PAR and HCP pairs matching the selected GesGolf 18-hole route.",
    officialLinks: ["https://www.castellarogolf.it/golf-resort-riviera-dei-fiori"]
  },
  {
    name: "Claviere",
    gesSlug: "claviere",
    circoloId: "13",
    gesRouteName: "CLAVIERE",
    gesRouteId: 573,
    physicalHoleCount: 9,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG official catalog + GesGolf CLAVIERE hole-by-hole import. Official Golf Club Claviere hole images expose PAR and HCP pairs for holes 1/10 through 9/18 and match the selected GesGolf route.",
    officialLinks: ["https://golfclubclaviere.it/campo/#buca-1-10"]
  },
  {
    name: "San Domenico - Egnazia",
    gesSlug: "san-domenico-egnazia",
    circoloId: "785",
    gesRouteName: "NORMALE",
    gesRouteId: 2627,
    physicalHoleCount: 18,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG official catalog + GesGolf NORMALE hole-by-hole import. Official San Domenico page confirms the 18-hole par-72 course, but no official hole-by-hole PAR/HCP scorecard was found during the third-level audit.",
    officialLinks: ["https://www.sandomenicogolf.com/en/golf-course/"]
  },
  {
    name: "Torrenova Ssd",
    gesSlug: "torrenova-ssd",
    circoloId: "842",
    gesRouteName: "Torrenova 18",
    gesRouteId: 2877,
    gesNineRouteName: "Torrenova 9",
    gesNineRouteId: 2878,
    physicalHoleCount: 9,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG official catalog + GesGolf Torrenova 18 and Torrenova 9 hole-by-hole import. User-provided scorecard screenshot confirms the official 9-hole PAR/HCP sequence, so the 9-hole route uses the GesGolf Torrenova 9 source; the 18-hole route remains playable from GesGolf but still needs an official URL or full scorecard evidence before Stablr certification.",
    officialLinks: ["https://www.gesgolf.it/golfonline/clubs/Default.aspx?circolo_id=842"]
  },
  {
    name: "Toscana",
    gesSlug: "toscana",
    circoloId: "291",
    gesRouteName: "AZZURRE",
    gesRouteId: 865,
    physicalHoleCount: 18,
    dataStatus: "needs_review",
    approved: false,
    notes:
      "FIG official catalog + GesGolf AZZURRE hole-by-hole import. Official Golf Club Toscana brochure exposes PAR/HCP visually, but it does not certify the selected AZZURRE route: the front nine matches a different GesGolf segment, hole 13 does not expose a readable PAR/HCP box, and the back-nine HCP values are not a clean SI 1-18 sequence. Keep playable review until the club scorecard/current official SI is confirmed.",
    officialLinks: [
      "https://www.ilpelagone.com/it/campo-da-golf-pelagone/golf-club/",
      "local:/Users/giuseppepalazzo/Downloads/descrizione-buche-ita.pdf"
    ]
  },
  {
    name: "Venezia",
    gesSlug: "venezia",
    circoloId: "46",
    gesRouteName: "NORMALE",
    gesRouteId: 127,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG official catalog + GesGolf NORMALE hole-by-hole import. Official Venezia hole-by-hole pages expose PAR and HCP for all 18 holes and match the selected GesGolf route.",
    officialLinks: ["https://www.circologolfvenezia.it/giocare/percorso/buca-01/"]
  },
  {
    name: "Passiria Merano",
    gesSlug: "passiria-merano",
    circoloId: "689",
    gesRouteName: "18 buche",
    gesRouteId: 1804,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG official catalog + GesGolf hole-by-hole import. Official Golf Club Passeier scorecard PDF exposes PAR and HCP for all 18 holes and matches the selected GesGolf route.",
    officialLinks: [
      "https://www.golfclubpasseier.com/it/campo-da-golf/",
      "https://www.golfclubpasseier.com/wp-content/uploads/2024/06/SCORECARD.pdf"
    ]
  },
  {
    name: "Pevero",
    gesSlug: "pevero",
    circoloId: "31",
    gesRouteName: "18 buche",
    gesRouteId: 651,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG official catalog + GesGolf 18 buche hole-by-hole import. Official Pevero Birdie Book exposes PAR and HCP for all 18 holes and matches the selected GesGolf route.",
    officialLinks: [
      "https://www.peverogolfclub.com/en/play/course/",
      "https://www.peverogolfclub.com/documents/192/pevero-golf-club-birdie-book.pdf"
    ]
  },
  {
    name: "Petersberg",
    gesSlug: "petersberg",
    circoloId: "97",
    gesRouteName: "1",
    gesRouteId: 1033,
    physicalHoleCount: 18,
    dataStatus: "verified",
    approved: true,
    notes:
      "FIG official catalog + GesGolf 18-hole route import. Official Petersberg clickable hole images expose PAR and HCP for all 18 holes and match the selected GesGolf route.",
    officialLinks: ["https://golfclubpetersberg.it/it/18-buche/"]
  }
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNotProtected(name) {
  assert(
    !PROTECTED_CLUB_NAMES.has(String(name).trim().toLowerCase()),
    `Club protetto nel batch automatico: ${name}`
  );
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
    source_payload: {
      ...(tee.source_payload || {}),
      official_catalog: "fig"
    }
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
  defaultForHoles,
  profile,
  productNote
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
            stablr_product_name: name,
            product_simplification: profile
          }
        : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: defaultForHoles,
        default_source: "fig_gesgolf_official_site",
        note: productNote
      },
      gesgolf: {
        circolo_id: gesSource.circoloId,
        gesgolf_club: gesSource.gesClub,
        route_name: gesRoute.name,
        playable_kind: gesRoute.playable_kind,
        percorso_id: gesRoute.percorso_id,
        ...(holesStart || holesCount !== gesRoute.holes.length
          ? {
              derived_segment: [holesStart, holesStart + holesCount]
            }
          : {})
      }
    },
    holes: routeHolesFromGesHoles(gesRoute.holes, holesStart, holesCount),
    tees: teePayload(figCourse)
  };
}

function findFigCourse(figClub, name) {
  const course = (figClub.playable_courses || []).find((candidate) => candidate.name === name);
  assert(course, `Percorso FIG non trovato per ${figClub.name}: ${name}`);
  return course;
}

function buildPhysical18Routes(figClub, gesRoute, gesSource) {
  const note =
    "Simple physical 18-hole club: full 18 is default; Prime Nove is default for 9-hole play and Seconde Nove is secondary.";
  return [
    buildRoute({
      figCourse: findFigCourse(figClub, "18 Buche"),
      gesRoute,
      gesSource,
      name: "18 Buche",
      displayOrder: 1,
      holesStart: 0,
      holesCount: 18,
      defaultForHoles: 18,
      profile: "physical_18_simple",
      productNote: note
    }),
    buildRoute({
      figCourse: findFigCourse(figClub, "Prime Nove"),
      gesRoute,
      gesSource,
      name: "Prime Nove",
      displayOrder: 2,
      holesStart: 0,
      holesCount: 9,
      defaultForHoles: 9,
      profile: "physical_18_simple",
      productNote: note
    }),
    buildRoute({
      figCourse: findFigCourse(figClub, "Seconde Nove"),
      gesRoute,
      gesSource,
      name: "Seconde Nove",
      displayOrder: 3,
      holesStart: 9,
      holesCount: 9,
      defaultForHoles: null,
      profile: "physical_18_simple",
      productNote: note
    })
  ];
}

function buildPhysical9Routes(figClub, gesRoute, gesSource, gesNineRoute = gesRoute) {
  const note =
    "Simple physical 9-hole club: 9 holes are default; the official 18-hole route preserves the 1-18 Stroke Index sequence instead of compressing SI to 1-9.";
  return [
    buildRoute({
      figCourse: findFigCourse(figClub, "9 Buche"),
      gesRoute: gesNineRoute,
      gesSource,
      name: "9 Buche",
      displayOrder: 1,
      holesStart: 0,
      holesCount: 9,
      defaultForHoles: 9,
      profile: "physical_9_with_official_18_variants",
      productNote: note
    }),
    buildRoute({
      figCourse: findFigCourse(figClub, "18 Buche"),
      gesRoute,
      gesSource,
      name: "18 Buche",
      displayOrder: 2,
      holesStart: 0,
      holesCount: 18,
      defaultForHoles: 18,
      profile: "physical_9_with_official_18_variants",
      productNote: note
    })
  ];
}

async function main() {
  const figCatalog = await readJson(FIG_CATALOG_PATH);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const outputs = [];

  for (const config of CLUBS) {
    assertNotProtected(config.name);
    assert(config.physicalHoleCount === 9 || config.physicalHoleCount === 18, `${config.name}: physicalHoleCount non valido.`);

    const figClub = (figCatalog.clubs || []).find((club) => club.name === config.name);
    assert(figClub, `Club FIG non trovato: ${config.name}`);
    assertNotProtected(figClub.name);

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
    const gesNineRoute = config.gesNineRouteName
      ? (gesNormalized.playable_courses || []).find(
          (route) =>
            route.name === config.gesNineRouteName &&
            Number(route.percorso_id) === Number(config.gesNineRouteId) &&
            Number(route.holes_count) === 9
        )
      : null;

    assert(gesRoute, `Route GesGolf non trovata: ${config.name} / ${config.gesRouteName}`);
    assert(gesRoute.status === "safe", `Route GesGolf non safe: ${config.name} / ${gesRoute.status}`);
    assert(Array.isArray(gesRoute.holes) && gesRoute.holes.length === 18, `${config.name}: route non 18 buche.`);
    if (config.gesNineRouteName) {
      assert(gesNineRoute, `Route GesGolf 9 non trovata: ${config.name} / ${config.gesNineRouteName}`);
      assert(gesNineRoute.status === "safe", `Route GesGolf 9 non safe: ${config.name} / ${gesNineRoute.status}`);
      assert(Array.isArray(gesNineRoute.holes) && gesNineRoute.holes.length === 9, `${config.name}: route 9 non 9 buche.`);
    }

    const gesSource = {
      circoloId: config.circoloId,
      gesClub: gesNormalized.club?.name || gesNormalized.club_name || config.name
    };

    const routes =
      config.physicalHoleCount === 9
        ? buildPhysical9Routes(figClub, gesRoute, gesSource, gesNineRoute || gesRoute)
        : buildPhysical18Routes(figClub, gesRoute, gesSource);

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
          official_course_links: config.officialLinks,
          physical_hole_count: config.physicalHoleCount,
          import_profile:
            config.physicalHoleCount === 9
              ? "physical_9_with_official_18_variants"
              : "physical_18_simple",
          product_rule:
            config.physicalHoleCount === 9
              ? "Keep only Stablr-playable 9 Buche and 18 Buche routes for simple physical 9-hole clubs."
              : "Keep only Stablr-playable 18 Buche, Prime Nove and Seconde Nove routes for simple physical 18-hole clubs.",
          gesgolf: gesSource
        }
      },
      routes,
      route_combinations: []
    };

    validateNormalizedPayload(payload);

    const outputPath = path.join(OUTPUT_DIR, `${slugify(config.name)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    outputs.push({
      club: config.name,
      status: config.dataStatus,
      approved: config.approved,
      physicalHoleCount: config.physicalHoleCount,
      routes: routes.map((route) => route.name),
      output: outputPath
    });
  }

  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
