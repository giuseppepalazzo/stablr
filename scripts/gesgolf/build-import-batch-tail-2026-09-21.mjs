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
  sestrieres18: matrix(
    [4, 5], [3, 7], [4, 15], [3, 17], [4, 13], [3, 3], [3, 9], [4, 1], [3, 11],
    [3, 6], [3, 14], [5, 12], [3, 10], [4, 18], [4, 4], [4, 16], [4, 2], [4, 8]
  ),
  valdichiana18: matrix(
    [3, 11], [5, 3], [4, 5], [4, 9], [4, 17], [3, 7], [5, 1], [3, 15], [3, 13],
    [3, 12], [5, 4], [4, 6], [4, 10], [4, 18], [3, 8], [5, 2], [3, 16], [3, 14]
  )
};

const CLUBS = [
  {
    figName: "Sestrieres",
    physicalHoleCount: 18,
    links: ["https://www.vialattea.it/estate/sport-e-attivita/golf/"],
    note: "La pagina ufficiale Vialattea pubblica Par e HCP per tutte le 18 buche. La matrice completa Par 65 e il segmento Prime Nove Par 31 coincidono con le route e i rating FIG.",
    routes: [
      ["18 Buche", "18 Buche", M.sestrieres18, 18],
      ["prime nove", "Prime Nove", segment(M.sestrieres18, 0, 9), 9]
    ]
  },
  {
    figName: "Valdichiana",
    physicalHoleCount: 9,
    links: ["https://www.golfclubvaldichiana.it/golf-club/il-campo/"],
    note: "La pagina ufficiale pubblica Par e coppie HCP/colpi per ciascuna delle 9 buche fisiche. Il primo valore forma il primo passaggio e il secondo il passaggio successivo: ne derivano deterministicamente la route 18 buche Par 68 e la Nove Buche Par 34 riconosciute da FIG.",
    routes: [
      ["18 Buche", "18 Buche", M.valdichiana18, 18],
      ["Nove Buche", "Nove Buche", segment(M.valdichiana18, 0, 9), 9]
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
  const [figCourseName, name, rows, defaultForHoles] = routeSpec;
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
      hole_by_hole_source: "official_club_evidence",
      fig_display_name: figCourse.name,
      round_variant: {
        holes_count: figCourse.holes_count,
        default_for_holes: defaultForHoles,
        default_source: "fig_official_web_tail_batch_2026_09_21"
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
        notes: `FIG + coda batch finale controllata 2026-09-21 per ${figClub.name}`
      },
      club: {
        name: figClub.name,
        name_normalized: slugify(figClub.name).replaceAll("-", " "),
        city: figClub.city || null,
        country: figClub.country || "Italia",
        data_status: "verified",
        source_type: "fig_import",
        is_complex: false,
        playable: true,
        is_active: figClub.is_active ?? true,
        source_system: "fig",
        source_external_id: figClub.source_external_id,
        source_payload: {
          ...(figClub.source_payload || {}),
          official_catalog: "fig",
          original_fig_club_name: figClub.name,
          verification_status: "verified",
          stablr_approved: true,
          website_evidence_status: "verified",
          official_course_links: config.links,
          verification_notes: config.note,
          physical_hole_count: config.physicalHoleCount,
          import_profile: "fig_official_web_tail_batch_2026_09_21",
          product_rule: "Pubblicare solo i percorsi esplicitamente mappati e certificati dalle fonti ufficiali correnti."
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

  assert(outputs.length === 2, `La coda del lotto deve contenere 2 club, trovati ${outputs.length}`);
  console.log(JSON.stringify(outputs, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
