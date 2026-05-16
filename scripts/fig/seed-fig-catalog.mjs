import { createClient } from "@supabase/supabase-js";
import {
  readJsonFile,
  validateFigCatalogPayload
} from "./shared-catalog.mjs";
import { getRequiredEnv } from "./shared.mjs";

async function fetchExistingRow(supabase, table, matchers) {
  let query = supabase.from(table).select("*").limit(1);
  matchers.forEach(([column, value]) => {
    query = query.eq(column, value);
  });
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertImportBatch(supabase, batch) {
  const { data, error } = await supabase
    .from("fig_import_batches")
    .insert({
      source_system: batch.source_system || "fig",
      source_url: batch.source_url,
      source_version: batch.source_version || null,
      scraped_at: batch.scraped_at,
      notes: batch.notes || null,
      raw_payload: batch.raw_payload || {},
      status: "imported"
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function upsertFigClub(supabase, importBatchId, clubPayload) {
  const basePayload = {
    import_batch_id: importBatchId,
    source_system: "fig",
    source_external_id: clubPayload.source_external_id,
    name: clubPayload.name,
    name_normalized: clubPayload.name_normalized,
    city: clubPayload.city || null,
    region: clubPayload.region || null,
    country: clubPayload.country || "Italia",
    is_active: clubPayload.is_active ?? true,
    source_payload: clubPayload.source_payload || {}
  };

  const existing = await fetchExistingRow(supabase, "fig_clubs", [
    ["source_system", "fig"],
    ["source_external_id", clubPayload.source_external_id]
  ]);

  if (existing) {
    const { data, error } = await supabase
      .from("fig_clubs")
      .update(basePayload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("fig_clubs")
    .insert(basePayload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function replaceFigPlayableCourses(supabase, figClubId, playableCourses) {
  const existingBySource = new Map();
  const { data: existingCourses, error: fetchError } = await supabase
    .from("fig_playable_courses")
    .select("*")
    .eq("fig_club_id", figClubId);
  if (fetchError) throw fetchError;
  (existingCourses || []).forEach((course) => {
    existingBySource.set(course.source_external_id, course);
  });

  const courseIdBySource = new Map();

  for (const coursePayload of playableCourses) {
    const basePayload = {
      fig_club_id: figClubId,
      source_system: "fig",
      source_external_id: coursePayload.source_external_id,
      name: coursePayload.name,
      name_normalized: coursePayload.name_normalized,
      holes_count: coursePayload.holes_count,
      total_par: coursePayload.total_par ?? null,
      course_type: coursePayload.course_type,
      route_family: coursePayload.route_family,
      display_order: coursePayload.display_order ?? null,
      course_composition: coursePayload.course_composition || {},
      is_active: coursePayload.is_active ?? true,
      source_payload: coursePayload.source_payload || {}
    };

    const existing = existingBySource.get(coursePayload.source_external_id);

    const course = existing
      ? await supabase
          .from("fig_playable_courses")
          .update(basePayload)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await supabase
          .from("fig_playable_courses")
          .insert(basePayload)
          .select("*")
          .single();

    if (course.error) throw course.error;
    courseIdBySource.set(coursePayload.source_external_id, course.data.id);

    const { error: deleteTeesError } = await supabase
      .from("fig_course_tees")
      .delete()
      .eq("fig_playable_course_id", course.data.id);
    if (deleteTeesError) throw deleteTeesError;

    if ((coursePayload.tees || []).length) {
      const teeRows = coursePayload.tees.map((tee) => ({
        fig_playable_course_id: course.data.id,
        source_system: "fig",
        source_external_id: tee.source_external_id,
        tee_name: tee.tee_name,
        tee_color: tee.tee_color || null,
        gender: tee.gender || "",
        course_rating: tee.course_rating ?? null,
        slope_rating: tee.slope_rating ?? null,
        par_total: tee.par_total ?? null,
        tee_order: tee.tee_order ?? null,
        is_active: tee.is_active ?? true,
        source_payload: tee.source_payload || {}
      }));
      const { error: insertTeesError } = await supabase.from("fig_course_tees").insert(teeRows);
      if (insertTeesError) throw insertTeesError;
    }
  }

  return courseIdBySource;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Uso: node scripts/fig/seed-fig-catalog.mjs <path-json-normalizzato>");
  }

  const { data: payload } = await readJsonFile(inputPath);
  validateFigCatalogPayload(payload);

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const totalPlayableCourses = payload.clubs.reduce(
    (sum, club) => sum + (club.playable_courses || []).length,
    0
  );

  console.log(`Seed FIG avviato: ${payload.clubs.length} club, ${totalPlayableCourses} percorsi.`);

  const importBatch = await upsertImportBatch(supabase, payload.import_batch);

  let processedClubs = 0;
  let processedCourses = 0;

  for (const clubPayload of payload.clubs) {
    const figClub = await upsertFigClub(supabase, importBatch.id, clubPayload);
    await replaceFigPlayableCourses(supabase, figClub.id, clubPayload.playable_courses || []);
    processedClubs += 1;
    processedCourses += (clubPayload.playable_courses || []).length;

    if (processedClubs === 1 || processedClubs % 10 === 0 || processedClubs === payload.clubs.length) {
      console.log(
        `[${processedClubs}/${payload.clubs.length}] ${clubPayload.name} · percorsi processati ${processedCourses}/${totalPlayableCourses}`
      );
    }
  }

  console.log("Seed catalogo FIG completato.");
  console.log(`Batch: ${importBatch.id}`);
  console.log(`Club: ${payload.clubs.length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
