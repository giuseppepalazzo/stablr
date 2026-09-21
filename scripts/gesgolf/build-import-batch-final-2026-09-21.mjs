import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const FIG_CATALOG_PATH = path.join(repoRoot, "data", "fig", "normalized", "fig-catalog-normalized.json");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

const matrix = (...rows) => rows;
const segment = (rows, start, count) => rows.slice(start, start + count);

const M = {
  padovaGiallo: matrix([5, 2], [4, 6], [3, 7], [5, 4], [3, 5], [4, 3], [5, 8], [3, 9], [4, 1]),
  padovaBlu: matrix([3, 1], [4, 2], [4, 6], [4, 5], [5, 7], [4, 4], [3, 8], [5, 9], [4, 3]),
  padovaRosso: matrix([4, 1], [4, 3], [3, 8], [4, 6], [5, 9], [4, 4], [3, 5], [5, 7], [4, 2]),
  padovaGialloBlu: matrix([5, 1], [4, 9], [3, 7], [5, 11], [3, 13], [4, 5], [5, 15], [3, 17], [4, 3], [3, 2], [4, 4], [4, 12], [4, 10], [5, 14], [4, 8], [3, 16], [5, 18], [4, 6]),
  padovaRossoBlu: matrix([4, 2], [4, 6], [3, 16], [4, 12], [5, 18], [4, 8], [3, 10], [5, 14], [4, 4], [3, 1], [4, 3], [4, 11], [4, 9], [5, 13], [4, 7], [3, 15], [5, 17], [4, 5]),
  padovaRossoGiallo: matrix([4, 1], [4, 5], [3, 15], [4, 11], [5, 17], [4, 7], [3, 9], [5, 13], [4, 3], [5, 2], [4, 10], [3, 8], [5, 12], [3, 14], [4, 6], [5, 16], [3, 18], [4, 4]),

  montecchiaBianco: matrix([5, 4], [3, 3], [4, 2], [4, 5], [4, 8], [4, 1], [3, 7], [4, 9], [5, 6]),
  montecchiaRosso: matrix([4, 6], [3, 5], [5, 8], [4, 4], [4, 9], [4, 2], [4, 1], [3, 3], [5, 7]),
  montecchiaVerde: matrix([4, 9], [5, 4], [4, 2], [3, 6], [4, 5], [3, 8], [4, 7], [5, 3], [4, 1]),
  montecchiaBiancoRosso: matrix([5, 7], [3, 5], [4, 3], [4, 9], [4, 15], [4, 1], [3, 13], [4, 17], [5, 11], [4, 12], [3, 10], [5, 16], [4, 8], [4, 18], [4, 4], [4, 2], [3, 6], [5, 14]),
  montecchiaBiancoVerde: matrix([5, 7], [3, 5], [4, 3], [4, 9], [4, 15], [4, 1], [3, 13], [4, 17], [5, 11], [4, 18], [5, 8], [4, 4], [3, 12], [4, 10], [3, 16], [4, 14], [5, 6], [4, 2]),
  montecchiaRossoVerde: matrix([4, 11], [3, 9], [5, 15], [4, 7], [4, 17], [4, 3], [4, 1], [3, 5], [5, 13], [4, 18], [5, 8], [4, 4], [3, 12], [4, 10], [3, 16], [4, 14], [5, 6], [4, 2]),
  montecchiaVerdeVerde: matrix([4, 17], [5, 7], [4, 3], [3, 11], [4, 9], [3, 15], [4, 13], [5, 5], [4, 1], [4, 18], [5, 8], [4, 4], [3, 12], [4, 10], [3, 16], [4, 14], [5, 6], [4, 2]),

  pustertal18: matrix([3, 9], [4, 3], [3, 13], [4, 11], [4, 5], [4, 1], [4, 15], [3, 17], [4, 7], [3, 10], [4, 4], [3, 14], [4, 12], [4, 6], [4, 2], [4, 16], [3, 18], [4, 8]),
  stVigil18: matrix([4, 6], [4, 18], [5, 4], [3, 14], [4, 16], [4, 2], [4, 10], [3, 12], [4, 8], [5, 7], [3, 11], [4, 13], [4, 5], [4, 15], [3, 17], [4, 3], [3, 9], [4, 1]),
  tarvisio18: matrix([4, 8], [4, 10], [3, 14], [3, 18], [4, 16], [4, 6], [5, 4], [4, 2], [4, 12], [3, 9], [4, 15], [5, 13], [4, 3], [5, 7], [3, 17], [3, 5], [4, 1], [4, 11])
};

