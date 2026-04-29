import { createClient } from "@supabase/supabase-js";
import {
  getRequiredEnv,
  loadNormalizedJson,
  summarizePayload,
  validateNormalizedPayload
} from "./shared.mjs";

function uniqueBy(items, getKey) {
  const map = new Map();
  items.forEach((item) => {
    map.set(getKey(item), item);
  });
  return [...map.values()];
}

async function fetchExistingRow(supabase, table, matchers) {
  let query = supabase.from(table).select("*").limit(1);
  matchers.forEach(([column, value]) => {
    query = query.eq(column, value);
  });
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertClub(supabase, clubPayload, createdBy) {
  const basePayload = {
    name: clubPayload.name,
    name_normalized: clubPayload.name_normalized,
    city: clubPayload.city || null,
    country: clubPayload.country || null,
    created_by: createdBy,
    is_active: clubPayload.is_active ?? true,
    source_system: clubPayload.source_system || null,
    source_external_id: clubPayload.source_external_id || null,
    source_payload: clubPayload.source_payload || {}
  };

  const existing =
    (clubPayload.source_system && clubPayload.source_external_id
      ? await fetchExistingRow(supabase, "clubs", [
          ["source_system", clubPayload.source_system],
          ["source_external_id", clubPayload.source_external_id]
        ])
      : null) ||
    (await fetchExistingRow(supabase, "clubs", [["name_normalized", clubPayload.name_normalized]]));

  if (existing) {
    const { data, error } = await supabase
      .from("clubs")
      .update(basePayload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("clubs").insert(basePayload).select("*").single();
  if (error) throw error;
  return data;
}

async function upsertRoute(supabase, clubId, routePayload) {
  const basePayload = {
    club_id: clubId,
    name: routePayload.name,
    holes_count: routePayload.holes_count,
    total_par: routePayload.total_par ?? null,
    display_order: routePayload.display_order ?? null,
    is_active: routePayload.is_active ?? true,
    source_system: routePayload.source_system || null,
    source_external_id: routePayload.source_external_id || null,
    source_payload: routePayload.source_payload || {}
  };

  const existing =
    (routePayload.source_system && routePayload.source_external_id
      ? await fetchExistingRow(supabase, "course_routes", [
          ["source_system", routePayload.source_system],
          ["source_external_id", routePayload.source_external_id]
        ])
      : null) ||
    (await fetchExistingRow(supabase, "course_routes", [
      ["club_id", clubId],
      ["name", routePayload.name]
    ]));

  if (existing) {
    const { data, error } = await supabase
      .from("course_routes")
      .update(basePayload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("course_routes")
    .insert(basePayload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function replaceRouteHoles(supabase, routeId, holes) {
  const { error: deleteError } = await supabase.from("route_holes").delete().eq("route_id", routeId);
  if (deleteError) throw deleteError;

  if (!holes.length) return;

  const rows = holes.map((hole) => ({
    route_id: routeId,
    physical_hole_number: hole.physical_hole_number,
    par: hole.par,
    stroke_index: hole.stroke_index ?? null,
    display_label: hole.display_label || null
  }));

  const { error } = await supabase.from("route_holes").insert(rows);
  if (error) throw error;
}

async function replaceRouteTees(supabase, routeId, tees) {
  const { error: deleteError } = await supabase.from("route_tees").delete().eq("route_id", routeId);
  if (deleteError) throw deleteError;

  if (!tees.length) return;

  const rows = uniqueBy(tees, (tee) => tee.tee_name).map((tee) => ({
    route_id: routeId,
    tee_name: tee.tee_name,
    tee_color: tee.tee_color || null,
    gender: tee.gender || null,
    course_rating: tee.course_rating ?? null,
    slope_rating: tee.slope_rating ?? null,
    par_total: tee.par_total ?? null,
    source_system: tee.source_system || null,
    source_external_id: tee.source_external_id || null,
    source_payload: tee.source_payload || {},
    is_active: tee.is_active ?? true
  }));

  const { error } = await supabase.from("route_tees").insert(rows);
  if (error) throw error;
}

async function upsertCombination(supabase, clubId, combinationPayload, routeIdMap) {
  const basePayload = {
    club_id: clubId,
    name: combinationPayload.name,
    front_route_id: routeIdMap.get(combinationPayload.front_route_external_key),
    back_route_id: routeIdMap.get(combinationPayload.back_route_external_key),
    holes_count: combinationPayload.holes_count ?? 18,
    total_par: combinationPayload.total_par ?? null,
    is_active: combinationPayload.is_active ?? true,
    source_system: combinationPayload.source_system || null,
    source_external_id: combinationPayload.source_external_id || null,
    source_payload: combinationPayload.source_payload || {}
  };

  const existing =
    (combinationPayload.source_system && combinationPayload.source_external_id
      ? await fetchExistingRow(supabase, "route_combinations", [
          ["source_system", combinationPayload.source_system],
          ["source_external_id", combinationPayload.source_external_id]
        ])
      : null) ||
    (await fetchExistingRow(supabase, "route_combinations", [
      ["club_id", clubId],
      ["front_route_id", basePayload.front_route_id],
      ["back_route_id", basePayload.back_route_id]
    ]));

  if (existing) {
    const { data, error } = await supabase
      .from("route_combinations")
      .update(basePayload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("route_combinations")
    .insert(basePayload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function replaceCombinationHoles(supabase, combinationId, holes, routeIdMap) {
  const { error: deleteError } = await supabase
    .from("route_combination_holes")
    .delete()
    .eq("route_combination_id", combinationId);
  if (deleteError) throw deleteError;

  if (!holes.length) return;

  const rows = holes.map((hole) => ({
    route_combination_id: combinationId,
    round_hole_number: hole.round_hole_number,
    route_id: routeIdMap.get(hole.route_external_key),
    route_position: hole.route_position,
    physical_hole_number: hole.physical_hole_number,
    par: hole.par,
    stroke_index: hole.stroke_index,
    source_stroke_index: hole.source_stroke_index ?? null,
    display_label: hole.display_label || null
  }));

  const { error } = await supabase.from("route_combination_holes").insert(rows);
  if (error) throw error;
}

async function replaceCombinationTees(supabase, combinationId, tees) {
  const { error: deleteError } = await supabase
    .from("combination_tees")
    .delete()
    .eq("route_combination_id", combinationId);
  if (deleteError) throw deleteError;

  if (!tees.length) return;

  const rows = uniqueBy(tees, (tee) => tee.tee_name).map((tee) => ({
    route_combination_id: combinationId,
    tee_name: tee.tee_name,
    tee_color: tee.tee_color || null,
    gender: tee.gender || null,
    course_rating: tee.course_rating ?? null,
    slope_rating: tee.slope_rating ?? null,
    par_total: tee.par_total ?? null,
    source_system: tee.source_system || null,
    source_external_id: tee.source_external_id || null,
    source_payload: tee.source_payload || {},
    is_active: tee.is_active ?? true
  }));

  const { error } = await supabase.from("combination_tees").insert(rows);
  if (error) throw error;
}

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Uso: node scripts/fig/seed-normalized.mjs <path-json-normalizzato>");
  }

  const { data } = await loadNormalizedJson(inputPath);
  validateNormalizedPayload(data);

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const createdBy = getRequiredEnv("STABLR_CREATED_BY_USER_ID");

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const club = await upsertClub(supabase, data.club, createdBy);

  const routeIdMap = new Map();

  for (const routePayload of data.routes) {
    const route = await upsertRoute(supabase, club.id, routePayload);
    routeIdMap.set(routePayload.external_key, route.id);
    await replaceRouteHoles(supabase, route.id, routePayload.holes || []);
    await replaceRouteTees(supabase, route.id, routePayload.tees || []);
  }

  for (const combinationPayload of data.route_combinations) {
    const combination = await upsertCombination(supabase, club.id, combinationPayload, routeIdMap);
    await replaceCombinationHoles(
      supabase,
      combination.id,
      combinationPayload.holes || [],
      routeIdMap
    );
    await replaceCombinationTees(supabase, combination.id, combinationPayload.tees || []);
  }

  const summary = summarizePayload(data);
  console.log("Seed completato.");
  console.log(`Club: ${summary.club}`);
  console.log(`Percorsi: ${summary.routes}`);
  console.log(`Combinazioni ufficiali: ${summary.routeCombinations}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
