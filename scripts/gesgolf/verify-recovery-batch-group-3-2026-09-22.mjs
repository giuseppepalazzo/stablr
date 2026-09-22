import fs from "node:fs";
import path from "node:path";
import { PostgrestClient } from "@supabase/postgrest-js";

import { repoRoot } from "./shared.mjs";

const INPUTS = [
  "tauriana-normalized.json",
  "tirrenia-normalized.json",
  "valpescara-normalized.json",
  "verdura-normalized.json",
  "villa-giusti-normalized.json"
];

function loadSeedEnv() {
  const envPath = path.join(repoRoot, ".env.seed.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
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
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;
  return new PostgrestClient(`${url.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "")}/rest/v1`, { headers });
}

function assert(condition, message, issues) {
  if (!condition) issues.push(message);
}

async function exactCount(db, table, apply = (query) => query) {
  const { count, error } = await apply(db.from(table).select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count;
}

function equalNullable(a, b) {
  return (a ?? null) === (b ?? null);
}

async function main() {
  loadSeedEnv();
  const db = client();
  const payloads = INPUTS.map((name) => JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "gesgolf", "imports", name), "utf8")));
  const mode = process.argv.includes("--preflight") ? "preflight" : "read-back";
  const issues = [];
  const targets = [];

  for (const payload of payloads) {
    const sourceId = payload.club.source_external_id;
    const { data: club, error: clubError } = await db.from("clubs").select("*").eq("source_system", "fig").eq("source_external_id", sourceId).maybeSingle();
    if (clubError) throw clubError;

    if (mode === "preflight") {
      targets.push({ club: payload.club.name, source_external_id: sourceId, present: Boolean(club) });
      continue;
    }

    assert(Boolean(club), `${payload.club.name}: club remoto assente`, issues);
    if (!club) continue;
    assert(club.data_status === payload.club.data_status, `${payload.club.name}: data_status`, issues);
    assert(club.playable === payload.club.playable, `${payload.club.name}: playable`, issues);
    assert(club.is_active === payload.club.is_active, `${payload.club.name}: is_active`, issues);
    assert(Boolean(club.fig_club_id), `${payload.club.name}: fig_club_id assente`, issues);
    assert(club.source_payload?.governance_state === payload.club.source_payload.governance_state, `${payload.club.name}: governance_state`, issues);
    assert(club.source_payload?.verification_status === payload.club.source_payload.verification_status, `${payload.club.name}: verification_status`, issues);

    const { data: routes, error: routesError } = await db.from("course_routes").select("*").eq("club_id", club.id).eq("is_active", true).order("display_order");
    if (routesError) throw routesError;
    assert(routes.length === payload.routes.length, `${payload.club.name}: route attive ${routes.length}/${payload.routes.length}`, issues);

    let holeCount = 0;
    let teeCount = 0;
    for (const expectedRoute of payload.routes) {
      const route = routes.find((item) => item.source_system === expectedRoute.source_system && item.source_external_id === expectedRoute.source_external_id);
      assert(Boolean(route), `${payload.club.name}/${expectedRoute.name}: route assente`, issues);
      if (!route) continue;
      assert(route.name === expectedRoute.name, `${payload.club.name}/${expectedRoute.name}: nome`, issues);
      assert(route.holes_count === expectedRoute.holes_count, `${payload.club.name}/${expectedRoute.name}: holes_count`, issues);
      assert(route.total_par === expectedRoute.total_par, `${payload.club.name}/${expectedRoute.name}: total_par`, issues);
      assert(route.source_payload?.governance_state === expectedRoute.source_payload.governance_state, `${payload.club.name}/${expectedRoute.name}: route governance`, issues);

      const { data: holes, error: holesError } = await db.from("route_holes").select("*").eq("route_id", route.id).order("physical_hole_number");
      if (holesError) throw holesError;
      holeCount += holes.length;
      assert(holes.length === expectedRoute.holes.length, `${payload.club.name}/${expectedRoute.name}: buche ${holes.length}/${expectedRoute.holes.length}`, issues);
      expectedRoute.holes.forEach((expected, index) => {
        const actual = holes[index];
        assert(Boolean(actual), `${payload.club.name}/${expectedRoute.name}: buca ${index + 1} assente`, issues);
        if (!actual) return;
        assert(actual.physical_hole_number === expected.physical_hole_number, `${payload.club.name}/${expectedRoute.name}: numero buca ${index + 1}`, issues);
        assert(actual.par === expected.par, `${payload.club.name}/${expectedRoute.name}: PAR buca ${index + 1}`, issues);
        assert(actual.stroke_index === expected.stroke_index, `${payload.club.name}/${expectedRoute.name}: SI buca ${index + 1}`, issues);
      });

      const { data: tees, error: teesError } = await db.from("route_tees").select("*").eq("route_id", route.id).eq("is_active", true).order("tee_name");
      if (teesError) throw teesError;
      teeCount += tees.length;
      assert(tees.length === expectedRoute.tees.length, `${payload.club.name}/${expectedRoute.name}: tee ${tees.length}/${expectedRoute.tees.length}`, issues);
      for (const expected of expectedRoute.tees) {
        const actual = tees.find((item) => item.tee_name === expected.tee_name);
        assert(Boolean(actual), `${payload.club.name}/${expectedRoute.name}: tee ${expected.tee_name} assente`, issues);
        if (!actual) continue;
        for (const field of ["tee_color", "gender", "course_rating", "slope_rating", "par_total", "source_external_id"]) {
          assert(equalNullable(actual[field], expected[field]), `${payload.club.name}/${expectedRoute.name}/${expected.tee_name}: ${field}`, issues);
        }
      }
    }

    targets.push({
      club: payload.club.name,
      playable: club.playable,
      data_status: club.data_status,
      governance_state: club.source_payload?.governance_state,
      routes: routes.length,
      holes: holeCount,
      tees: teeCount
    });
  }

  const { data: activeClubs, error: activeError } = await db.from("clubs").select("id,data_status,playable,source_payload").eq("is_active", true).range(0, 999);
  if (activeError) throw activeError;
  const counts = {
    fig_canonical_local: 220,
    fig_active_remote: await exactCount(db, "fig_clubs", (query) => query.eq("is_active", true)),
    active_clubs: activeClubs.length,
    playable_clubs: activeClubs.filter((club) => club.playable).length,
    non_playable_clubs: activeClubs.filter((club) => !club.playable).length,
    green: activeClubs.filter((club) => club.data_status === "verified").length,
    orange: activeClubs.filter((club) => club.source_payload?.verification_status === "playable_review").length,
    in_review: activeClubs.filter((club) => club.source_payload?.verification_status === "in_review").length,
    needs_review_total: activeClubs.filter((club) => club.data_status === "needs_review").length
  };

  console.log(JSON.stringify({ mode, targets, counts, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
