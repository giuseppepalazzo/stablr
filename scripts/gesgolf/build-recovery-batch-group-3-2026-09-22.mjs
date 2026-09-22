import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");
const AUDIT_DATE = "2026-09-22";

const TAURIANA_9 = [
  [4, 11], [4, 1], [5, 9], [3, 5], [4, 15], [3, 13], [5, 3], [3, 7], [4, 17]
];

const TIRRENIA_9 = [
  [5, 8], [4, 4], [4, 7], [3, 9], [4, 3], [5, 6], [3, 5], [4, 1], [4, 2]
];

const TIRRENIA_18 = [
  [5, 15], [4, 7], [4, 13], [3, 17], [4, 5], [5, 11], [3, 9], [4, 1], [4, 3],
  [5, 16], [4, 8], [4, 14], [3, 18], [4, 6], [5, 12], [3, 10], [4, 2], [4, 4]
];

const VALPESCARA_18 = [
  [4, 15], [4, 3], [3, 13], [4, 5], [4, 1], [4, 9], [5, 17], [3, 11], [5, 7],
  [4, 12], [4, 6], [4, 2], [3, 14], [5, 8], [4, 16], [4, 4], [4, 10], [3, 18]
];

const VERDURA_EAST_18 = [
  [4, 17], [3, 11], [4, 15], [5, 5], [4, 1], [4, 7], [3, 3], [5, 13], [4, 9],
  [4, 6], [4, 4], [4, 14], [3, 8], [4, 16], [5, 10], [4, 18], [5, 12], [4, 2]
];

const VERDURA_WEST_18 = [
  [4, 7], [4, 8], [4, 10], [3, 17], [5, 5], [4, 3], [5, 6], [3, 13], [4, 9],
  [5, 14], [4, 11], [3, 18], [4, 12], [4, 2], [3, 16], [4, 1], [3, 15], [4, 4]
];

function paired18FromOdd(rows) {
  return [
    ...rows,
    ...rows.map(([par, strokeIndex]) => [par, strokeIndex + 1])
  ];
}

