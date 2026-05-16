import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "./shared.mjs";
import { normalizeNameForMatch } from "./shared-catalog.mjs";

function normalizeCity(value) {
  return normalizeNameForMatch(value || "");
}

function getArgFlag(flag) {
  return process.argv.includes(flag);
}

function summarizeCandidate(candidate) {
  return `${candidate.name}${candidate.city ? ` (${candidate.city})` : ""}`;
}

function chooseMatch(club, candidates) {
  if (!candidates.length) {
    return {
      status: "unmatched",
      figClubId: null,
      confidence: null,
      notes: "Nessun club FIG con nome normalizzato corrispondente."
    };
  }

  if (candidates.length === 1) {
    return {
      status: "matched",
      figClubId: candidates[0].id,
      confidence: 1.0,
      notes: "Match forte per nome normalizzato."
    };
  }

  const normalizedClubCity = normalizeCity(club.city);
  if (normalizedClubCity) {
    const cityMatches = candidates.filter(
      (candidate) => normalizeCity(candidate.city) === normalizedClubCity
    );
    if (cityMatches.length === 1) {
      return {
        status: "matched",
        figClubId: cityMatches[0].id,
        confidence: 0.99,
        notes: "Match forte per nome normalizzato e città."
      };
    }
  }

  return {
    status: "needs_review",
    figClubId: null,
    confidence: 0.5,
    notes: `Più candidati FIG trovati: ${candidates.slice(0, 5).map(summarizeCandidate).join(", ")}`
  };
}

async function main() {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const includeStablr = getArgFlag("--include-stablr");
  const forceRematch = getArgFlag("--force");

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: clubs, error: clubsError } = await supabase
    .from("clubs")
    .select(
      "id,name,name_normalized,city,country,data_status,source_type,is_complex,playable,fig_club_id,fig_match_status"
    )
    .order("name_normalized", { ascending: true });
  if (clubsError) throw clubsError;

  const { data: figClubs, error: figClubsError } = await supabase
    .from("fig_clubs")
    .select("id,name,name_normalized,city,country,is_active")
    .eq("is_active", true)
    .order("name_normalized", { ascending: true });
  if (figClubsError) throw figClubsError;

  const figByNormalizedName = new Map();
  for (const figClub of figClubs || []) {
    const key = String(figClub.name_normalized || "").trim().toLowerCase();
    if (!key) continue;
    if (!figByNormalizedName.has(key)) {
      figByNormalizedName.set(key, []);
    }
    figByNormalizedName.get(key).push(figClub);
  }

  let processed = 0;
  let matched = 0;
  let needsReview = 0;
  let unmatched = 0;
  let skipped = 0;

  for (const club of clubs || []) {
    if (!includeStablr && String(club.source_type || "").toLowerCase() === "stablr") {
      skipped += 1;
      continue;
    }

    if (!forceRematch && club.fig_club_id && String(club.fig_match_status || "") === "matched") {
      skipped += 1;
      continue;
    }

    const normalizedKey = String(club.name_normalized || "").trim().toLowerCase();
    if (!normalizedKey) {
      skipped += 1;
      continue;
    }

    const candidates = figByNormalizedName.get(normalizedKey) || [];
    const decision = chooseMatch(club, candidates);

    const updatePayload = {
      fig_club_id: decision.figClubId,
      fig_match_status: decision.status,
      fig_match_confidence: decision.confidence,
      fig_match_notes: decision.notes,
      fig_matched_at: decision.status === "matched" ? new Date().toISOString() : null
    };

    const { error: updateError } = await supabase
      .from("clubs")
      .update(updatePayload)
      .eq("id", club.id);
    if (updateError) throw updateError;

    processed += 1;
    if (decision.status === "matched") matched += 1;
    if (decision.status === "needs_review") needsReview += 1;
    if (decision.status === "unmatched") unmatched += 1;

    if (processed === 1 || processed % 25 === 0) {
      console.log(
        `[${processed}] ${club.name} -> ${decision.status}${decision.figClubId ? ` (${decision.figClubId})` : ""}`
      );
    }
  }

  console.log("Auto-match FIG completato.");
  console.log(`Processati: ${processed}`);
  console.log(`Matched: ${matched}`);
  console.log(`Needs review: ${needsReview}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Skipped: ${skipped}`);
  console.log(
    includeStablr
      ? "Modalità: include anche i club Stablr."
      : "Modalità: i club Stablr sono stati esclusi per sicurezza."
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
