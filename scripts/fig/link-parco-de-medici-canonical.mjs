import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgrestClient } from "@supabase/postgrest-js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");

const PARCO_ID = "bf5b48bf-4eff-46e8-910c-4915d359dea2";
const MARE_ID = "c391c4f7-95a2-4b4d-a5a5-d95064c40263";
const LEGACY_KEY = "fig-parco-medici";
const CANONICAL_KEY = "fig-club-parco-de-medici";
const CANONICAL_NAME = "parco de medici";

function loadSeedEnv() {
  const envPath = path.join(repoRoot, ".env.seed.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY mancanti");

  const headers = { apikey: key };
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${key}`;
  }

  const baseUrl = url.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  return new PostgrestClient(`${baseUrl}/rest/v1`, { headers });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function rows(db, table, build = (query) => query) {
  const { data, error } = await build(db.from(table).select("*")).range(0, 9999);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

async function oneById(db, table, id) {
  const result = await rows(db, table, (query) => query.eq("id", id));
  assert(result.length === 1, `${table}/${id}: atteso un record, trovati ${result.length}`);
  return result[0];
}

async function snapshot(db) {
  const club = await oneById(db, "clubs", PARCO_ID);
  const mare = await oneById(db, "clubs", MARE_ID);
  const canonicalFig = await rows(db, "fig_clubs", (query) =>
    query.eq("source_system", "fig").eq("source_external_id", CANONICAL_KEY)
  );
  const sameName = await rows(db, "clubs", (query) =>
    query.eq("name_normalized", CANONICAL_NAME).eq("is_active", true)
  );

  assert(canonicalFig.length === 1, `Identita FIG canonica: trovati ${canonicalFig.length} record`);
  assert(sameName.length === 1 && sameName[0].id === PARCO_ID, "Parco de' Medici duplicato o UUID inatteso");

  const routes = await rows(db, "course_routes", (query) =>
    query.eq("club_id", PARCO_ID).order("id")
  );
  const routeIds = routes.map((route) => route.id);
  const routeHoles = await rows(db, "route_holes", (query) =>
    query.in("route_id", routeIds).order("route_id").order("physical_hole_number")
  );
  const routeTees = await rows(db, "route_tees", (query) =>
    query.in("route_id", routeIds).order("route_id").order("tee_name")
  );
  const combinations = await rows(db, "route_combinations", (query) =>
    query.eq("club_id", PARCO_ID).order("id")
  );
  const combinationIds = combinations.map((combination) => combination.id);
  const combinationHoles = await rows(db, "route_combination_holes", (query) =>
    query
      .in("route_combination_id", combinationIds)
      .order("route_combination_id")
      .order("round_hole_number")
  );
  const combinationTees = await rows(db, "combination_tees", (query) =>
    query.in("route_combination_id", combinationIds).order("route_combination_id").order("tee_name")
  );
  const activeClubs = await rows(db, "clubs", (query) => query.eq("is_active", true));

  assert(club.source_payload?.protected_manual === true, "Protezione protected_manual assente");
  assert(routes.length === 6 && combinations.length === 4, "Configurazione attesa 6 route + 4 combinazioni non trovata");

  return {
    club,
    canonicalFig: canonicalFig[0],
    mare,
    fingerprints: {
      routes: hash(routes),
      routeHoles: hash(routeHoles),
      routeTees: hash(routeTees),
      combinations: hash(combinations),
      combinationHoles: hash(combinationHoles),
      combinationTees: hash(combinationTees),
      mare: hash(mare)
    },
    counts: {
      configurations: routes.length + combinations.length,
      routes: routes.length,
      routeHoles: routeHoles.length,
      routeTees: routeTees.length,
      combinations: combinations.length,
      combinationHoles: combinationHoles.length,
      combinationTees: combinationTees.length,
      activeClubs: activeClubs.length,
      playableClubs: activeClubs.filter((item) => item.playable).length,
      nonPlayableClubs: activeClubs.filter((item) => !item.playable).length
    }
  };
}

function assertUnchanged(before, after) {
  assert(JSON.stringify(before.fingerprints) === JSON.stringify(after.fingerprints), "Dati dipendenti o Mare di Roma modificati");
  assert(JSON.stringify(before.counts) === JSON.stringify(after.counts), "Conteggi catalogo o dipendenze modificati");

  for (const field of ["id", "name", "name_normalized", "data_status", "source_type", "is_complex", "playable", "is_active"]) {
    assert(before.club[field] === after.club[field], `Campo club modificato: ${field}`);
  }
  assert(
    JSON.stringify(before.club.source_payload) === JSON.stringify(after.club.source_payload),
    "Protezioni o stato editoriale modificati"
  );
}

async function main() {
  loadSeedEnv();
  const db = client();
  const apply = process.argv.includes("--apply");
  const before = await snapshot(db);
  const alreadyAligned =
    before.club.source_external_id === CANONICAL_KEY &&
    before.club.fig_club_id === before.canonicalFig.id &&
    before.club.fig_match_status === "matched";

  if (apply && !alreadyAligned) {
    assert(before.club.source_system === "fig", "source_system inatteso");
    assert(before.club.source_external_id === LEGACY_KEY, "Mapping legacy inatteso");
    assert(before.club.fig_club_id == null, "fig_club_id gia valorizzato in modo inatteso");

    const { data, error } = await db
      .from("clubs")
      .update({
        source_external_id: CANONICAL_KEY,
        fig_club_id: before.canonicalFig.id,
        fig_match_status: "matched",
        fig_match_confidence: 1,
        fig_match_notes: "Match canonico verificato; configurazione manuale protetta invariata.",
        fig_matched_at: new Date().toISOString()
      })
      .eq("id", PARCO_ID)
      .eq("source_system", "fig")
      .eq("source_external_id", LEGACY_KEY)
      .is("fig_club_id", null)
      .select("id");
    if (error) throw error;
    assert(data?.length === 1, `Aggiornamento concorrente o non applicato: ${data?.length || 0} record`);
  }

  const after = await snapshot(db);
  assertUnchanged(before, after);
  assert(after.club.source_external_id === (apply || alreadyAligned ? CANONICAL_KEY : LEGACY_KEY), "source_external_id finale inatteso");
  if (apply || alreadyAligned) {
    assert(after.club.fig_club_id === after.canonicalFig.id, "fig_club_id canonico non applicato");
    assert(after.club.fig_match_status === "matched", "fig_match_status finale inatteso");
    assert(after.club.fig_match_confidence === 1, "fig_match_confidence finale inattesa");
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "preflight",
        changed: apply && !alreadyAligned,
        stablr_uuid: after.club.id,
        old_mapping: before.club.source_external_id,
        canonical_fig_uuid: after.canonicalFig.id,
        new_mapping: after.club.source_external_id,
        fig_match_status: after.club.fig_match_status,
        protected_manual: after.club.source_payload?.protected_manual,
        certification: after.club.data_status,
        playable: after.club.playable,
        dependencies_unchanged: true,
        mare_di_roma_unchanged: true,
        counts: after.counts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