const configs = [
  {
    figName: "Tauriana",
    playable: true,
    verified: false,
    physicalHoleCount: 9,
    links: [
      "https://www.hole19golf.com/courses/tauriana-golf-club",
      "https://www.leadingcourses.com/it/clubs/europa%2Bitalia%2Bcalabria/tauriana-golf-club"
    ],
    note: "FIG conferma 9/35 e 18/70 con CR della 18 esattamente doppi e slope identici alla 9. Hole19 pubblica PAR e SI completi e coincide con la matrice recuperata; descrizioni indipendenti confermano tutti i PAR. Una scorecard secondaria alternativa scambia gli SI delle buche 3 e 7: si usa la matrice Hole19 corrente, ma il conflitto impedisce il verde. La 18 applica la trasformazione Stablr gia' validata dagli SI dispari del primo giro ai corrispondenti pari del secondo giro.",
    routes: [
      { figName: "9 buche", displayName: "9 Buche", matrix: TAURIANA_9, defaultForHoles: 9, source: "hole19_current_matrix" },
      { figName: "18 buche", displayName: "18 Buche", matrix: paired18FromOdd(TAURIANA_9), defaultForHoles: 18, source: "stablr_standard_paired_odd_even", derived: true, derivationRule: "standard_repeated_9_first_pass_odd_second_pass_even" }
    ]
  },
  {
    figName: "Tirrenia",
    playable: true,
    verified: true,
    physicalHoleCount: 9,
    links: [
      "https://www.golftirrenia.it/",
      "https://www.golftirrenia.it/il-campo/",
      "https://www.golftirrenia.it/il-campo/buca-n-1-tasso/",
      "https://www.golftirrenia.it/il-campo/buca-n-9-poiana/"
    ],
    note: "Il sito ufficiale conferma il campo fisico da nove buche e il Par 72 del doppio giro. Le nove schede ufficiali buca-per-buca espongono PAR e coppie HCP primo/secondo giro complete; la matrice produce esattamente 9/36 e 18/72 FIG. La route Misto ha rating distinti e resta non pubblicata per assenza di routing e matrice specifici.",
    unpublishedFigRoutes: ["Misto"],
    routes: [
      { figName: "Nove buche", displayName: "Nove Buche", matrix: TIRRENIA_9, defaultForHoles: 9, source: "official_hole_cards_compressed_1_9", derived: true, derivationRule: "compress_official_odd_even_pairs_to_1_9" },
      { figName: "18 Buche", displayName: "18 Buche", matrix: TIRRENIA_18, defaultForHoles: 18, source: "official_hole_cards_paired_hcp" }
    ]
  },
  {
    figName: "Valpescara",
    playable: true,
    verified: true,
    physicalHoleCount: 18,
    links: ["https://adriaticogolfclubspa.com/il-campo/"],
    note: "Il sito ufficiale corrente Adriatico Golf Club pubblica PAR e HCP completi per tutte le diciotto buche. La matrice coincide con le route FIG 18 BUCHE 2017 Par 71, Prime Nove Par 36 e Seconde Nove Par 35. Le famiglie Laghi e Piano restano non pubblicate: il solo Par coincidente non dimostra equivalenza di routing o SI.",
    unpublishedFigRoutes: ["18 buche laghi", "9b laghi", "9b piano", "9b piano 2 Volte"],
    routes: [
      { figName: "18 BUCHE 2017", displayName: "18 Buche", matrix: VALPESCARA_18, defaultForHoles: 18, source: "official_adriatico_hole_by_hole" },
      { figName: "Prime Nove", displayName: "Prime Nove", matrix: VALPESCARA_18.slice(0, 9), defaultForHoles: 9, source: "segment_of_certified_18", derived: true, derivationRule: "segment_of_certified_18" },
      { figName: "Seconde Nove", displayName: "Seconde Nove", matrix: VALPESCARA_18.slice(9), source: "segment_of_certified_18", derived: true, derivationRule: "segment_of_certified_18" }
    ]
  },
  {
    figName: "Verdura",
    playable: true,
    verified: false,
    physicalHoleCount: 36,
    links: [
      "https://www.roccofortehotels.com/hotels-and-resorts/verdura-resort/golf/",
      "https://www.allsquaregolf.com/golf-courses/italy/verdura-golf-and-spa-resort-east-course",
      "https://www.hole19golf.com/courses/verdura-resort-shore"
    ],
    note: "Il materiale ufficiale corrente conferma i due percorsi Links/East Par 73 e Shore/West Par 70; FIG conserva le identita' East e West con tee, rating e slope aggiornati. All Square pubblica la matrice East completa e Hole19/18Birdies la matrice West completa, entrambe identiche ai dati recuperati. Prime e Seconde Nove corrispondono ai segmenti delle rispettive 18 per PAR e CR FIG. Le sei route sono giocabili ma restano arancioni perche' le matrici SI dipendono da scorecard secondarie, non da una scorecard ufficiale completa del resort.",
    routes: [
      { figName: "East", displayName: "East", matrix: VERDURA_EAST_18, defaultForHoles: 18, source: "official_identity_plus_allsquare_scorecard" },
      { figName: "East Prime Nove", displayName: "East Prime Nove", matrix: VERDURA_EAST_18.slice(0, 9), defaultForHoles: 9, source: "segment_of_supported_east", derived: true, derivationRule: "segment_of_supported_18" },
      { figName: "East Seconde Nove", displayName: "East Seconde Nove", matrix: VERDURA_EAST_18.slice(9), source: "segment_of_supported_east", derived: true, derivationRule: "segment_of_supported_18" },
      { figName: "West", displayName: "West", matrix: VERDURA_WEST_18, source: "official_identity_plus_hole19_scorecard" },
      { figName: "West Prime Nove", displayName: "West Prime Nove", matrix: VERDURA_WEST_18.slice(0, 9), source: "segment_of_supported_west", derived: true, derivationRule: "segment_of_supported_18" },
      { figName: "West Seconde Nove", displayName: "West Seconde Nove", matrix: VERDURA_WEST_18.slice(9), source: "segment_of_supported_west", derived: true, derivationRule: "segment_of_supported_18" }
    ]
  },
  {
    figName: "Villa Giusti",
    playable: false,
    verified: false,
    governanceState: "in_review",
    physicalHoleCount: 18,
    links: [],
    note: "FIG 2025 conferma 18/66, Prime Nove/31 e Seconde Nove/35 con CR additivi e tee completi. La sola scorecard hole-by-hole disponibile appartiene alla precedente configurazione Par 65 (31+34): i suoi HCP non vengono trasferiti alla versione 2025. Il club resta rappresentato e FIG-linked, ma senza route pubblicate finche' non sara' disponibile una matrice SI/HCP 2025 affidabile.",
    unpublishedFigRoutes: ["18 Buche 2025", "Prime Nove 2025", "Seconde Nove 2025"],
    routes: []
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
  return figCourse.tees.filter((tee) => tee.is_active !== false).map((tee) => ({
    tee_name: tee.tee_name,
    tee_color: tee.tee_color || null,
    gender: tee.gender || null,
    course_rating: tee.course_rating ?? null,
    slope_rating: tee.slope_rating ?? null,
    par_total: tee.par_total ?? figCourse.total_par ?? null,
    is_active: true,
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

  const governanceState = config.verified ? "certified" : "playable_unverified";
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
      governance_state: governanceState,
      ...(routeSpec.derived ? { derived_route: true, derivation_rule: routeSpec.derivationRule } : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: routeSpec.defaultForHoles ?? null,
        default_source: `fig_recovery_batch_group_3_${AUDIT_DATE}`
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
  const governanceState = config.governanceState || (config.verified ? "certified" : "playable_unverified");

  const payload = {
    schema_version: "1.0",
    source: {
      system: "fig_official_web",
      scraped_at: `${AUDIT_DATE}T00:00:00.000Z`,
      club_external_id: figClub.source_external_id,
      notes: `Recovery batch gruppo 3 controllato ${AUDIT_DATE} per ${figClub.name}`
    },
    club: {
      name: figClub.name,
      name_normalized: slugify(figClub.name).replaceAll("-", " "),
      city: figClub.city || null,
      country: figClub.country || "Italia",
      data_status: config.verified ? "verified" : "needs_review",
      source_type: "fig_import",
      is_complex: !config.playable || config.routes.length > 3 || Boolean(config.unpublishedFigRoutes?.length),
      playable: config.playable,
      is_active: figClub.is_active ?? true,
      source_system: "fig",
      source_external_id: figClub.source_external_id,
      fig_club_source_external_id: figClub.source_external_id,
      fig_match_status: "matched",
      fig_match_confidence: 1,
      fig_match_notes: "Identita' collegata direttamente al catalogo FIG; stato deciso dal recovery audit gruppo 3.",
      club_taxonomy: config.playable ? null : "complex_official",
      source_payload: {
        ...(figClub.source_payload || {}),
        official_catalog: "fig",
        original_fig_club_name: figClub.name,
        verification_status: config.verified ? "verified" : config.playable ? "playable_review" : "in_review",
        ...(config.verified ? { stablr_approved: true } : {}),
        governance_state: governanceState,
        website_evidence_status: config.verified ? "verified" : config.playable ? "verified_with_certification_gap" : "review_open",
        official_course_links: config.links,
        verification_notes: config.note,
        physical_hole_count: config.physicalHoleCount,
        ...(config.unpublishedFigRoutes ? { unpublished_fig_routes: config.unpublishedFigRoutes } : {}),
        import_profile: `fig_recovery_batch_group_3_${AUDIT_DATE}`,
        product_rule: config.playable
          ? "Pubblicare solo i playable course FIG esplicitamente mappati e validati."
          : "Rappresentare il club FIG senza route live finche' manca una matrice scorecard affidabile."
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
      unpublished_routes: config.unpublishedFigRoutes || [],
      output: path.relative(repoRoot, outputPath)
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
