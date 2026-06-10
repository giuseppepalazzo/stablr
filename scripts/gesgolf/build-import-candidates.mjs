import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCsv } from "./shared.mjs";
import { ROUTE_MAPPINGS_DIR, ROUTE_MAPPINGS_TEMPLATE_JSON, loadJson } from "./route-mapping-lib.mjs";

const OUTPUT_JSON = path.join(ROUTE_MAPPINGS_DIR, "import-candidates.json");
const OUTPUT_CSV = path.join(ROUTE_MAPPINGS_DIR, "import-candidates.csv");

function toArray(value) {
  if (!value) return [];
  return String(value)
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function classifyRow(row) {
  if (row.final_status === "protected_reference" || row.protected_live === "yes") {
    return {
      bucket: "protected_reference",
      reason: "protected_club"
    };
  }

  if (!row.suggested_fig_course_name || !row.suggested_fig_source_external_id) {
    return {
      bucket: "needs_review",
      reason: "missing_fig_target"
    };
  }

  if (row.ges_route_status !== "safe") {
    return {
      bucket: "needs_review",
      reason: "ges_route_warning"
    };
  }

  if (toArray(row.ges_route_anomalies).length > 0) {
    return {
      bucket: "needs_review",
      reason: "ges_route_anomaly"
    };
  }

  if (!["high", "benchmark_manual"].includes(row.suggested_confidence)) {
    return {
      bucket: "needs_review",
      reason: "confidence_too_low"
    };
  }

  if (row.suggested_relation === "alias_candidate" || row.suggested_relation === "review_needed") {
    return {
      bucket: "needs_review",
      reason: "relation_not_final"
    };
  }

  return {
    bucket: "import_ready",
    reason: "all_checks_passed"
  };
}

function summarizeByClub(rows) {
  const byClub = new Map();

  for (const row of rows) {
    const key = `${row.fig_club}::${row.circolo_id}`;
    if (!byClub.has(key)) {
      byClub.set(key, {
        fig_club: row.fig_club,
        gesgolf_club: row.gesgolf_club,
        circolo_id: row.circolo_id,
        protected_live: row.protected_live,
        total_routes: 0,
        import_ready_routes: 0,
        review_routes: 0,
        protected_routes: 0
      });
    }

    const club = byClub.get(key);
    club.total_routes += 1;
    if (row.import_bucket === "import_ready") club.import_ready_routes += 1;
    if (row.import_bucket === "needs_review") club.review_routes += 1;
    if (row.import_bucket === "protected_reference") club.protected_routes += 1;
  }

  return [...byClub.values()].map((club) => ({
    ...club,
    club_status:
      club.protected_routes === club.total_routes
        ? "protected_reference"
        : club.review_routes === 0 && club.import_ready_routes > 0
          ? "import_ready"
          : "needs_review"
  }));
}

async function main() {
  const payload = await loadJson(ROUTE_MAPPINGS_TEMPLATE_JSON);
  const routeRows = (payload.rows || []).map((row) => {
    const verdict = classifyRow(row);
    return {
      ...row,
      import_bucket: verdict.bucket,
      import_reason: verdict.reason
    };
  });

  const clubSummary = summarizeByClub(routeRows);

  const output = {
    generated_at: new Date().toISOString(),
    source: {
      mapping_template: ROUTE_MAPPINGS_TEMPLATE_JSON
    },
    summary: {
      total_routes: routeRows.length,
      import_ready_routes: routeRows.filter((row) => row.import_bucket === "import_ready").length,
      needs_review_routes: routeRows.filter((row) => row.import_bucket === "needs_review").length,
      protected_reference_routes: routeRows.filter((row) => row.import_bucket === "protected_reference").length,
      total_clubs: clubSummary.length,
      import_ready_clubs: clubSummary.filter((club) => club.club_status === "import_ready").length,
      needs_review_clubs: clubSummary.filter((club) => club.club_status === "needs_review").length,
      protected_reference_clubs: clubSummary.filter((club) => club.club_status === "protected_reference").length
    },
    clubs: clubSummary,
    routes: routeRows
  };

  const csvRows = routeRows.map((row) => ({
    fig_club: row.fig_club,
    gesgolf_club: row.gesgolf_club,
    circolo_id: row.circolo_id,
    ges_route_name: row.ges_route_name,
    suggested_fig_course_name: row.suggested_fig_course_name,
    suggested_fig_source_external_id: row.suggested_fig_source_external_id,
    suggested_relation: row.suggested_relation,
    suggested_confidence: row.suggested_confidence,
    ges_route_status: row.ges_route_status,
    ges_route_anomalies: row.ges_route_anomalies,
    protected_live: row.protected_live,
    import_bucket: row.import_bucket,
    import_reason: row.import_reason
  }));

  await mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
  await writeFile(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf-8");
  await writeFile(OUTPUT_CSV, buildCsv(csvRows), "utf-8");

  console.log(
    JSON.stringify(
      {
        summary: output.summary,
        jsonOut: OUTPUT_JSON,
        csvOut: OUTPUT_CSV
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
