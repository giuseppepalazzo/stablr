import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");
const AUDIT_DATE = "2026-09-22";

const SAN_DONATO_18_2015 = [
  [4, 1], [4, 9], [4, 7], [4, 5], [4, 13], [3, 3], [4, 15], [4, 11], [4, 17],
  [4, 4], [3, 18], [3, 10], [4, 8], [5, 6], [3, 16], [4, 12], [3, 14], [4, 2]
];

const SAN_MICHELE_9 = [
  [4, 4], [3, 17], [5, 1], [4, 9], [3, 15], [4, 13], [4, 7], [4, 11], [4, 3]
];

const SAPPADA_9 = [
  [3, 9], [4, 3], [3, 8], [3, 2], [4, 5], [4, 6], [3, 1], [4, 4], [3, 7]
];

const PICCIOLO_18 = [
  [4, 8], [3, 18], [4, 12], [4, 6], [3, 14], [5, 4], [5, 2], [3, 16], [5, 10],
  [3, 15], [4, 1], [5, 9], [4, 13], [4, 3], [3, 17], [4, 5], [4, 11], [5, 7]
];

const STUPINIGI_9_PAR_31 = [
  [4, 1], [3, 5], [3, 9], [4, 3], [4, 15], [3, 17], [3, 7], [3, 13], [4, 11]
];

function repeated18(rows) {
  return [
    ...rows.map(([par, strokeIndex]) => [par, strokeIndex * 2 - 1]),
    ...rows.map(([par, strokeIndex]) => [par, strokeIndex * 2])
  ];
}

function paired18FromOdd(rows) {
  return [
    ...rows,
    ...rows.map(([par, strokeIndex]) => [par, strokeIndex + 1])
  ];
}

