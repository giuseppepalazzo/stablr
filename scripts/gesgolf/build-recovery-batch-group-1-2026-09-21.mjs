import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");
const AUDIT_DATE = "2026-09-21";

const PUNTA_ALA_18 = [
  [4, 17], [3, 15], [4, 9], [5, 7], [4, 3], [3, 13], [5, 5], [4, 1], [4, 11],
  [5, 10], [3, 12], [4, 2], [5, 8], [4, 6], [3, 18], [4, 4], [4, 14], [4, 16]
];
const RONCEGNO_9 = [
  [4, 1], [4, 3], [5, 2], [4, 4], [4, 7], [3, 5], [3, 8], [3, 6], [4, 9]
];
const SALERNO_9_PAR_34 = [
  [4, 2], [3, 8], [5, 4], [3, 9], [4, 7], [4, 5], [3, 6], [4, 3], [4, 1]
];

function repeated18(rows) {
  return [
    ...rows.map(([par, strokeIndex]) => [par, strokeIndex * 2 - 1]),
    ...rows.map(([par, strokeIndex]) => [par, strokeIndex * 2])
  ];
}

const configs = [
  {
    figName: "Musella",
    gesPath: "data/gesgolf/normalized/musella/circolo-674.json",
    playable: true,
    verified: false,
    physicalHoleCount: 12,
    governanceState: "playable_unverified",
    links: [
      "https://golfmusella.it/the-course/",
      "https://golfmusella.it/old-course/",
      "https://golfmusella.it/del-drago/",
      "https://golfmusella.it/corte-tetra/",
      "https://golfmusella.it/fibbio-18-buche/",
      "https://www.federgolfveneto.it/golf-clubs/242-musella",
      "https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=674"
    ],
    note: "Il sito ufficiale e FederGolf Veneto confermano il campo fisico attuale da 12 buche. Le scorecard ufficiali 2025 di Old Course, Del Drago, Corte Tetra e Fibbio coincidono con PAR/HCP GesGolf; FIG conserva le sette identita' 9/18. Fibbio 18 e' il routing ufficiale 12+6. Le tre route 18 che ripetono una nove usano le matrici GesGolf complete e restano arancioni perche' l'espansione SI 1-9 in SI 1-18 non e' esplicitata dalla scorecard ufficiale.",
    routes: [
      ["CORTE TETRA - 18 buche", "Corte Tetra 18 buche", "2728", 18],
      ["CORTE TETRA - 9 buche", "Corte Tetra 9 buche", "2727", 9],
      ["DEL DRAGO - 18 buche", "Del Drago 18 buche", "2724", null],
      ["DEL DRAGO - 9 buche", "Del Drago 9 buche", "2723", null],
      ["FIBBIO - 18 buche 2024 (12+6)", "Fibbio 18 buche", "2825", null],
      ["OLD COURSE - 18 buche", "Old Course 18 buche", "2726", null],
      ["OLD COURSE - 9 buche", "Old Course 9 buche", "2725", null]
    ]
  },
  {
    figName: "Pavoniere",
    gesPath: "data/gesgolf/normalized/pavoniere/circolo-703.json",
    playable: true,
    verified: true,
    physicalHoleCount: 18,
    governanceState: "certified",
    links: [
      "https://www.pavoniere.it/index.php/score/",
      "https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=703"
    ],
    note: "La scorecard ufficiale espone PAR/HCP completi per tutte le 18 buche e coincide con GesGolf. Le route principali, short, prime/seconde nove, ripetizioni delle nove e Campionato 2026 sono mappate su identita' FIG distinte; le ripetizioni SI sono trasformazioni deterministiche delle due nove ufficiali e coincidono con GesGolf.",
    routes: [
      ["18 Buche", "18 Buche", "1839", 18],
      ["18 buche short", "18 buche short", "2221", null],
      ["2 volte le seconde nove", "2 volte le seconde nove", "2392", null],
      ["Campionato Nazionale Maschile Match Play 2026", "Campionato Nazionale Maschile Match Play 2026", "3006", null],
      ["prime 9 short 2 volte", "prime 9 short 2 volte", "2393", null],
      ["Prime Nove", "Prime Nove", "1842", 9],
      ["prime nove sh", "prime nove short", "2222", null],
      ["seconde 9 short 2 volte", "seconde 9 short 2 volte", "2392", null],
      ["Seconde Nove", "Seconde Nove", "1843", null],
      ["seconde nove sh", "seconde nove short", "2223", null]
    ]
  },
  {
    figName: "Punta Ala",
    playable: true,
    verified: false,
    governanceState: "playable_unverified",
    physicalHoleCount: 18,
    links: [
      "https://golfpuntaala.it/percorso",
      "https://www.allsquaregolf.com/golf-courses/italy/golf-club-punta-ala",
      "https://flyawaygolf.com/golfs/golf-club-punta-ala"
    ],
    note: "Il sito ufficiale conferma il percorso corrente 18 buche Par 72 e pubblica PAR, distanze e 16 HCP leggibili. Due fonti secondarie indipendenti pubblicano la stessa matrice completa: i valori coincidono con tutti gli HCP ufficiali validi e risolvono i typo della pagina alle buche 3, 10 e 11. La matrice consente una scorecard affidabile ma non raggiunge la soglia verde.",
    manualRoutes: [
      { figName: "18 Buche", displayName: "18 Buche", matrix: PUNTA_ALA_18, defaultForHoles: 18, holeSource: "official_site_plus_two_secondary_scorecards" },
      { figName: "Prime Nove", displayName: "Prime Nove", matrix: PUNTA_ALA_18.slice(0, 9), defaultForHoles: 9, holeSource: "segment_of_supported_18", derived: true },
      { figName: "Seconde Nove", displayName: "Seconde Nove", matrix: PUNTA_ALA_18.slice(9), holeSource: "segment_of_supported_18", derived: true }
    ]
  },
  {
    figName: "Roncegno",
    playable: true,
    verified: false,
    governanceState: "playable_unverified",
    physicalHoleCount: 9,
    links: [
      "https://www.golfclubroncegno.it/percorso",
      "https://www.hole19golf.com/courses/golf-club-roncegno"
    ],
    note: "Il sito ufficiale conferma il campo fisico corrente da 9 buche e la matrice PAR, salvo il typo che mostra il totale 34 sulla buca 9. Hole19 completa gli SI 1-9 ed e' coerente con tutti i PAR ufficiali. La route FIG 18 buche Par 68 usa la trasformazione Stablr standard gia' validata per i doppi giri 9→18: primo giro dispari, secondo giro pari.",
    manualRoutes: [
      { figName: "9 buche", displayName: "9 Buche", matrix: RONCEGNO_9, defaultForHoles: 9, holeSource: "official_par_plus_hole19_si" },
      { figName: "18 buche", displayName: "18 Buche", matrix: repeated18(RONCEGNO_9), defaultForHoles: 18, holeSource: "stablr_standard_repeated_9", derived: true }
    ]
  },
  {
    figName: "Salerno",
    playable: true,
    verified: false,
    governanceState: "playable_unverified",
    physicalHoleCount: 9,
    links: [
      "https://golfclubsalerno.it/percorso/",
      "https://www.hole19golf.com/courses/golf-club-salerno"
    ],
    note: "Il sito ufficiale conferma il percorso fisico corrente 9 buche Par 34 e pubblica tabelle EGA 9/18; Hole19 completa la matrice PAR/SI del 9/34. La route FIG 18 buche Par 68 usa la trasformazione Stablr standard dei doppi giri 9→18. Le varianti FIG Par 33/66 restano identita' catalogo non pubblicate per conflitto con il percorso corrente, senza bloccare 9/34 e 18/68.",
    unpublishedFigRoutes: ["9 Buche Par 33", "18 Buche Par 66"],
    manualRoutes: [
      { figName: "9 Buche Par 34", displayName: "9 Buche Par 34", matrix: SALERNO_9_PAR_34, defaultForHoles: 9, holeSource: "official_structure_plus_hole19_matrix" },
      { figName: "18 Buche Par 68", displayName: "18 Buche Par 68", matrix: repeated18(SALERNO_9_PAR_34), defaultForHoles: 18, holeSource: "stablr_standard_repeated_9", derived: true }
    ]
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findFigClub(catalog, name) {
  const club = catalog.clubs.find((item) => item.name === name);
  assert(club, `Club FIG non trovato: ${name}`);
  return club;
}

function findFigCourse(figClub, name) {
  const course = figClub.playable_courses.find((item) => item.name === name && item.is_active !== false);
  assert(course, `${figClub.name}: playable course FIG non trovato o inattivo: ${name}`);
  return course;
}

function findGesCourse(gesPayload, id) {
  const course = gesPayload.playable_courses.find((item) => String(item.percorso_id) === String(id));
  assert(course, `Route GesGolf non trovata: ${id}`);
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

function buildRoute(config, figClub, gesPayload, routeSpec, displayOrder) {
  const [figName, displayName, gesId, defaultForHoles] = routeSpec;
  const figCourse = findFigCourse(figClub, figName);
  const gesCourse = findGesCourse(gesPayload, gesId);
  assert(gesCourse.holes_count === figCourse.holes_count, `${config.figName}/${figName}: numero buche discordante`);
  assert(gesCourse.total_par === figCourse.total_par, `${config.figName}/${figName}: par FIG/GesGolf discordante`);

  const indexes = gesCourse.holes.map((hole) => hole.hcp);
  assert(indexes.length === figCourse.holes_count, `${config.figName}/${figName}: matrice incompleta`);
  assert(new Set(indexes).size === indexes.length, `${config.figName}/${figName}: SI duplicati`);
  assert(Math.min(...indexes) === 1 && Math.max(...indexes) === figCourse.holes_count, `${config.figName}/${figName}: SI fuori range`);

  return {
    external_key: figCourse.source_external_id,
    name: displayName,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: displayOrder,
    is_active: true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: "gesgolf_crosschecked",
      fig_display_name: figCourse.name,
      gesgolf_route_id: String(gesCourse.percorso_id),
      gesgolf_route_name: gesCourse.name,
      governance_state: config.governanceState,
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: defaultForHoles,
        default_source: `fig_recovery_batch_${AUDIT_DATE}`
      },
      evidence_links: config.links,
      evidence_note: config.note
    },
    holes: gesCourse.holes.map((hole, index) => ({
      physical_hole_number: index + 1,
      par: hole.par,
      stroke_index: hole.hcp,
      display_label: String(index + 1)
    })),
    tees: teePayload(figCourse)
  };
}

function buildManualRoute(config, figClub, routeSpec, displayOrder) {
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
      hole_by_hole_source: routeSpec.holeSource,
      fig_display_name: figCourse.name,
      governance_state: config.governanceState,
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
        default_source: `fig_recovery_batch_${AUDIT_DATE}`
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
  const gesPayload = config.gesPath
    ? JSON.parse(await fs.readFile(path.join(repoRoot, config.gesPath), "utf8"))
    : null;
  const routes = (config.routes || []).map((route, index) =>
    buildRoute(config, figClub, gesPayload, route, index + 1)
  );
  routes.push(...(config.manualRoutes || []).map((route, index) =>
    buildManualRoute(config, figClub, route, routes.length + index + 1)
  ));

  const payload = {
    schema_version: "1.0",
    source: {
      system: "fig_official_web",
      scraped_at: `${AUDIT_DATE}T00:00:00.000Z`,
      club_external_id: figClub.source_external_id,
      notes: `Recovery batch gruppo 1 controllato ${AUDIT_DATE} per ${figClub.name}`
    },
    club: {
      name: figClub.name,
      name_normalized: slugify(figClub.name).replaceAll("-", " "),
      city: figClub.city || null,
      country: figClub.country || "Italia",
      data_status: config.verified ? "verified" : "needs_review",
      source_type: "fig_import",
      is_complex: !config.playable || config.physicalHoleCount > 18 || routes.length > 3,
      playable: config.playable,
      is_active: figClub.is_active ?? true,
      source_system: "fig",
      source_external_id: figClub.source_external_id,
      fig_club_source_external_id: figClub.source_external_id,
      fig_match_status: "matched",
      fig_match_confidence: 1,
      fig_match_notes: "Identita' collegata direttamente al catalogo FIG; stato giocabile deciso dal recovery audit.",
      club_taxonomy: config.playable ? null : "complex_official",
      source_payload: {
        ...(figClub.source_payload || {}),
        official_catalog: "fig",
        original_fig_club_name: figClub.name,
        verification_status: config.verified ? "verified" : config.playable ? "playable_review" : "in_review",
        ...(config.verified ? { stablr_approved: true } : {}),
        governance_state: config.governanceState,
        website_evidence_status: config.verified ? "verified" : config.playable ? "verified_with_certification_gap" : "review_open",
        official_course_links: config.links,
        verification_notes: config.note,
        physical_hole_count: config.physicalHoleCount,
        ...(config.unpublishedFigRoutes ? { unpublished_fig_routes: config.unpublishedFigRoutes } : {}),
        import_profile: `fig_recovery_batch_group_1_${AUDIT_DATE}`,
        product_rule: config.playable
          ? "Pubblicare solo i playable course FIG esplicitamente mappati e validati."
          : "Rappresentare il club FIG senza renderlo giocabile finche' i guardrail restano aperti."
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
      governance_state: config.governanceState,
      playable: config.playable,
      routes: payload.routes.length,
      output: path.relative(repoRoot, outputPath)
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