const CLUBS = [
  {
    figName: "Padova",
    physicalHoleCount: 27,
    verified: false,
    links: [
      "https://www.golfclubpadova.it/percorso-giallo/",
      "https://www.golfclubpadova.it/percorso-blu/",
      "https://www.golfclubpadova.it/percorso-rosso/",
      "https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=29"
    ],
    note: "FIG e GesGolf 2025 coincidono su struttura, Par e matrici operative delle tre nove e delle combinazioni. Le pagine ufficiali confermano i tre segmenti e le distanze, ma non espongono HCP/SI buca per buca: pubblicazione arancione.",
    routes: [
      ["Padova 2025 - Percorso Giallo-Blu", "Giallo-Blu", M.padovaGialloBlu, 18, ["giallo", "blu"]],
      ["Padova 2025 - Percorso Rosso-Blu", "Rosso-Blu", M.padovaRossoBlu, null, ["rosso", "blu"]],
      ["Padova 2025 - Percorso Rosso-Giallo", "Rosso-Giallo", M.padovaRossoGiallo, null, ["rosso", "giallo"]],
      ["Padova 2025 - Percorso Giallo 9 buche", "Giallo", M.padovaGiallo, 9, ["giallo"]],
      ["Padova 2025 - Percorso Blu 9 buche", "Blu", M.padovaBlu, null, ["blu"]],
      ["Padova 2025 - Percorso Rosso 9 Buche", "Rosso", M.padovaRosso, null, ["rosso"]]
    ]
  },
  {
    figName: "Montecchia Golf",
    physicalHoleCount: 27,
    verified: true,
    links: [
      "https://www.golfmontecchia.it/il-percorso-bianco",
      "https://www.golfmontecchia.it/il-percorso-rosso",
      "https://www.golfmontecchia.it/percorso-verde",
      "https://www.golfmontecchia.it/images/pdf/FILE3-Montecchia_book_FINALE-compresso.pdf",
      "https://www.gesgolf.it/golfonline/clubs/percorsi.aspx?circolo_id=831"
    ],
    note: "Le schede buca-per-buca ufficiali confermano PAR e HCP/SI completi per Bianco, Rosso e Verde; le 7 matrici attive coincidono integralmente con GesGolf e FIG. FIG resta l'autorita' per l'identita' della route Verde: alcune grafiche della relativa pagina riportano il nome storico/incoerente 'Percorso Giallo', senza divergenze numeriche. Albarella, Galzignano e varianti tecniche VO23 restano escluse.",
    routes: [
      ["Bianco-Rosso", "Bianco-Rosso", M.montecchiaBiancoRosso, 18, ["bianco", "rosso"]],
      ["Bianco-Verde", "Bianco-Verde", M.montecchiaBiancoVerde, null, ["bianco", "verde"]],
      ["Rosso-Verde", "Rosso-Verde", M.montecchiaRossoVerde, null, ["rosso", "verde"]],
      ["Verde-Verde", "Verde-Verde", M.montecchiaVerdeVerde, null, ["verde", "verde"]],
      ["Bianco 9 b.", "Bianco", M.montecchiaBianco, 9, ["bianco"]],
      ["Rosso 9 b.", "Rosso", M.montecchiaRosso, null, ["rosso"]],
      ["Verde 9 b.", "Verde", M.montecchiaVerde, null, ["verde"]]
    ]
  },
  {
    figName: "Pustertal",
    physicalHoleCount: 9,
    verified: true,
    links: ["https://www.golfpustertal.com/it/campo-da-golf/scorecard-rating"],
    note: "La scorecard ufficiale corrente espone Par, HCP, distanze, CR e Slope completi per il Par 66; coincide con le route FIG 2021. La vecchia route FIG/GesGolf Par 68 e la Prime Nove legacy restano escluse.",
    routes: [
      ["18 BUCHE 2021", "18 Buche", M.pustertal18, 18],
      ["9 BUCHE 2021", "9 Buche", segment(M.pustertal18, 0, 9), 9]
    ]
  },
  {
    figName: "St. Vigil Seis",
    physicalHoleCount: 18,
    verified: true,
    links: ["https://www.golfstvigilseis.it/en/golf-courese-prices/golf-course-routing/"],
    note: "Le 18 schede ufficiali 2025 pubblicano Par e HCP di ogni buca. La matrice completa e i segmenti Prime/Seconde Nove coincidono con i totali FIG Par 69 (35+34).",
    routes: [
      ["18 Buche", "18 Buche", M.stVigil18, 18],
      ["Prime Nove", "Prime Nove", segment(M.stVigil18, 0, 9), 9],
      ["Seconde Nove", "Seconde Nove", segment(M.stVigil18, 9, 9), null]
    ]
  },
  {
    figName: "Tarvisio",
    physicalHoleCount: 18,
    verified: true,
    links: ["https://golfsenzaconfini.com/it", "https://cdn.jessas.org/downloads/Scorecard.pdf"],
    note: "La scorecard ufficiale corrente espone la matrice completa Par 70/HCP e coincide con la route FIG 18 buche 2013. Le route FIG da 9 sono escluse perché il sito corrente definisce Inferiore e Superiore con una composizione diversa da semplici prime/seconde nove.",
    routes: [["18 buche 2013", "18 Buche", M.tarvisio18, 18]]
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
  const course = figClub.playable_courses.find((item) => item.name === name);
  assert(course, `${figClub.name}: percorso FIG non trovato: ${name}`);
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

function routeHoles(rows) {
  return rows.map(([par, strokeIndex], index) => ({
    physical_hole_number: index + 1,
    par,
    stroke_index: strokeIndex,
    display_label: String(index + 1)
  }));
}

function validateMatrix(config, figCourse, rows) {
  assert(rows.length === figCourse.holes_count, `${config.figName} / ${figCourse.name}: numero buche non coerente`);
  assert(rows.reduce((sum, [par]) => sum + par, 0) === figCourse.total_par, `${config.figName} / ${figCourse.name}: Par non coerente`);
  const indexes = rows.map(([, value]) => value).filter((value) => value != null);
  assert(new Set(indexes).size === indexes.length, `${config.figName} / ${figCourse.name}: HCP duplicati`);
  if (rows.length === 18) {
    assert(indexes.length === 18 && Math.min(...indexes) === 1 && Math.max(...indexes) === 18, `${config.figName} / ${figCourse.name}: HCP incompleti`);
  }
}

function buildRoute(config, figClub, routeSpec, displayOrder) {
  const [figCourseName, name, rows, defaultForHoles, routeColorKeys] = routeSpec;
  const figCourse = findFigCourse(figClub, figCourseName);
  validateMatrix(config, figCourse, rows);
  return {
    external_key: figCourse.source_external_id,
    name,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: displayOrder,
    is_active: true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: config.verified ? "official_club_evidence" : "fig_gesgolf_review",
      fig_display_name: figCourse.name,
      ...(routeColorKeys ? { route_color_keys: routeColorKeys } : {}),
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: defaultForHoles,
        default_source: "fig_official_web_batch_2026_09_21"
      },
      evidence_links: config.links,
      evidence_note: config.note
    },
    holes: routeHoles(rows),
    tees: teePayload(figCourse)
  };
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(FIG_CATALOG_PATH, "utf8"));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputs = [];

  for (const config of CLUBS) {
    const figClub = findFigClub(catalog, config.figName);
    const routes = config.routes.map((routeSpec, index) => buildRoute(config, figClub, routeSpec, index + 1));
    const payload = {
      schema_version: "1.0",
      source: {
        system: "fig_official_web",
        scraped_at: new Date().toISOString(),
        club_external_id: figClub.source_external_id,
        notes: `FIG + batch finale controllato 2026-09-21 per ${figClub.name}`
      },
      club: {
        name: figClub.name,
        name_normalized: slugify(figClub.name).replaceAll("-", " "),
        city: figClub.city || null,
        country: figClub.country || "Italia",
        data_status: config.verified ? "verified" : "needs_review",
        source_type: "fig_import",
        is_complex: config.physicalHoleCount > 18 || config.routes.length > 3,
        playable: true,
        is_active: figClub.is_active ?? true,
        source_system: "fig",
        source_external_id: figClub.source_external_id,
        source_payload: {
          ...(figClub.source_payload || {}),
          official_catalog: "fig",
          original_fig_club_name: figClub.name,
          verification_status: config.verified ? "verified" : "playable_review",
          ...(config.verified ? { stablr_approved: true } : {}),
          website_evidence_status: config.verified ? "verified" : "review_completed_with_open_issue",
          official_course_links: config.links,
          verification_notes: config.note,
          physical_hole_count: config.physicalHoleCount,
          import_profile: "fig_official_web_final_batch_2026_09_21",
          product_rule: "Pubblicare solo i percorsi esplicitamente mappati; escludere route legacy, tecniche, duplicate o non confermate."
        }
      },
      routes,
      route_combinations: []
    };

    validateNormalizedPayload(payload);
    const outputPath = path.join(OUTPUT_DIR, `${slugify(figClub.name)}-normalized.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    outputs.push({ club: figClub.name, status: payload.club.data_status, routes: routes.length, output: path.relative(repoRoot, outputPath) });
  }

  assert(outputs.length === 5, `Il lotto deve contenere 5 club, trovati ${outputs.length}`);
  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