const configs = [
  {
    figName: "San Donato",
    verified: false,
    physicalHoleCount: 18,
    links: [
      "https://www.sandonatogolf.it/",
      "https://www.hole19golf.com/courses/san-donato-golf-resort-spa",
      "https://www.allsquaregolf.com/golf-courses/italy/golf-club-san-donato",
      "https://www.golfhandicapp.com/courses/san-donato"
    ],
    note: "FIG conserva piu' versioni. La famiglia 2015 18/68 e' pubblicata arancione: Hole19 espone PAR 35+33 e SI 1-18 completi; All Square corrobora integralmente gli SI ma contiene una matrice PAR diversa (69), mentre GolfHandicapp collega esplicitamente il rating FIG 2015 al Par 68 senza SI utilizzabili. Il sito ufficiale conferma l'attivita' corrente ma non pubblica una scorecard. Le route 2024 e la route normalizzata prime 9 due volte restano non pubblicate per evitare di fondere versioni diverse.",
    unpublishedFigRoutes: ["18 Buche 2024", "9 Buche 2024", "prime 9 due volte"],
    routes: [
      { figName: "18 buche 2015", displayName: "18 Buche", matrix: SAN_DONATO_18_2015, defaultForHoles: 18, source: "hole19_matrix_plus_allsquare_si_crosscheck" },
      { figName: "Prime Nove", displayName: "Prime Nove", matrix: SAN_DONATO_18_2015.slice(0, 9), defaultForHoles: 9, source: "segment_of_supported_18", derived: true },
      { figName: "Seconde Nove", displayName: "Seconde Nove", matrix: SAN_DONATO_18_2015.slice(9), source: "segment_of_supported_18", derived: true }
    ]
  },
  {
    figName: "San Michele",
    verified: false,
    physicalHoleCount: 9,
    links: [
      "https://www.sanmichele.golf/",
      "https://www.allsquaregolf.com/golf-courses/italy/golf-club-san-michele",
      "https://flyawaygolf.com/golfs/golf-club-san-michele"
    ],
    note: "Le nove grafiche ufficiali confermano PAR 35 e gli HCP del primo giro: 4,17,1,9,15,13,7,11,3. Il sito conferma nove buche fisiche, doppie partenze e 18/70; FIG conferma 9/35 e 18/70. La route 9 e' completa e giocabile arancione. La route 18 resta non pubblicata: le grafiche delle buche fisiche 3 e 9 non espongono il secondo HCP e i valori mancanti 2 e 5 non vengono dedotti per esclusione; il materiale storico del resort presenta inoltre una diversa allocazione HCP.",
    unpublishedFigRoutes: ["18 Buche"],
    routes: [
      { figName: "Nove Buche", displayName: "9 Buche", matrix: SAN_MICHELE_9, defaultForHoles: 9, source: "official_hole_graphics_first_lap" }
    ]
  },
  {
    figName: "Sappada",
    verified: false,
    physicalHoleCount: 9,
    links: [
      "https://www.golfclubsappada.com/percorso/",
      "https://www.hole19golf.com/courses/golf-club-sappada"
    ],
    note: "Il sito ufficiale descrive le nove buche e conferma tutti i PAR, per un totale di 31. Hole19 pubblica la stessa matrice PAR e gli SI 1-9 completi. FIG conferma 9/31 e 18/62. La route 18 usa la trasformazione Stablr standard gia' validata: primo giro SI dispari, secondo giro SI pari. Il club resta arancione perche' gli SI dipendono da una fonte secondaria.",
    routes: [
      { figName: "9 Buche", displayName: "9 Buche", matrix: SAPPADA_9, defaultForHoles: 9, source: "official_par_plus_hole19_si" },
      { figName: "18 Buche", displayName: "18 Buche", matrix: repeated18(SAPPADA_9), defaultForHoles: 18, source: "stablr_standard_repeated_9", derived: true }
    ]
  },
  {
    figName: "Sicilia'S Picciolo",
    verified: true,
    physicalHoleCount: 18,
    links: [
      "https://www.ilpiccioloetnagolfresort.com/it-IT/golf",
      "https://flyawaygolf.com/golfs/il-picciolo-etna-golf-resort",
      "https://18birdies.com/golf-courses/club/7c7f6c60-86ac-11e4-8c28-020000005b00/il-picciolo-golf-club"
    ],
    note: "Il sito ufficiale corrente pubblica PAR/HCP per tutte le 18 buche e coincide con la matrice usata in 17 buche. Alla buca 2 ripete chiaramente i valori della buca 1 (PAR 4/HCP 8): il refuso isolato e' risolto da FIG, che richiede Prime Nove Par 36 e 18 Par 72, e da FlyAway e 18Birdies, entrambe concordanti su buca 2 PAR 3/HCP 18 e sull'intera matrice. Le tre route FIG risultano integralmente ricostruibili e certificate.",
    routes: [
      { figName: "18 Buche", displayName: "18 Buche", matrix: PICCIOLO_18, defaultForHoles: 18, source: "official_17_of_18_plus_two_concordant_scorecards" },
      { figName: "Prime Nove", displayName: "Prime Nove", matrix: PICCIOLO_18.slice(0, 9), defaultForHoles: 9, source: "segment_of_certified_18", derived: true },
      { figName: "Seconde Nove", displayName: "Seconde Nove", matrix: PICCIOLO_18.slice(9), source: "segment_of_certified_18", derived: true }
    ]
  },
  {
    figName: "Stupinigi",
    verified: false,
    physicalHoleCount: 9,
    links: [
      "https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=40",
      "https://www.golfclubstupinigi.com/percorso-golf-club-stupinigi/"
    ],
    note: "GesGolf corrente pubblica la famiglia completa 9/31 e 18/62 con PAR e HCP; FIG contiene la stessa famiglia e rating coerenti. La route 18 usa la trasformazione standard SI dispari/pari e coincide con GesGolf. Il sito ufficiale dichiara il giro Par 62 ma il dettaglio assegna ancora Par 5 alla buca 5, producendo Par 32 e richiamando la distinta famiglia FIG 32/64: per questo la famiglia 31/62 e' giocabile ma resta arancione. Le famiglie 30/60 e 32/64 restano catalogate e non pubblicate.",
    unpublishedFigRoutes: ["PAR 30", "PAR 32", "PAR 60", "PAR 64"],
    routes: [
      { figName: "PAR 31", displayName: "9 Buche · Par 31", matrix: STUPINIGI_9_PAR_31, defaultForHoles: 9, source: "gesgolf_current_family_31_62" },
      { figName: "PAR 62", displayName: "18 Buche · Par 62", matrix: paired18FromOdd(STUPINIGI_9_PAR_31), defaultForHoles: 18, source: "gesgolf_current_plus_stablr_standard_repeated_9", derived: true }
    ]
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFigClub(catalog, name) {
  const club = catalog.clubs.find((item) => item.name === name && item.is_active !== false);
  assert(club, `Club FIG non trovato o inattivo: ${name}`);
  return club;
}

function findFigCourse(figClub, name) {
  const course = figClub.playable_courses.find((item) => item.name === name && item.is_active !== false);
  assert(course, `${figClub.name}: playable course FIG non trovato o inattivo: ${name}`);
  return course;
}

function teePayload(figCourse) {
  return figCourse.tees.map((tee) => ({
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

function buildRoute(config, figClub, routeSpec, displayOrder) {
  const figCourse = findFigCourse(figClub, routeSpec.figName);
  const matrix = routeSpec.matrix;
  assert(matrix.length === figCourse.holes_count, `${config.figName}/${routeSpec.figName}: matrice incompleta`);
  assert(matrix.reduce((sum, [par]) => sum + par, 0) === figCourse.total_par, `${config.figName}/${routeSpec.figName}: par matrice/FIG discordante`);
  const indexes = matrix.map(([, strokeIndex]) => strokeIndex);
  assert(indexes.every((value) => Number.isInteger(value) && value >= 1 && value <= 18), `${config.figName}/${routeSpec.figName}: SI fuori range`);
  assert(new Set(indexes).size === indexes.length, `${config.figName}/${routeSpec.figName}: SI duplicati`);
  if (figCourse.holes_count === 18) {
    assert(Math.min(...indexes) === 1 && Math.max(...indexes) === 18, `${config.figName}/${routeSpec.figName}: SI 1-18 incompleti`);
  }

  return {
    external_key: figCourse.source_external_id,
    name: routeSpec.displayName,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: displayOrder,
    is_active: true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: routeSpec.source,
      fig_display_name: figCourse.name,
      governance_state: config.verified ? "certified" : "playable_unverified",
      ...(routeSpec.derived
        ? {
            derived_route: true,
            derivation_rule: figCourse.holes_count === 18
              ? "standard_repeated_9_first_pass_odd_second_pass_even"
              : "segment_of_supported_18"
          }
        : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: routeSpec.defaultForHoles ?? null,
        default_source: `fig_recovery_batch_group_2_${AUDIT_DATE}`
      },
      evidence_links: config.links,
      evidence_note: config.note
    },
    holes: matrix.map(([par, strokeIndex], index) => ({
      physical_hole_number: index + 1,
      par,
      stroke_index: strokeIndex,
      display_label: String(index + 1)
    })),
    tees: teePayload(figCourse)
  };
}

async function buildPayload(catalog, config) {
  const figClub = findFigClub(catalog, config.figName);
  const routes = config.routes.map((route, index) => buildRoute(config, figClub, route, index + 1));
  const governanceState = config.verified ? "certified" : "playable_unverified";

  const payload = {
    schema_version: "1.0",
    source: {
      system: "fig_official_web",
      scraped_at: `${AUDIT_DATE}T00:00:00.000Z`,
      club_external_id: figClub.source_external_id,
      notes: `Recovery batch gruppo 2 controllato ${AUDIT_DATE} per ${figClub.name}`
    },
    club: {
      name: figClub.name,
      name_normalized: slugify(figClub.name).replaceAll("-", " "),
      city: figClub.city || null,
      country: figClub.country || "Italia",
      data_status: config.verified ? "verified" : "needs_review",
      source_type: "fig_import",
      is_complex: false,
      playable: true,
      is_active: figClub.is_active ?? true,
      source_system: "fig",
      source_external_id: figClub.source_external_id,
      fig_club_source_external_id: figClub.source_external_id,
      fig_match_status: "matched",
      fig_match_confidence: 1,
      fig_match_notes: "Identita' collegata direttamente al catalogo FIG; stato giocabile deciso dal recovery audit.",
      club_taxonomy: null,
      source_payload: {
        ...(figClub.source_payload || {}),
        official_catalog: "fig",
        original_fig_club_name: figClub.name,
        verification_status: config.verified ? "verified" : "playable_review",
        ...(config.verified ? { stablr_approved: true } : {}),
        governance_state: governanceState,
        website_evidence_status: config.verified ? "verified" : "verified_with_certification_gap",
        official_course_links: config.links,
        verification_notes: config.note,
        physical_hole_count: config.physicalHoleCount,
        ...(config.unpublishedFigRoutes ? { unpublished_fig_routes: config.unpublishedFigRoutes } : {}),
        import_profile: `fig_recovery_batch_group_2_${AUDIT_DATE}`,
        product_rule: "Pubblicare solo i playable course FIG esplicitamente mappati e validati."
      }
    },
    routes,
    route_combinations: []
  };

  validateNormalizedPayload(payload);
  return payload;
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(FIG_PATH, "utf8"));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const summary = [];

  for (const config of configs) {
    const payload = await buildPayload(catalog, config);
    const outputPath = path.join(OUTPUT_DIR, `${slugify(config.figName)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    summary.push({
      club: config.figName,
      governance_state: payload.club.source_payload.governance_state,
      playable: payload.club.playable,
      routes: payload.routes.length,
      unpublished_fig_routes: config.unpublishedFigRoutes || [],
      output: path.relative(repoRoot, outputPath)
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
