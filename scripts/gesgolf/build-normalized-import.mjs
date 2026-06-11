import fs from "node:fs/promises";
import path from "node:path";

import { slugify } from "../fig/shared-catalog.mjs";
import { validateNormalizedPayload } from "../fig/shared.mjs";
import { repoRoot } from "./shared.mjs";

const IMPORT_CANDIDATES_PATH = path.join(
  repoRoot,
  "data",
  "gesgolf",
  "mappings",
  "import-candidates.json"
);
const FIG_CATALOG_PATH = path.join(
  repoRoot,
  "data",
  "fig",
  "normalized",
  "fig-catalog-normalized.json"
);
const GESGOLF_NORMALIZED_DIR = path.join(repoRoot, "data", "gesgolf", "normalized");
const OUTPUT_DIR = path.join(repoRoot, "data", "gesgolf", "imports");

function getArgValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function findGesGolfNormalizedPath(figClubName, circoloId) {
  const expectedPath = path.join(
    GESGOLF_NORMALIZED_DIR,
    slugify(figClubName),
    `circolo-${circoloId}.json`
  );

  if (await fileExists(expectedPath)) {
    return expectedPath;
  }

  const directories = await fs.readdir(GESGOLF_NORMALIZED_DIR, { withFileTypes: true });
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const candidatePath = path.join(GESGOLF_NORMALIZED_DIR, entry.name, `circolo-${circoloId}.json`);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`File GesGolf normalizzato non trovato per ${figClubName} (${circoloId}).`);
}

function buildRoutePayload(routeCandidate, gesRoute, figCourse) {
  return {
    external_key: figCourse.source_external_id,
    name: figCourse.name,
    holes_count: figCourse.holes_count,
    total_par: figCourse.total_par,
    display_order: figCourse.display_order ?? null,
    is_active: figCourse.is_active ?? true,
    source_system: "fig",
    source_external_id: figCourse.source_external_id,
    source_payload: {
      kind: "route",
      official_catalog: "fig",
      hole_by_hole_source: "gesgolf",
      gesgolf: {
        circolo_id: routeCandidate.circolo_id,
        gesgolf_club: routeCandidate.gesgolf_club,
        route_name: routeCandidate.ges_route_name,
        playable_kind: routeCandidate.ges_playable_kind,
        percorso_id: gesRoute.percorso_id
      }
    },
    holes: gesRoute.holes.map((hole) => ({
      physical_hole_number: hole.hole_number,
      par: hole.par,
      stroke_index: hole.hcp,
      display_label: String(hole.hole_number)
    })),
    tees: (figCourse.tees || []).map((tee) => ({
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
    }))
  };
}

async function main() {
  const clubName = getArgValue("--club");
  assert(clubName, "Uso: node scripts/gesgolf/build-normalized-import.mjs --club \"Albisola\"");

  const importCandidates = await readJson(IMPORT_CANDIDATES_PATH);
  const figCatalog = await readJson(FIG_CATALOG_PATH);

  const clubSummary = (importCandidates.clubs || []).find((club) => club.fig_club === clubName);
  assert(clubSummary, `Club non trovato in import-candidates: ${clubName}`);
  assert(
    clubSummary.club_status === "import_ready",
    `${clubName} non e' ancora import_ready (status: ${clubSummary.club_status}).`
  );
  assert(clubSummary.protected_live !== "yes", `${clubName} e' protetto e non puo' essere esportato.`);

  const routeCandidates = (importCandidates.routes || []).filter(
    (route) => route.fig_club === clubName && route.import_bucket === "import_ready"
  );
  assert(routeCandidates.length > 0, `Nessuna route import_ready trovata per ${clubName}.`);
  assert(
    routeCandidates.length === clubSummary.total_routes,
    `${clubName} non ha ancora tutte le route pronte (${routeCandidates.length}/${clubSummary.total_routes}).`
  );

  const figClub = (figCatalog.clubs || []).find((club) => club.name === clubName);
  assert(figClub, `Club FIG non trovato nel catalogo normalizzato: ${clubName}`);

  const normalizedPath = await findGesGolfNormalizedPath(clubName, clubSummary.circolo_id);
  const gesNormalized = await readJson(normalizedPath);
  assert(gesNormalized.scrape_status === "safe", `${clubName} non ha scrape_status safe.`);

  const figCourseMap = new Map(
    (figClub.playable_courses || []).map((course) => [course.source_external_id, course])
  );

  const routes = routeCandidates
    .map((candidate) => {
      const figCourse = figCourseMap.get(candidate.suggested_fig_source_external_id);
      assert(
        figCourse,
        `Percorso FIG non trovato per ${candidate.ges_route_name}: ${candidate.suggested_fig_source_external_id}`
      );

      const gesRoute = (gesNormalized.playable_courses || []).find(
        (route) =>
          route.name === candidate.ges_route_name &&
          route.holes_count === candidate.ges_holes_count &&
          route.total_par === candidate.ges_total_par
      );
      assert(
        gesRoute,
        `Percorso GesGolf non trovato nel file normalizzato: ${candidate.ges_route_name}`
      );

      return buildRoutePayload(candidate, gesRoute, figCourse);
    })
    .sort((left, right) => (left.display_order ?? 999) - (right.display_order ?? 999));

  const payload = {
    schema_version: "1.0",
    source: {
      system: "gesgolf",
      scraped_at: gesNormalized.source?.scraped_at || new Date().toISOString(),
      club_external_id: figClub.source_external_id,
      notes: `Official FIG catalog + GesGolf hole-by-hole import pilot for ${clubName}`
    },
    club: {
      name: figClub.name,
      name_normalized: figClub.name_normalized,
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
        hole_by_hole_source: "gesgolf",
        gesgolf: {
          circolo_id: clubSummary.circolo_id,
          gesgolf_club: clubSummary.gesgolf_club
        }
      }
    },
    routes,
    route_combinations: []
  };

  validateNormalizedPayload(payload);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `${slugify(clubName)}-normalized.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        club: clubName,
        routes: routes.length,
        route_combinations: 0,
        input: normalizedPath,
        output: outputPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
