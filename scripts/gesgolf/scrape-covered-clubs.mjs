import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  FIG_CATALOG_PATH,
  REPORTS_DIR,
  buildCsv,
  getArgValue,
  repoRoot
} from "./shared.mjs";
import { scrapeGesGolfClub, slugify } from "./scrape-club-lib.mjs";

const COVERAGE_PATH = path.join(REPORTS_DIR, "fig-gesgolf-coverage.json");
const DEFAULT_JSON_OUTPUT = path.join(REPORTS_DIR, "gesgolf-scrape-batch.json");
const DEFAULT_CSV_OUTPUT = path.join(REPORTS_DIR, "gesgolf-scrape-batch.csv");
const PROTECTED_CLUBS = new Set(["mare di roma", "parco de medici"]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function classifyCoverageRow(row, strongThreshold) {
  if (!row.match || row.match.score < strongThreshold) return "skip_not_strong";
  if (PROTECTED_CLUBS.has(normalize(row.fig_club))) return "skip_protected";
  return "eligible";
}

async function main() {
  const jsonOut = path.resolve(getArgValue("--json-out", DEFAULT_JSON_OUTPUT));
  const csvOut = path.resolve(getArgValue("--csv-out", DEFAULT_CSV_OUTPUT));
  const strongThreshold = Number(getArgValue("--strong-threshold", "90"));
  const limit = Number(getArgValue("--limit", "0"));
  const offset = Number(getArgValue("--offset", "0"));
  const delayMs = Number(getArgValue("--delay-ms", "150"));

  const coverageRaw = await writeThenReadJson(COVERAGE_PATH);
  const rows = coverageRaw.results || [];
  const eligible = rows
    .map((row) => ({ row, action: classifyCoverageRow(row, strongThreshold) }))
    .filter((entry) => entry.action === "eligible")
    .map((entry) => entry.row);

  const slice = limit > 0 ? eligible.slice(offset, offset + limit) : eligible.slice(offset);
  const results = [];
  const skipped = rows
    .map((row) => ({ row, action: classifyCoverageRow(row, strongThreshold) }))
    .filter((entry) => entry.action !== "eligible")
    .map((entry) => ({
      fig_club: entry.row.fig_club,
      gesgolf_club: entry.row.match?.name || "",
      circolo_id: entry.row.match?.circolo_id || "",
      action: entry.action
    }));

  for (let index = 0; index < slice.length; index += 1) {
    const row = slice[index];
    try {
      const result = await scrapeGesGolfClub({
        circoloId: row.match.circolo_id,
        slug: slugify(row.match.name),
        sourceLabel: `Batch scraper from FIG coverage. No live DB writes. FIG catalog source: ${FIG_CATALOG_PATH}`,
        figClub: row
      });

      results.push({
        fig_club: row.fig_club,
        gesgolf_club: row.match.name,
        circolo_id: row.match.circolo_id,
        match_score: row.match.score,
        scrape_status: result.scrape_status,
        playable_courses: result.playable_courses,
        warning_courses: result.warning_courses,
        failed_courses: result.failed_courses,
        output: result.output,
        action: "scraped"
      });
    } catch (error) {
      results.push({
        fig_club: row.fig_club,
        gesgolf_club: row.match.name,
        circolo_id: row.match.circolo_id,
        match_score: row.match.score,
        scrape_status: "error",
        playable_courses: 0,
        warning_courses: 0,
        failed_courses: 1,
        output: "",
        action: "scrape_failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if ((index + 1) % 10 === 0 || index === slice.length - 1) {
      console.log(`Batch progress ${index + 1}/${slice.length}`);
    }

    if (delayMs > 0 && index < slice.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const summary = {
    total_coverage_rows: rows.length,
    eligible_rows: eligible.length,
    protected_skipped: skipped.filter((row) => row.action === "skip_protected").length,
    weak_skipped: skipped.filter((row) => row.action === "skip_not_strong").length,
    processed_now: slice.length,
    scraped_safe: results.filter((row) => row.scrape_status === "safe").length,
    scraped_warning: results.filter((row) => row.scrape_status === "warning").length,
    scraped_error: results.filter((row) => row.scrape_status === "error").length
  };

  const payload = {
    generated_at: new Date().toISOString(),
    source: {
      coverage_path: COVERAGE_PATH,
      fig_catalog_path: FIG_CATALOG_PATH
    },
    protected_clubs: [...PROTECTED_CLUBS],
    summary,
    skipped,
    results
  };

  await mkdir(path.dirname(jsonOut), { recursive: true });
  await mkdir(path.dirname(csvOut), { recursive: true });
  await writeFile(jsonOut, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await writeFile(csvOut, buildCsv([...results, ...skipped]), "utf-8");

  console.log(JSON.stringify({ summary, jsonOut, csvOut }, null, 2));
}

async function writeThenReadJson(filePath) {
  const text = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
  return JSON.parse(text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
