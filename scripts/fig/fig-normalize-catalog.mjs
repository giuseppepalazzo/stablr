import {
  FIG_TEE_COLUMN_ORDER,
  buildCourseComposition,
  inferCourseType,
  inferRouteFamily,
  normalizeClubName,
  normalizeNameForMatch,
  parseFigInteger,
  parseFigNumber,
  readJsonFile,
  slugify,
  validateFigCatalogPayload,
  writeJsonFile
} from "./shared-catalog.mjs";

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function detectBestTable(rawPayload) {
  const tables = Array.isArray(rawPayload.tables) ? rawPayload.tables : [];
  return tables
    .filter((table) => Array.isArray(table.rows) && table.rows.length > 0)
    .sort((a, b) => b.rows.length - a.rows.length)[0] || null;
}

function isLikelyDataRow(cells) {
  if (!Array.isArray(cells) || cells.length < 4) return false;
  const first = String(cells[0] || "").trim();
  const second = String(cells[1] || "").trim();
  const third = String(cells[2] || "").trim();
  return first && second && Number.isFinite(parseFigInteger(third));
}

function buildTeePayloadsFromCells(cells, totalPar, courseSlug) {
  const teePayloads = [];
  const teeCells = cells.slice(3);

  FIG_TEE_COLUMN_ORDER.forEach((teeMeta, teeIndex) => {
    const crCell = teeCells[teeIndex * 2];
    const slopeCell = teeCells[teeIndex * 2 + 1];
    const courseRating = parseFigNumber(crCell);
    const slopeRating = parseFigInteger(slopeCell);

    if (!Number.isFinite(courseRating) || !Number.isFinite(slopeRating)) return;

    teePayloads.push({
      source_external_id: `fig-tee-${courseSlug}-${slugify(teeMeta.tee_name)}-${teeMeta.default_gender || "mixed"}`,
      tee_name: teeMeta.tee_name,
      tee_color: teeMeta.tee_color,
      gender: teeMeta.default_gender || "",
      course_rating: Number(courseRating.toFixed(1)),
      slope_rating: slopeRating,
      par_total: totalPar,
      tee_order: teeIndex + 1,
      is_active: true,
      source_payload: {
        kind: "tee",
        source_cells: {
          course_rating: crCell ?? null,
          slope_rating: slopeCell ?? null
        }
      }
    });
  });

  return teePayloads;
}

function normalizeClubRows(rows) {
  const clubsByKey = new Map();

  rows.forEach((row) => {
    const cells = row.cells || [];
    if (!isLikelyDataRow(cells)) return;

    const rawClubName = String(cells[0] || "").trim();
    const rawCourseName = String(cells[1] || "").trim();
    const totalPar = parseFigInteger(cells[2]);

    if (!rawClubName || !rawCourseName || !Number.isFinite(totalPar)) return;

    const clubName = normalizeClubName(rawClubName);
    const clubKey = normalizeNameForMatch(clubName);
    const courseName = rawCourseName.replace(/\s+/g, " ").trim();
    const courseSlug = `${slugify(clubName)}-${slugify(courseName)}`;
    const holesCount = parseFigInteger(rawCourseName) === 9 ? 9 : parseFigInteger(rawCourseName) === 18 ? 18 : courseName.toLowerCase().includes("9 buche") || totalPar < 50 ? 9 : 18;
    const courseType = inferCourseType(courseName, holesCount);
    const routeFamily = inferRouteFamily(courseType);

    if (!clubsByKey.has(clubKey)) {
      clubsByKey.set(clubKey, {
        source_external_id: `fig-club-${slugify(clubName)}`,
        name: clubName,
        name_normalized: clubKey,
        city: null,
        region: null,
        country: "Italia",
        is_active: true,
        source_payload: {
          kind: "club"
        },
        playable_courses: []
      });
    }

    clubsByKey.get(clubKey).playable_courses.push({
      source_external_id: `fig-course-${courseSlug}`,
      name: courseName,
      name_normalized: normalizeNameForMatch(courseName),
      holes_count: holesCount,
      total_par: totalPar,
      course_type: courseType,
      route_family: routeFamily,
      display_order: clubsByKey.get(clubKey).playable_courses.length + 1,
      course_composition: buildCourseComposition(courseName, courseType),
      is_active: true,
      source_payload: {
        kind: "playable_course",
        source_row_index: row.row_index
      },
      tees: buildTeePayloadsFromCells(cells, totalPar, courseSlug)
    });
  });

  return [...clubsByKey.values()];
}

async function main() {
  const inputPath =
    getArgValue("--in") || "data/fig/raw/fig-slope-course-rating-raw.json";
  const outputPath =
    getArgValue("--out") || "data/fig/normalized/fig-catalog-normalized.json";

  const { data: rawPayload } = await readJsonFile(inputPath);
  const bestTable = detectBestTable(rawPayload);

  if (!bestTable) {
    throw new Error("Nessuna tabella FIG utilizzabile trovata nel payload raw.");
  }

  const normalizedPayload = {
    schema_version: "1.0",
    import_batch: {
      source_system: "fig",
      source_url: rawPayload.source_url,
      source_version: rawPayload.scraped_at ? rawPayload.scraped_at.slice(0, 10) : null,
      scraped_at: rawPayload.scraped_at,
      notes: "Normalized FIG catalog from raw table extract",
      raw_payload: {
        table_index: bestTable.table_index,
        row_count: bestTable.row_count
      }
    },
    clubs: normalizeClubRows(bestTable.rows || [])
  };

  validateFigCatalogPayload(normalizedPayload);
  const savedPath = await writeJsonFile(outputPath, normalizedPayload);
  console.log(`Catalogo FIG normalizzato salvato in ${savedPath}`);
  console.log(`Club normalizzati: ${normalizedPayload.clubs.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
