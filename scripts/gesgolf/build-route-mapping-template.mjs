import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { FIG_CATALOG_PATH, buildCsv } from "./shared.mjs";
import {
  BATCH_REPORT_PATH,
  ROUTE_MAPPINGS_TEMPLATE_CSV,
  ROUTE_MAPPINGS_TEMPLATE_JSON,
  MANUAL_ROUTE_MAPPINGS_PATH,
  buildSuggestedRelation,
  buildManualRouteMappingIndex,
  loadJson,
  rankRouteCandidates,
  summarizeMappingConfidence
} from "./route-mapping-lib.mjs";

const PROTECTED_CLUBS = new Set(["mare di roma", "parco de medici"]);
const NORMALIZED_ROOT = path.join(process.cwd(), "data", "gesgolf", "normalized");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findFigCourseByName(figCourses, targetName) {
  const target = normalize(targetName);
  return figCourses.find((course) => normalize(course.name) === target) || null;
}

async function main() {
  const [batchReport, figCatalog, manualMappings] = await Promise.all([
    loadJson(BATCH_REPORT_PATH),
    loadJson(FIG_CATALOG_PATH),
    loadJson(MANUAL_ROUTE_MAPPINGS_PATH)
  ]);

  const figByName = new Map((figCatalog.clubs || []).map((club) => [club.name, club]));
  const manualIndex = buildManualRouteMappingIndex(manualMappings);
  const normalizedByCircolo = await indexNormalizedByCircoloId();
  const csvRows = [];
  const jsonRows = [];

  const strongCoverageRows = (batchReport.results || [])
    .filter((row) => row.action === "scraped")
    .concat(
      (batchReport.skipped || [])
        .filter((row) => row.action === "skip_protected" && row.circolo_id && normalizedByCircolo.has(row.circolo_id))
        .map((row) => ({
          fig_club: row.fig_club,
          gesgolf_club: row.gesgolf_club,
          circolo_id: row.circolo_id,
          scrape_status: "protected_reference",
          output: normalizedByCircolo.get(row.circolo_id)
        }))
    );

  for (const batchRow of strongCoverageRows) {
    const figClub = figByName.get(batchRow.fig_club);
    if (!figClub || !batchRow.output) continue;

    const gesPayload = await loadJson(path.isAbsolute(batchRow.output) ? batchRow.output : path.join(process.cwd(), batchRow.output));
    const protectedLive = PROTECTED_CLUBS.has(normalize(batchRow.fig_club));
    const figCourses = figClub.playable_courses || [];

    for (const gesRoute of gesPayload.playable_courses || []) {
      const ranked = rankRouteCandidates(gesRoute, figCourses);
      const best = ranked[0] || null;
      const manualKey = `${batchRow.circolo_id}::${normalize(gesRoute.name)}`;
      const manual = manualIndex.get(manualKey) || null;
      const confidence = manual?.confidence || summarizeMappingConfidence(best?.score || 0);
      const manualCourse = manual ? findFigCourseByName(figCourses, manual.fig_course_name) : null;
      const row = {
        fig_club: batchRow.fig_club,
        gesgolf_club: batchRow.gesgolf_club,
        circolo_id: batchRow.circolo_id,
        protected_live: protectedLive ? "yes" : "no",
        scrape_status: batchRow.scrape_status,
        ges_route_name: gesRoute.name,
        ges_holes_count: gesRoute.holes_count,
        ges_total_par: gesRoute.total_par,
        ges_playable_kind: gesRoute.playable_kind,
        ges_route_status: gesRoute.status,
        ges_route_anomalies: (gesRoute.anomalies || []).join("|"),
        suggested_fig_course_name: manual?.fig_course_name || best?.fig_course_name || "",
        suggested_fig_source_external_id: manual
          ? (manualCourse?.source_external_id || "")
          : (best?.fig_source_external_id || ""),
        suggested_relation: manual?.relation || buildSuggestedRelation(gesRoute, best),
        suggested_confidence: confidence,
        suggested_score: manual ? "manual" : (best?.score ?? ""),
        suggested_reasons: manual ? "manual_benchmark_override" : (best?.reasons || []).join("|"),
        final_fig_course_name: "",
        final_fig_source_external_id: "",
        final_relation: "",
        final_status:
          manual && protectedLive
            ? "protected_reference"
            : confidence === "high" && gesRoute.status === "safe" && !protectedLive
              ? "candidate_safe"
              : "needs_review",
        notes: protectedLive ? "protected_club_no_live_upsert" : ""
      };

      if (!row.suggested_fig_source_external_id && row.suggested_fig_course_name) {
        const fallbackCourse = findFigCourseByName(figCourses, row.suggested_fig_course_name);
        if (fallbackCourse?.source_external_id) {
          row.suggested_fig_source_external_id = fallbackCourse.source_external_id;
        }
      }

      csvRows.push(row);
      jsonRows.push({
        ...row,
        top_candidates: ranked.slice(0, 3)
      });
    }
  }

  await mkdir(path.dirname(ROUTE_MAPPINGS_TEMPLATE_JSON), { recursive: true });
  await writeFile(ROUTE_MAPPINGS_TEMPLATE_JSON, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    source: {
      batch_report: BATCH_REPORT_PATH,
      fig_catalog: FIG_CATALOG_PATH
    },
    protected_clubs: [...PROTECTED_CLUBS],
    rows: jsonRows
  }, null, 2)}\n`, "utf-8");
  await writeFile(ROUTE_MAPPINGS_TEMPLATE_CSV, buildCsv(csvRows), "utf-8");

  console.log(JSON.stringify({
    rows: csvRows.length,
    jsonOut: ROUTE_MAPPINGS_TEMPLATE_JSON,
    csvOut: ROUTE_MAPPINGS_TEMPLATE_CSV
  }, null, 2));
}

async function indexNormalizedByCircoloId() {
  const folders = await readdir(NORMALIZED_ROOT, { withFileTypes: true });
  const index = new Map();

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const clubDir = path.join(NORMALIZED_ROOT, folder.name);
    const files = await readdir(clubDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.startsWith("circolo-") || !file.name.endsWith(".json")) continue;
      const fullPath = path.join(clubDir, file.name);
      const payload = await loadJson(fullPath);
      const circoloId = payload?.source?.circolo_id;
      if (circoloId) {
        index.set(String(circoloId), fullPath);
      }
    }
  }

  return index;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
